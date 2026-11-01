"""
Daraja Transaction Status queries — Safaricom's own view of a transaction.

Callbacks are a hint; this API is the authority. For every TransChap record we
ask Safaricom what actually happened to that receipt, then compare the two
so the admin M-PESA page can show verified / mismatched / not-found.

Reference: https://developer.safaricom.co.ke/APIs/TransactionStatus
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.models import MpesaStatusCheck, MpesaTransaction
from app.services.mpesa_payout_service import _b2b_urls, _resolve_b2b_credentials
from app.services.mpesa_service import (
    MpesaApiError,
    fetch_access_token,
    resolve_mpesa_config,
)

logger = logging.getLogger(__name__)

CHECK_PENDING = "pending"
CHECK_SUCCESS = "success"
CHECK_FAILED = "failed"
CHECK_TIMEOUT = "timeout"

MATCH_VERIFIED = "verified"
MATCH_AMOUNT_MISMATCH = "amount_mismatch"
MATCH_STATUS_MISMATCH = "status_mismatch"
MATCH_NOT_FOUND = "not_found"
MATCH_UNRESOLVED = "unresolved"

DIRECTION_IN = "in"
DIRECTION_OUT = "out"

# Safaricom stamps FinalisedTime / InitiatedTime in East Africa Time.
NAIROBI_OFFSET = timedelta(hours=3)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _status_urls() -> tuple[str, str]:
    """Reuse the public host already proven to reach us for B2B callbacks."""
    result_url, _ = _b2b_urls()
    base = result_url.rsplit("/mpesa/", 1)[0]
    return f"{base}/mpesa/status/result", f"{base}/mpesa/status/timeout"


def _result_parameter(result: dict[str, Any], key: str) -> str | None:
    """Look parameters up by Key — Safaricom omits keys it has no value for."""
    params = (result.get("ResultParameters") or {}).get("ResultParameter") or []
    if isinstance(params, dict):
        params = [params]
    for item in params:
        if item.get("Key") == key:
            value = item.get("Value")
            return None if value is None else str(value)
    return None


def _parse_safaricom_time(raw: str | None) -> datetime | None:
    """``20180223054112`` (EAT) → naive UTC, matching the rest of our rows."""
    if not raw:
        return None
    text = str(raw).strip()
    if len(text) != 14 or not text.isdigit():
        return None
    try:
        local = datetime.strptime(text, "%Y%m%d%H%M%S")
    except ValueError:
        return None
    return local - NAIROBI_OFFSET


def _parse_amount(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _recorded_receipt(txn: MpesaTransaction, direction: str) -> str | None:
    raw = (
        txn.payout_receipt_number if direction == DIRECTION_OUT else txn.mpesa_receipt_number
    ) or ""
    return raw.strip() or None


def _recorded_amount(txn: MpesaTransaction, direction: str) -> int:
    if direction == DIRECTION_OUT:
        return int(txn.payout_amount or txn.amount)
    return int(txn.amount)


def latest_checks_for_transactions(
    db: Session,
    transaction_ids: list[str],
) -> dict[tuple[str, str], MpesaStatusCheck]:
    """Most recent check per (transaction_id, direction)."""
    if not transaction_ids:
        return {}

    rows = (
        db.query(MpesaStatusCheck)
        .filter(MpesaStatusCheck.transaction_id.in_(transaction_ids))
        .order_by(
            MpesaStatusCheck.requested_at.is_(None),
            MpesaStatusCheck.requested_at.asc(),
            MpesaStatusCheck.created_at.asc(),
        )
        .all()
    )
    # Ascending order means later rows overwrite earlier ones.
    return {(row.transaction_id, row.direction): row for row in rows}


def request_status_check(
    db: Session,
    *,
    transaction_id: str,
    direction: str,
    requested_by_user_id: str | None = None,
) -> MpesaStatusCheck:
    """Ask Safaricom for its record of one collection or payout (async)."""
    direction = DIRECTION_OUT if direction == DIRECTION_OUT else DIRECTION_IN

    txn = db.query(MpesaTransaction).filter(MpesaTransaction.id == transaction_id).first()
    if txn is None:
        raise MpesaApiError("Transaction not found.")

    receipt = _recorded_receipt(txn, direction)
    if not receipt:
        raise MpesaApiError(
            "This record has no M-PESA receipt, so Safaricom has nothing to look up. "
            "Simulated and unconfirmed payments cannot be verified.",
        )

    config = resolve_mpesa_config(db)
    creds = _resolve_b2b_credentials(config)
    if not creds:
        raise MpesaApiError(
            "B2B initiator credentials are not configured. "
            "Set MPESA_B2B_INITIATOR and MPESA_B2B_SECURITY_CREDENTIAL in .env "
            "(the same credentials power Transaction Status).",
        )

    initiator, security_credential = creds
    shortcode = (config.shortcode or "").strip()
    if not shortcode:
        raise MpesaApiError("Hub shortcode is not configured.")

    originator_id = uuid.uuid4().hex[:20].upper()
    result_url, timeout_url = _status_urls()
    now = _now_utc()

    row = MpesaStatusCheck(
        transaction_id=txn.id,
        direction=direction,
        queried_receipt=receipt,
        recorded_amount=_recorded_amount(txn, direction),
        originator_conversation_id=originator_id,
        status=CHECK_PENDING,
        result_desc="Transaction status query sent to Safaricom.",
        requested_by_user_id=requested_by_user_id,
        requested_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()

    payload = {
        "Initiator": initiator,
        "SecurityCredential": security_credential,
        "CommandID": "TransactionStatusQuery",
        "TransactionID": receipt,
        "OriginatorConversationID": originator_id,
        "PartyA": shortcode,
        "IdentifierType": "4",
        "ResultURL": result_url,
        "QueueTimeOutURL": timeout_url,
        "Remarks": "TransChap reconciliation",
        "Occasion": "Reconciliation",
    }

    token = fetch_access_token(config)
    url = f"{config.base_url().rstrip('/')}/mpesa/transactionstatus/v1/query"
    with httpx.Client(timeout=30) as client:
        response = client.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    body: dict[str, Any] = {}
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}

    row.callback_payload = {
        "request": {**payload, "SecurityCredential": "[redacted]"},
        "ack": body,
    }
    row.conversation_id = body.get("ConversationID") or body.get("conversationId")
    echoed = body.get("OriginatorConversationID") or body.get("originatorConversationID")
    if echoed:
        row.originator_conversation_id = str(echoed)[:100]

    if not response.is_success or str(body.get("ResponseCode", "0")) not in {"0", "00"}:
        message = (
            body.get("errorMessage")
            or body.get("ResponseDescription")
            or response.text
            or "Transaction status request failed."
        )
        row.status = CHECK_FAILED
        row.match_state = MATCH_UNRESOLVED
        row.result_desc = str(message)[:500]
        row.completed_at = _now_utc()
        row.updated_at = _now_utc()
        db.commit()
        db.refresh(row)
        raise MpesaApiError(str(message))

    row.result_desc = (
        body.get("ResponseDescription")
        or "Status query accepted. Waiting for Safaricom's result."
    )[:500]
    row.updated_at = _now_utc()
    db.commit()
    db.refresh(row)
    return row


def _find_check(db: Session, payload: dict[str, Any]) -> MpesaStatusCheck | None:
    result = payload.get("Result") or payload
    originator_id = result.get("OriginatorConversationID") or payload.get(
        "OriginatorConversationID",
    )
    conversation_id = result.get("ConversationID") or payload.get("ConversationID")

    if originator_id:
        row = (
            db.query(MpesaStatusCheck)
            .filter(MpesaStatusCheck.originator_conversation_id == str(originator_id))
            .first()
        )
        if row:
            return row

    # Conversation ids are reused across a check's lifetime, so only ever match
    # them against a check still waiting for its result.
    if conversation_id:
        row = (
            db.query(MpesaStatusCheck)
            .filter(
                MpesaStatusCheck.conversation_id == str(conversation_id),
                MpesaStatusCheck.status == CHECK_PENDING,
            )
            .first()
        )
        if row:
            return row

    # Safaricom sometimes returns its own conversation ids rather than echoing
    # ours; fall back to the receipt we asked about, which it repeats verbatim.
    receipt = _result_parameter(result, "ReceiptNo") or result.get("TransactionID")
    if receipt:
        row = (
            db.query(MpesaStatusCheck)
            .filter(
                MpesaStatusCheck.queried_receipt == str(receipt).strip(),
                MpesaStatusCheck.status == CHECK_PENDING,
            )
            .order_by(
                MpesaStatusCheck.requested_at.is_(None),
                MpesaStatusCheck.requested_at.desc(),
            )
            .first()
        )
        if row:
            if originator_id:
                row.originator_conversation_id = str(originator_id)[:100]
            return row

    logger.warning("M-PESA status callback did not match any pending check: %s", payload)
    return None


def _evaluate_match(row: MpesaStatusCheck) -> str:
    """Compare Safaricom's answer with what TransChap recorded."""
    safaricom_status = (row.safaricom_status or "").strip().lower()
    if safaricom_status and safaricom_status != "completed":
        return MATCH_STATUS_MISMATCH

    reported = _parse_amount(row.safaricom_amount)
    recorded = row.recorded_amount
    if reported is not None and recorded is not None and abs(reported - float(recorded)) > 0.01:
        return MATCH_AMOUNT_MISMATCH

    if not safaricom_status and reported is None:
        return MATCH_UNRESOLVED

    return MATCH_VERIFIED


def apply_status_result(db: Session, payload: dict[str, Any]) -> MpesaStatusCheck | None:
    row = _find_check(db, payload)
    if row is None:
        return None

    result = payload.get("Result") or {}
    result_code = result.get("ResultCode")
    row.result_code = int(result_code) if isinstance(result_code, int) else None
    row.result_desc = (result.get("ResultDesc") or "")[:500] or row.result_desc
    row.conversation_id = result.get("ConversationID") or row.conversation_id
    row.callback_payload = {
        **(row.callback_payload or {}),
        "result_callback": payload,
    }
    row.completed_at = _now_utc()
    row.updated_at = _now_utc()

    if result_code != 0:
        # Safaricom rejects unknown receipts here, which is itself a finding.
        row.status = CHECK_FAILED
        row.match_state = MATCH_NOT_FOUND
        db.commit()
        db.refresh(row)
        return row

    row.status = CHECK_SUCCESS
    row.safaricom_receipt = (
        _result_parameter(result, "ReceiptNo") or result.get("TransactionID") or None
    )
    row.safaricom_amount = _result_parameter(result, "Amount")
    row.safaricom_status = _result_parameter(result, "TransactionStatus")
    row.safaricom_completed_at = _parse_safaricom_time(
        _result_parameter(result, "FinalisedTime")
        or _result_parameter(result, "InitiatedTime"),
    )
    row.debit_party = (_result_parameter(result, "DebitPartyName") or None)
    row.credit_party = (_result_parameter(result, "CreditPartyName") or None)
    row.debit_party_charges = (_result_parameter(result, "DebitPartyCharges") or None)
    row.reason_type = (_result_parameter(result, "ReasonType") or None)
    row.match_state = _evaluate_match(row)

    db.commit()
    db.refresh(row)
    return row


def apply_status_timeout(db: Session, payload: dict[str, Any]) -> MpesaStatusCheck | None:
    row = _find_check(db, payload)
    if row is None:
        return None

    result = payload.get("Result") or payload
    row.status = CHECK_TIMEOUT
    row.match_state = MATCH_UNRESOLVED
    row.result_desc = (
        result.get("ResultDesc")
        or "Status query timed out before Safaricom returned a result."
    )[:500]
    row.callback_payload = {
        **(row.callback_payload or {}),
        "timeout_callback": payload,
    }
    row.completed_at = _now_utc()
    row.updated_at = _now_utc()
    db.commit()
    db.refresh(row)
    return row
