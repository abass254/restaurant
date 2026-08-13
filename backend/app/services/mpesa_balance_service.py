"""
Daraja Account Balance queries for the DukAI hub Paybill.

Reference: https://developer.safaricom.co.ke/APIs/AccountBalance
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.models import MpesaHubBalanceQuery
from app.services.mpesa_payout_service import _b2b_urls, _resolve_b2b_credentials
from app.services.mpesa_service import (
    MpesaApiError,
    fetch_access_token,
    resolve_mpesa_config,
)

logger = logging.getLogger(__name__)

BALANCE_PENDING = "pending"
BALANCE_SUCCESS = "success"
BALANCE_FAILED = "failed"
BALANCE_TIMEOUT = "timeout"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _balance_urls() -> tuple[str, str]:
    """Reuse the public host from MPESA_CALLBACK_URL / APP_URL."""
    result_url, timeout_url = _b2b_urls()
    # /mpesa/b2b/result → /mpesa/balance/result
    base = result_url.rsplit("/mpesa/", 1)[0]
    return f"{base}/mpesa/balance/result", f"{base}/mpesa/balance/timeout"


def _result_parameter(result: dict[str, Any], key: str) -> str | None:
    params = (result.get("ResultParameters") or {}).get("ResultParameter") or []
    if isinstance(params, dict):
        params = [params]
    for item in params:
        if item.get("Key") == key:
            value = item.get("Value")
            return None if value is None else str(value)
    return None


def _parse_account_balances(raw: str | None) -> dict[str, str]:
    """Parse Safaricom AccountBalance string into named balances.

    Typical form:
    ``Working Account|KES|385.00&Utility Account|KES|0.00&Charges Paid Account|KES|0.00``
    """
    out: dict[str, str] = {}
    if not raw:
        return out
    for part in str(raw).split("&"):
        bit = part.strip()
        if not bit:
            continue
        pieces = [p.strip() for p in bit.split("|")]
        if len(pieces) >= 3:
            name, currency, amount = pieces[0], pieces[1], pieces[2]
            out[name.lower()] = f"{currency} {amount}".strip()
        elif len(pieces) == 2:
            out[pieces[0].lower()] = pieces[1]
        else:
            match = re.match(r"^(.+?)\s+([A-Z]{3})\s+([\d.,]+)$", bit, re.I)
            if match:
                out[match.group(1).lower()] = f"{match.group(2)} {match.group(3)}"
    return out


def _pick_balance(parsed: dict[str, str], *needles: str) -> str | None:
    for key, value in parsed.items():
        for needle in needles:
            if needle in key:
                return value
    return None


def get_latest_balance(db: Session) -> MpesaHubBalanceQuery | None:
    return (
        db.query(MpesaHubBalanceQuery)
        .order_by(
            MpesaHubBalanceQuery.requested_at.is_(None),
            MpesaHubBalanceQuery.requested_at.desc(),
            MpesaHubBalanceQuery.created_at.is_(None),
            MpesaHubBalanceQuery.created_at.desc(),
        )
        .first()
    )


def request_hub_balance(
    db: Session,
    *,
    requested_by_user_id: str | None = None,
) -> MpesaHubBalanceQuery:
    """Kick off an async Daraja Account Balance query for the hub shortcode."""
    config = resolve_mpesa_config(db)
    creds = _resolve_b2b_credentials(config)
    if not creds:
        raise MpesaApiError(
            "B2B initiator credentials are not configured. "
            "Set MPESA_B2B_INITIATOR and MPESA_B2B_SECURITY_CREDENTIAL in .env "
            "(same credentials power Account Balance).",
        )

    initiator, security_credential = creds
    shortcode = (config.shortcode or "").strip()
    if not shortcode:
        raise MpesaApiError("Hub shortcode is not configured.")

    originator_id = uuid.uuid4().hex[:20].upper()
    result_url, timeout_url = _balance_urls()
    now = _now_utc()

    row = MpesaHubBalanceQuery(
        shortcode=shortcode,
        originator_conversation_id=originator_id,
        status=BALANCE_PENDING,
        result_desc="Balance query sent to Safaricom.",
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
        "CommandID": "AccountBalance",
        "PartyA": shortcode,
        "IdentifierType": "4",
        "Remarks": "DukAI hub balance",
        "QueueTimeOutURL": timeout_url,
        "ResultURL": result_url,
    }

    token = fetch_access_token(config)
    url = f"{config.base_url().rstrip('/')}/mpesa/accountbalance/v1/query"
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

    row.callback_payload = {"request": {**payload, "SecurityCredential": "[redacted]"}, "ack": body}
    row.conversation_id = body.get("ConversationID") or body.get("conversationId")
    # Prefer Safaricom's originator id when echoed back.
    echoed = body.get("OriginatorConversationID") or body.get("originatorConversationID")
    if echoed:
        row.originator_conversation_id = str(echoed)[:100]

    if not response.is_success or str(body.get("ResponseCode", "0")) not in {"0", "00"}:
        message = (
            body.get("errorMessage")
            or body.get("ResponseDescription")
            or response.text
            or "Account balance request failed."
        )
        row.status = BALANCE_FAILED
        row.result_desc = str(message)[:500]
        row.completed_at = _now_utc()
        row.updated_at = _now_utc()
        db.commit()
        db.refresh(row)
        raise MpesaApiError(str(message))

    row.result_desc = (
        body.get("ResponseDescription") or "Balance query accepted. Waiting for Safaricom result."
    )[:500]
    row.updated_at = _now_utc()
    db.commit()
    db.refresh(row)
    return row


def apply_balance_result(db: Session, payload: dict[str, Any]) -> MpesaHubBalanceQuery | None:
    result = payload.get("Result") or {}
    originator_id = (
        result.get("OriginatorConversationID")
        or payload.get("OriginatorConversationID")
    )
    if not originator_id:
        logger.warning("M-PESA balance callback missing OriginatorConversationID: %s", payload)
        return None

    row = (
        db.query(MpesaHubBalanceQuery)
        .filter(MpesaHubBalanceQuery.originator_conversation_id == str(originator_id))
        .first()
    )
    if not row:
        logger.warning(
            "M-PESA balance callback for unknown OriginatorConversationID %s",
            originator_id,
        )
        return None

    result_code = result.get("ResultCode")
    row.result_code = int(result_code) if result_code is not None else None
    row.result_desc = (result.get("ResultDesc") or "")[:500]
    row.conversation_id = result.get("ConversationID") or row.conversation_id
    row.callback_payload = {
        **(row.callback_payload or {}),
        "result_callback": payload,
    }
    row.updated_at = _now_utc()

    if result_code == 0:
        raw = _result_parameter(result, "AccountBalance")
        row.balances_raw = raw
        parsed = _parse_account_balances(raw)
        row.working_balance = _pick_balance(parsed, "working")
        row.utility_balance = _pick_balance(parsed, "utility")
        row.charges_balance = _pick_balance(parsed, "charges")
        row.status = BALANCE_SUCCESS
        row.completed_at = _now_utc()
    else:
        row.status = BALANCE_FAILED
        row.completed_at = _now_utc()

    db.commit()
    db.refresh(row)
    return row


def apply_balance_timeout(db: Session, payload: dict[str, Any]) -> MpesaHubBalanceQuery | None:
    result = payload.get("Result") or payload
    originator_id = (
        result.get("OriginatorConversationID")
        or payload.get("OriginatorConversationID")
    )
    if not originator_id:
        return None

    row = (
        db.query(MpesaHubBalanceQuery)
        .filter(MpesaHubBalanceQuery.originator_conversation_id == str(originator_id))
        .first()
    )
    if not row:
        return None

    row.status = BALANCE_TIMEOUT
    row.result_desc = (
        result.get("ResultDesc")
        or "Account balance query timed out before Safaricom returned a result."
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
