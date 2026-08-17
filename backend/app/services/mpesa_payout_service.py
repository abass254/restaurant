"""
M-PESA merchant payouts after hub paybill collection.

B2B / Pochi debit Working (MMF). B2C to a merchant phone debits Utility.
Reference: https://developer.safaricom.co.ke/APIs/B2B
           https://developer.safaricom.co.ke/APIs/B2CPayment
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import MerchantMpesaProfile, MpesaTransaction, Order, User, UserMembership
from app.services.mpesa_service import (
    MpesaApiError,
    fetch_access_token,
    get_merchant_profile,
    resolve_mpesa_config,
    use_mpesa_sandbox,
)
from app.support.mpesa_amounts import min_payout_kes, require_min_amount

logger = logging.getLogger(__name__)

PAYOUT_SKIPPED = "skipped"
PAYOUT_PENDING = "pending"
PAYOUT_QUEUED = "queued"
PAYOUT_SUCCESS = "success"
PAYOUT_FAILED = "failed"

# Payout pipeline phases stored on payout_callback_payload["phase"].
PHASE_UTILITY_TO_WORKING = "utility_to_working"
PHASE_MERCHANT_PAYOUT = "merchant_payout"
UTILITY_TO_WORKING_COMMAND = "BusinessTransferFromUtilityToMMF"
B2C_COMMAND_ID = "BusinessPayment"
MISSING_DESTINATION_REASON = (
    "Merchant payout Till, Paybill, Pochi, or M-PESA phone is not configured."
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _b2b_command_id(shortcode_type: str) -> str:
    kind = (shortcode_type or "").lower()
    if kind in {"till", "buygoods", "buy_goods"}:
        return "BusinessBuyGoods"
    if kind in {"pochi", "pochi_la_biashara"}:
        return "BusinessPayToPochi"
    return "BusinessPayBill"


def _receiver_identifier_type(shortcode_type: str) -> str:
    """Safaricom RecieverIdentifierType: 1=MSISDN, 2=Till, 4=Organization shortcode."""
    kind = (shortcode_type or "").lower()
    if kind in {"pochi", "pochi_la_biashara", "phone", "b2c", "msisdn"}:
        return "1"
    if kind in {"till", "buygoods", "buy_goods"}:
        return "2"
    return "4"


def _coerce_result_code(result_code: Any) -> int | None:
    """Daraja ResultCode is usually 0/1/21; some failures are strings like SFC_IC0003."""
    if result_code is None or result_code == "":
        return None
    if isinstance(result_code, bool):
        return int(result_code)
    if isinstance(result_code, int):
        return result_code
    text = str(result_code).strip()
    if text.isdigit() or (text.startswith("-") and text[1:].isdigit()):
        return int(text)
    return None


def _result_code_token(result_code: Any) -> str:
    if result_code is None:
        return ""
    return str(result_code).strip()


def _is_pochi_destination(shortcode_type: str) -> bool:
    return (shortcode_type or "").lower() in {"pochi", "pochi_la_biashara"}


def _is_b2c_destination(shortcode_type: str) -> bool:
    """Merchant collector is a personal M-PESA phone (Daraja B2C BusinessPayment)."""
    return (shortcode_type or "").lower() in {"phone", "b2c", "msisdn"}


def _payout_request_url(config: Any, shortcode_type: str) -> str:
    base = config.base_url().rstrip("/")
    if _is_b2c_destination(shortcode_type):
        return f"{base}/mpesa/b2c/v1/paymentrequest"
    if _is_pochi_destination(shortcode_type):
        return f"{base}/mpesa/b2pochi/v1/paymentrequest"
    return f"{base}/mpesa/b2b/v1/paymentrequest"


def _build_payout_payload(
    *,
    initiator: str,
    security_credential: str,
    sender_shortcode: str,
    payout_shortcode: str,
    payout_shortcode_type: str,
    amount: int,
    account_reference: str,
    remarks: str,
    result_url: str,
    timeout_url: str,
    originator_id: str,
    occasion: str,
) -> dict[str, Any]:
    if _is_pochi_destination(payout_shortcode_type):
        return {
            "OriginatorConversationID": originator_id,
            "InitiatorName": initiator,
            "SecurityCredential": security_credential,
            "CommandID": "BusinessPayToPochi",
            "Amount": str(int(amount)),
            "PartyA": sender_shortcode,
            "PartyB": payout_shortcode,
            "Remarks": remarks[:100],
            "QueueTimeOutURL": timeout_url,
            "ResultURL": result_url,
            "Occassion": occasion[:100],
        }

    if _is_b2c_destination(payout_shortcode_type):
        return {
            "OriginatorConversationID": originator_id,
            "InitiatorName": initiator,
            "SecurityCredential": security_credential,
            "CommandID": B2C_COMMAND_ID,
            "Amount": str(int(amount)),
            "PartyA": sender_shortcode,
            "PartyB": payout_shortcode,
            "Remarks": remarks[:100],
            "QueueTimeOutURL": timeout_url,
            "ResultURL": result_url,
            "Occassion": occasion[:100],
        }

    return {
        "OriginatorConversationID": originator_id,
        "Initiator": initiator,
        "SecurityCredential": security_credential,
        "CommandID": _b2b_command_id(payout_shortcode_type),
        "SenderIdentifierType": "4",
        "RecieverIdentifierType": _receiver_identifier_type(payout_shortcode_type),
        "PartyA": sender_shortcode,
        "PartyB": payout_shortcode,
        "AccountReference": account_reference[:12],
        "Requester": sender_shortcode,
        "Remarks": remarks[:100],
        "Amount": str(int(amount)),
        "QueueTimeOutURL": timeout_url,
        "ResultURL": result_url,
        "Occassion": occasion[:100],
    }


def _build_utility_to_working_payload(
    *,
    initiator: str,
    security_credential: str,
    shortcode: str,
    amount: int,
    account_reference: str,
    remarks: str,
    result_url: str,
    timeout_url: str,
    originator_id: str,
    occasion: str,
) -> dict[str, Any]:
    """Intra-org transfer: Utility Account → Working (MMF) on the same shortcode."""
    return {
        "OriginatorConversationID": originator_id,
        "Initiator": initiator,
        "SecurityCredential": security_credential,
        "CommandID": UTILITY_TO_WORKING_COMMAND,
        "SenderIdentifierType": "4",
        "RecieverIdentifierType": "4",
        "Amount": str(int(amount)),
        "PartyA": shortcode,
        "PartyB": shortcode,
        "AccountReference": account_reference[:12],
        "Remarks": remarks[:100],
        "QueueTimeOutURL": timeout_url,
        "ResultURL": result_url,
        "Occassion": occasion[:100],
    }


def _payout_phase(txn: MpesaTransaction) -> str | None:
    payload = txn.payout_callback_payload if isinstance(txn.payout_callback_payload, dict) else {}
    phase = payload.get("phase")
    return str(phase) if phase else None


def _merge_payout_callback(
    txn: MpesaTransaction,
    **updates: Any,
) -> dict[str, Any]:
    current = txn.payout_callback_payload if isinstance(txn.payout_callback_payload, dict) else {}
    merged = {**current, **updates}
    txn.payout_callback_payload = merged
    return merged


def _payout_callback_urls(
    kind: str = "b2b",
    settings: Settings | None = None,
) -> tuple[str, str]:
    """Public Result/Timeout URLs — prefer the STK callback host (e.g. ngrok)."""
    path = "b2c" if kind == "b2c" else "b2b"
    cfg = settings or get_settings()
    callback = (cfg.mpesa_callback_url or "").strip()
    if callback:
        from urllib.parse import urlparse

        parsed = urlparse(callback)
        if parsed.scheme and parsed.netloc:
            base = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
            return f"{base}/mpesa/{path}/result", f"{base}/mpesa/{path}/timeout"
    base = cfg.app_url.rstrip("/")
    return (
        f"{base}/mpesa/{path}/result",
        f"{base}/mpesa/{path}/timeout",
    )


def _b2b_urls(settings: Settings | None = None) -> tuple[str, str]:
    return _payout_callback_urls("b2b", settings)


def _b2c_urls(settings: Settings | None = None) -> tuple[str, str]:
    return _payout_callback_urls("b2c", settings)


def _resolve_b2b_credentials(config: Any) -> tuple[str, str] | None:
    settings = get_settings()
    if getattr(config, "is_sandbox", lambda: False)():
        initiator = (settings.mpesa_sandbox_b2b_initiator or "").strip()
        credential = (settings.mpesa_sandbox_b2b_security_credential or "").strip()
        if initiator and credential:
            return initiator, credential
        return None
    initiator = (getattr(config, "b2b_initiator_name", None) or "").strip()
    credential = (getattr(config, "b2b_security_credential", None) or "").strip()
    if initiator and credential:
        return initiator, credential
    return None


def _auto_payout_enabled(config: Any) -> bool:
    """Env flags control automatic Client → DukAI → Merchant payouts."""
    settings = get_settings()
    if getattr(config, "is_sandbox", lambda: False)():
        return bool(settings.mpesa_sandbox_b2b_auto_payout)
    return bool(settings.mpesa_b2b_auto_payout)


def _utility_to_working_enabled() -> bool:
    return bool(get_settings().mpesa_b2b_utility_to_working)


def resolve_collection_account_id(db: Session, txn: MpesaTransaction) -> str | None:
    if txn.account_id:
        return txn.account_id
    if txn.order_id:
        order = db.query(Order).filter(Order.id == txn.order_id).first()
        if order and order.account_id:
            return order.account_id
    booking_id = getattr(txn, "booking_id", None)
    if booking_id:
        from app.models import Booking

        booking = db.query(Booking).filter(Booking.id == booking_id).first()
        if booking and booking.account_id:
            return booking.account_id
    if txn.initiated_by_user_id:
        membership = (
            db.query(UserMembership)
            .filter(
                UserMembership.user_id == txn.initiated_by_user_id,
                UserMembership.is_active.is_(True),
            )
            .first()
        )
        if membership and membership.account_id:
            return membership.account_id
    return None


def merchant_payout_destination(
    profile: MerchantMpesaProfile | None,
) -> tuple[str, str] | None:
    if not profile or not (profile.shortcode or "").strip():
        return None
    return profile.shortcode.strip(), profile.shortcode_type or "paybill"


def _mark_payout_skipped(
    txn: MpesaTransaction,
    *,
    reason: str,
    destination: tuple[str, str] | None = None,
) -> None:
    txn.payout_status = PAYOUT_SKIPPED
    txn.payout_result_desc = reason[:500]
    txn.payout_completed_at = _now_utc().replace(tzinfo=None)
    if destination:
        txn.payout_shortcode, txn.payout_shortcode_type = destination
    txn.payout_amount = txn.amount
    txn.updated_at = _now_utc().replace(tzinfo=None)


def create_admin_merchant_payout(
    db: Session,
    *,
    account_id: str,
    amount: int,
    initiated_by_user_id: str | None = None,
    remarks: str = "Admin merchant payout",
) -> MpesaTransaction:
    """Pay a merchant from the hub Paybill via B2B, Pochi, or B2C (no client STK collection)."""
    from app.services.mpesa_service import (
        MpesaApiError,
        get_merchant_profile,
        resolve_mpesa_config,
        _merchant_transaction_account,
    )

    if amount < 1:
        raise MpesaApiError("Amount must be at least 1 KES.")

    profile = get_merchant_profile(db, account_id)
    destination = merchant_payout_destination(profile)
    if not destination:
        raise MpesaApiError(MISSING_DESTINATION_REASON)

    require_min_amount(
        int(amount),
        min_payout_kes(destination[1], sandbox=use_mpesa_sandbox(db)),
        label="Payout",
    )

    config = resolve_mpesa_config(db)
    if not _resolve_b2b_credentials(config):
        raise MpesaApiError(
            "B2B initiator credentials are not configured. "
            "Set MPESA_B2B_INITIATOR and MPESA_B2B_SECURITY_CREDENTIAL in .env.",
        )

    account_reference = _merchant_transaction_account(profile) or "PAYOUT"
    now = _now_utc().replace(tzinfo=None)
    txn = MpesaTransaction(
        initiated_by_user_id=initiated_by_user_id,
        account_id=account_id,
        phone_number="254700000000",
        amount=int(amount),
        account_reference=account_reference[:12],
        transaction_desc=(remarks or "Admin merchant payout")[:200],
        merchant_request_id=None,
        checkout_request_id=f"ADMIN-PAYOUT-{uuid.uuid4().hex[:16].upper()}",
        status="success",
        result_code=0,
        result_desc="Admin-initiated hub → merchant payout (no client STK).",
        mpesa_receipt_number=None,
        completed_at=now,
        callback_payload={
            "admin_merchant_payout": True,
            "admin_force_payout": True,
        },
        created_at=now,
        updated_at=now,
    )
    db.add(txn)
    db.flush()

    result = queue_payout_for_collection(db, txn, force=True)
    db.commit()
    db.refresh(result or txn)
    return result or txn


def queue_payout_for_collection(
    db: Session,
    collection_txn: MpesaTransaction,
    *,
    force: bool = False,
) -> MpesaTransaction | None:
    """Send a merchant payout after a successful STK collection (B2B, Pochi, or B2C)."""
    if collection_txn.status != "success":
        return None
    # Never re-pay a completed payout, even when force=True.
    if collection_txn.payout_status == PAYOUT_SUCCESS:
        return collection_txn
    if collection_txn.payout_status in {PAYOUT_QUEUED, PAYOUT_PENDING} and not force:
        return collection_txn

    account_id = resolve_collection_account_id(db, collection_txn)
    if not account_id:
        _mark_payout_skipped(
            collection_txn,
            reason="Could not determine merchant for payout.",
        )
        db.flush()
        return collection_txn

    collection_txn.account_id = account_id
    profile = get_merchant_profile(db, account_id)
    destination = merchant_payout_destination(profile)
    if not destination:
        _mark_payout_skipped(
            collection_txn,
            reason=MISSING_DESTINATION_REASON,
        )
        db.flush()
        return collection_txn

    payout_shortcode, payout_shortcode_type = destination
    collection_txn.payout_shortcode = payout_shortcode
    collection_txn.payout_shortcode_type = payout_shortcode_type
    collection_txn.payout_amount = int(collection_txn.amount)

    min_kes = min_payout_kes(
        payout_shortcode_type,
        sandbox=use_mpesa_sandbox(db),
    )
    if int(collection_txn.payout_amount) < min_kes:
        _mark_payout_skipped(
            collection_txn,
            reason=(
                f"KES {int(collection_txn.payout_amount)} is below Safaricom's "
                f"KES {min_kes} minimum for this payout type."
            ),
            destination=destination,
        )
        db.flush()
        return collection_txn

    try:
        config = resolve_mpesa_config(db)
    except Exception as exc:
        _mark_payout_skipped(
            collection_txn,
            reason=f"M-PESA config unavailable: {exc}",
            destination=destination,
        )
        db.flush()
        return collection_txn

    if not force and not _auto_payout_enabled(config):
        # Manual release from /admin/mpesa — leave awaiting, do not mark skipped.
        collection_txn.payout_status = None
        collection_txn.payout_result_desc = (
            "At DukAI — awaiting admin send to merchant."
        )[:500]
        collection_txn.payout_completed_at = None
        collection_txn.updated_at = _now_utc().replace(tzinfo=None)
        db.flush()
        return collection_txn

    creds = _resolve_b2b_credentials(config)
    if not creds:
        _mark_payout_skipped(
            collection_txn,
            reason="B2B initiator credentials are not configured.",
            destination=destination,
        )
        db.flush()
        return collection_txn

    # Collections land in Utility. B2B/Pochi debit Working, so sweep first.
    # B2C to a merchant phone debits Utility — skip the sweep.
    if _utility_to_working_enabled() and not _is_b2c_destination(payout_shortcode_type):
        return _start_utility_to_working_sweep(
            db,
            collection_txn,
            config=config,
            creds=creds,
        )
    return _submit_merchant_payout(
        db,
        collection_txn,
        config=config,
        creds=creds,
    )


def _post_b2b_json(
    *,
    config: Any,
    url: str,
    payload: dict[str, Any],
    originator_id: str,
) -> tuple[httpx.Response, dict[str, Any]]:
    token = fetch_access_token(config)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "OriginatorConversationID": originator_id,
    }
    with httpx.Client(timeout=30) as client:
        response = client.post(url, json=payload, headers=headers)
    body: dict[str, Any] = {}
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}
    return response, body


def _apply_ack_originator(txn: MpesaTransaction, body: dict[str, Any]) -> None:
    echoed = body.get("OriginatorConversationID") or body.get("originatorConversationID")
    if echoed:
        txn.payout_originator_conversation_id = str(echoed)[:100]


def _start_utility_to_working_sweep(
    db: Session,
    collection_txn: MpesaTransaction,
    *,
    config: Any,
    creds: tuple[str, str],
) -> MpesaTransaction:
    initiator, security_credential = creds
    shortcode = config.shortcode.strip()
    originator_id = uuid.uuid4().hex[:20].upper()
    result_url, timeout_url = _b2b_urls()
    amount = int(collection_txn.payout_amount or collection_txn.amount)

    collection_txn.payout_status = PAYOUT_PENDING
    collection_txn.payout_originator_conversation_id = originator_id
    collection_txn.payout_result_desc = (
        "Moving funds Utility → Working before merchant payout…"
    )[:500]
    collection_txn.payout_completed_at = None
    collection_txn.updated_at = _now_utc().replace(tzinfo=None)
    db.flush()

    payload = _build_utility_to_working_payload(
        initiator=initiator,
        security_credential=security_credential,
        shortcode=shortcode,
        amount=amount,
        account_reference=collection_txn.account_reference or "SWEEP",
        remarks="Utility to Working for merchant payout",
        result_url=result_url,
        timeout_url=timeout_url,
        originator_id=originator_id,
        occasion=collection_txn.mpesa_receipt_number or "SWEEP",
    )
    url = f"{config.base_url().rstrip('/')}/mpesa/b2b/v1/paymentrequest"
    response, body = _post_b2b_json(
        config=config,
        url=url,
        payload=payload,
        originator_id=originator_id,
    )
    _apply_ack_originator(collection_txn, body)
    prior = (
        collection_txn.payout_callback_payload
        if isinstance(collection_txn.payout_callback_payload, dict)
        else None
    )
    collection_txn.payout_callback_payload = {
        "phase": PHASE_UTILITY_TO_WORKING,
        "utility_to_working": {
            "request": {**payload, "SecurityCredential": "[redacted]"},
            "response": body,
            "originator_conversation_id": collection_txn.payout_originator_conversation_id,
            "conversation_id": body.get("ConversationID") or body.get("conversationId"),
            "endpoint": url,
        },
        **({"prior_attempt": prior} if prior else {}),
    }

    if not response.is_success or str(body.get("ResponseCode", "0")) not in {"0", "00"}:
        message = (
            body.get("errorMessage")
            or body.get("ResponseDescription")
            or response.text
            or "Utility → Working transfer request failed."
        )
        logger.warning(
            "M-PESA Utility→Working ACK failed txn=%s (%s); trying merchant payout anyway",
            collection_txn.id,
            message,
        )
        # Utility may already be empty / funds already in Working — continue.
        return _submit_merchant_payout(db, collection_txn, config=config, creds=creds)

    collection_txn.payout_status = PAYOUT_QUEUED
    collection_txn.payout_result_desc = (
        body.get("ResponseDescription")
        or "Utility → Working queued. Merchant payout will follow."
    )[:500]
    collection_txn.updated_at = _now_utc().replace(tzinfo=None)
    db.flush()
    return collection_txn


def _submit_merchant_payout(
    db: Session,
    collection_txn: MpesaTransaction,
    *,
    config: Any | None = None,
    creds: tuple[str, str] | None = None,
) -> MpesaTransaction:
    """Send DukAI hub → merchant B2B, Pochi, or B2C after Utility→Working (or skip)."""
    if config is None:
        config = resolve_mpesa_config(db)
    if creds is None:
        creds = _resolve_b2b_credentials(config)
    if not creds:
        collection_txn.payout_status = PAYOUT_FAILED
        collection_txn.payout_result_desc = "B2B initiator credentials are not configured."
        collection_txn.payout_completed_at = _now_utc().replace(tzinfo=None)
        collection_txn.updated_at = _now_utc().replace(tzinfo=None)
        db.flush()
        return collection_txn

    initiator, security_credential = creds
    sender_shortcode = config.shortcode.strip()
    payout_shortcode = (collection_txn.payout_shortcode or "").strip()
    payout_shortcode_type = collection_txn.payout_shortcode_type or "paybill"
    if not payout_shortcode:
        collection_txn.payout_status = PAYOUT_FAILED
        collection_txn.payout_result_desc = "Merchant payout destination is missing."
        collection_txn.payout_completed_at = _now_utc().replace(tzinfo=None)
        collection_txn.updated_at = _now_utc().replace(tzinfo=None)
        db.flush()
        return collection_txn

    payout_amount = int(collection_txn.payout_amount or collection_txn.amount)
    min_kes = min_payout_kes(
        payout_shortcode_type,
        sandbox=use_mpesa_sandbox(db),
    )
    if payout_amount < min_kes:
        collection_txn.payout_status = PAYOUT_SKIPPED
        collection_txn.payout_result_desc = (
            f"KES {payout_amount} is below Safaricom's KES {min_kes} "
            "minimum for this payout type."
        )[:500]
        collection_txn.payout_completed_at = _now_utc().replace(tzinfo=None)
        collection_txn.updated_at = _now_utc().replace(tzinfo=None)
        db.flush()
        return collection_txn

    originator_id = uuid.uuid4().hex[:20].upper()
    result_url, timeout_url = (
        _b2c_urls() if _is_b2c_destination(payout_shortcode_type) else _b2b_urls()
    )

    if _is_b2c_destination(payout_shortcode_type):
        pending_desc = "B2C payout request sent."
    elif _is_pochi_destination(payout_shortcode_type):
        pending_desc = "Pochi payout request sent."
    else:
        pending_desc = "B2B payout request sent."

    collection_txn.payout_status = PAYOUT_PENDING
    collection_txn.payout_originator_conversation_id = originator_id
    collection_txn.payout_result_desc = pending_desc
    collection_txn.payout_completed_at = None
    collection_txn.updated_at = _now_utc().replace(tzinfo=None)
    db.flush()

    payload = _build_payout_payload(
        initiator=initiator,
        security_credential=security_credential,
        sender_shortcode=sender_shortcode,
        payout_shortcode=payout_shortcode,
        payout_shortcode_type=payout_shortcode_type,
        amount=int(collection_txn.payout_amount or collection_txn.amount),
        account_reference=collection_txn.account_reference or "PAYOUT",
        remarks=collection_txn.transaction_desc or "Merchant payout",
        result_url=result_url,
        timeout_url=timeout_url,
        originator_id=originator_id,
        occasion=collection_txn.mpesa_receipt_number or "PAYOUT",
    )
    url = _payout_request_url(config, payout_shortcode_type)
    response, body = _post_b2b_json(
        config=config,
        url=url,
        payload=payload,
        originator_id=originator_id,
    )
    _apply_ack_originator(collection_txn, body)
    _merge_payout_callback(
        collection_txn,
        phase=PHASE_MERCHANT_PAYOUT,
        merchant_payout={
            "request": {**payload, "SecurityCredential": "[redacted]"},
            "response": body,
            "originator_conversation_id": collection_txn.payout_originator_conversation_id,
            "conversation_id": body.get("ConversationID") or body.get("conversationId"),
            "endpoint": url,
        },
        # Keep compatibility with older lookup paths.
        request={**payload, "SecurityCredential": "[redacted]"},
        response=body,
        originator_conversation_id=collection_txn.payout_originator_conversation_id,
        conversation_id=body.get("ConversationID") or body.get("conversationId"),
        endpoint=url,
    )

    if not response.is_success or str(body.get("ResponseCode", "0")) not in {"0", "00"}:
        message = (
            body.get("errorMessage")
            or body.get("ResponseDescription")
            or response.text
            or "Merchant payout request failed."
        )
        collection_txn.payout_status = PAYOUT_FAILED
        collection_txn.payout_result_desc = str(message)[:500]
        collection_txn.payout_completed_at = _now_utc().replace(tzinfo=None)
        collection_txn.updated_at = _now_utc().replace(tzinfo=None)
        db.flush()
        logger.warning(
            "M-PESA merchant payout request failed txn=%s: %s",
            collection_txn.id,
            message,
        )
        return collection_txn

    collection_txn.payout_status = PAYOUT_QUEUED
    collection_txn.payout_result_desc = (
        body.get("ResponseDescription") or "Merchant payout queued. Awaiting Safaricom result."
    )[:500]
    collection_txn.updated_at = _now_utc().replace(tzinfo=None)
    db.flush()
    return collection_txn


def release_collection_to_merchant(
    db: Session,
    *,
    transaction_id: str,
) -> MpesaTransaction:
    """Admin: send a received Client → DukAI collection to the merchant."""
    from app.services.mpesa_service import MpesaApiError

    txn = db.query(MpesaTransaction).filter(MpesaTransaction.id == transaction_id).first()
    if txn is None:
        raise MpesaApiError("Transaction not found.")

    payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
    if payload.get("admin_merchant_payout"):
        raise MpesaApiError("This row is already a hub → merchant payout, not a client collection.")

    if txn.status != "success":
        raise MpesaApiError("Only successful Client → DukAI collections can be sent to a merchant.")

    has_receipt = bool((txn.mpesa_receipt_number or "").strip()) or bool(
        payload.get("admin_simulate"),
    )
    if not has_receipt:
        raise MpesaApiError("Collection is not confirmed at DukAI yet (no M-PESA receipt).")

    if txn.payout_status == PAYOUT_SUCCESS:
        raise MpesaApiError("This payment was already sent to the merchant.")

    if txn.payout_status in {PAYOUT_QUEUED, PAYOUT_PENDING}:
        raise MpesaApiError(
            "A payout is already in progress for this collection. Wait for Safaricom’s result.",
        )

    result = queue_payout_for_collection(db, txn, force=True)
    if result is None:
        raise MpesaApiError("Could not start merchant payout.")

    # Persist queued / failed / skipped before responding so the admin UI can
    # show Retry after an immediate Daraja rejection.
    db.commit()
    db.refresh(result)

    if result.payout_status in {PAYOUT_SKIPPED, PAYOUT_FAILED}:
        raise MpesaApiError(
            result.payout_result_desc or "Merchant payout could not be sent.",
        )

    return result


def unlock_payout_for_retry(
    db: Session,
    *,
    transaction_id: str,
    reason: str | None = None,
) -> MpesaTransaction:
    """Admin: mark a stuck pending/queued B2B payout as failed so Retry send appears."""
    from app.services.mpesa_service import MpesaApiError

    txn = db.query(MpesaTransaction).filter(MpesaTransaction.id == transaction_id).first()
    if txn is None:
        raise MpesaApiError("Transaction not found.")

    payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
    if payload.get("admin_merchant_payout"):
        raise MpesaApiError("Cannot unlock a standalone hub → merchant payout row.")

    if txn.payout_status == PAYOUT_SUCCESS:
        raise MpesaApiError("This payment was already sent to the merchant.")

    if txn.payout_status not in {PAYOUT_QUEUED, PAYOUT_PENDING}:
        raise MpesaApiError(
            "Only in-progress (pending/queued) payouts can be unlocked. "
            f"Current status: {txn.payout_status or 'none'}.",
        )

    note = (reason or "").strip() or (
        "Unlocked by admin — marked failed so payout can be retried without waiting on Safaricom."
    )
    txn.payout_status = PAYOUT_FAILED
    txn.payout_result_desc = note[:500]
    txn.payout_completed_at = _now_utc().replace(tzinfo=None)
    txn.updated_at = _now_utc().replace(tzinfo=None)
    txn.payout_callback_payload = {
        **(txn.payout_callback_payload or {}),
        "admin_unlock": {
            "at": _now_utc().replace(tzinfo=None).isoformat(),
            "reason": note[:500],
        },
    }
    db.commit()
    db.refresh(txn)
    return txn


def _reference_item_value(container: dict[str, Any], name: str) -> str | None:
    ref = container.get("ReferenceData") or {}
    items = ref.get("ReferenceItem")
    if isinstance(items, dict):
        items = [items]
    for item in items or []:
        if item.get("Key") == name:
            value = item.get("Value")
            return str(value) if value is not None else None
    return None


def _find_txn_for_b2b_callback(
    db: Session,
    payload: dict[str, Any],
) -> MpesaTransaction | None:
    """Resolve a payout row for a Safaricom B2B result/timeout callback."""
    result = payload.get("Result") or payload
    originator_id = (
        result.get("OriginatorConversationID")
        or payload.get("OriginatorConversationID")
    )
    if originator_id:
        txn = (
            db.query(MpesaTransaction)
            .filter(
                MpesaTransaction.payout_originator_conversation_id == str(originator_id)
            )
            .first()
        )
        if txn:
            return txn

        # Older rows stored our local id; Safaricom's echoed id may only be in ACK JSON.
        in_flight = (
            db.query(MpesaTransaction)
            .filter(MpesaTransaction.payout_status.in_([PAYOUT_QUEUED, PAYOUT_PENDING]))
            .order_by(MpesaTransaction.updated_at.desc())
            .limit(75)
            .all()
        )
        for candidate in in_flight:
            stored = candidate.payout_callback_payload or {}
            ack_blobs = [
                stored.get("response") or {},
                (stored.get("utility_to_working") or {}).get("response") or {},
                (stored.get("merchant_payout") or {}).get("response") or {},
            ]
            echoed_ids = [
                stored.get("originator_conversation_id"),
                (stored.get("utility_to_working") or {}).get("originator_conversation_id"),
                (stored.get("merchant_payout") or {}).get("originator_conversation_id"),
            ]
            for ack in ack_blobs:
                echoed_ids.extend(
                    [
                        ack.get("OriginatorConversationID"),
                        ack.get("originatorConversationID"),
                    ]
                )
            if any(echoed and str(echoed) == str(originator_id) for echoed in echoed_ids):
                candidate.payout_originator_conversation_id = str(originator_id)[:100]
                return candidate

    bill_ref = _reference_item_value(result, "BillReferenceNumber")
    if bill_ref:
        matches = (
            db.query(MpesaTransaction)
            .filter(
                MpesaTransaction.payout_status.in_([PAYOUT_QUEUED, PAYOUT_PENDING]),
                MpesaTransaction.account_reference == str(bill_ref)[:12],
            )
            .all()
        )
        if len(matches) == 1:
            txn = matches[0]
            if originator_id:
                txn.payout_originator_conversation_id = str(originator_id)[:100]
            return txn

    if originator_id:
        logger.warning(
            "M-PESA B2B callback for unknown OriginatorConversationID %s",
            originator_id,
        )
    else:
        logger.warning("M-PESA B2B callback missing OriginatorConversationID: %s", payload)
    return None


def _result_desc(result: dict[str, Any]) -> str:
    base_desc = (result.get("ResultDesc") or "").strip()
    error_msg = (_result_parameter(result, "ErrorMsg") or "").strip()
    if error_msg and error_msg.lower() not in base_desc.lower():
        base_desc = f"{base_desc} ({error_msg})".strip(" ()") if base_desc else error_msg
    return base_desc


def _rewrite_payout_limit_desc(desc: str, dest_type: str) -> str:
    """Turn Safaricom org-portal limit copy into an actionable DukAI message."""
    lower = (desc or "").lower()
    if not any(
        token in lower
        for token in (
            "limit rule",
            "minimum business payment",
            "minimum transaction amount",
            "less than the minimum",
        )
    ):
        return desc
    from app.support.mpesa_amounts import min_payout_kes

    min_kes = min_payout_kes(dest_type, sandbox=False)
    if _is_b2c_destination(dest_type):
        return (
            f"Safaricom blocked this phone payout: Business Payment to Customer "
            f"is below the org minimum (usually KES {min_kes}+). Send at least "
            f"KES {min_kes}, or on the M-PESA org portal lower the limit rule "
            "'Minimum Business Payment To Customer'."
        )
    return (
        f"Safaricom blocked this payout under a minimum amount rule. "
        f"Send at least KES {min_kes}."
    )


def _rewrite_invalid_receiver_desc(
    desc: str,
    *,
    dest_type: str,
    shortcode: str,
    result_code: Any,
) -> str:
    token = _result_code_token(result_code).upper()
    lower = (desc or "").lower()
    if token != "SFC_IC0003" and "receiver party is invalid" not in lower:
        return desc
    kind = (dest_type or "").lower()
    dest = (shortcode or "").strip() or "this destination"
    if kind in {"till", "buygoods", "buy_goods"}:
        return (
            f"Safaricom rejected till {dest} (SFC_IC0003). "
            "Use the Lipa Na M-PESA Buy Goods till shown to customers, "
            "not a store number or Paybill."
        )
    if kind in {"paybill", "shortcode"}:
        return (
            f"Safaricom rejected Paybill {dest} (SFC_IC0003). "
            "Confirm the Paybill is active."
        )
    return desc or "Safaricom rejected the payout receiver (SFC_IC0003)."


def apply_b2b_result(db: Session, payload: dict[str, Any]) -> MpesaTransaction | None:
    """Persist a Safaricom B2B ResultURL callback (sweep or merchant payout)."""
    result = payload.get("Result") or {}
    txn = _find_txn_for_b2b_callback(db, payload)
    if not txn:
        return None

    phase = _payout_phase(txn) or PHASE_MERCHANT_PAYOUT
    result_code = result.get("ResultCode")
    code = _coerce_result_code(result_code)
    base_desc = _result_desc(result)

    if phase == PHASE_UTILITY_TO_WORKING:
        sweep_meta = {
            **((txn.payout_callback_payload or {}).get("utility_to_working") or {}),
            "result_callback": payload,
            "result_code": code,
            "result_code_raw": result_code,
            "result_desc": base_desc[:500] or None,
        }
        _merge_payout_callback(txn, utility_to_working=sweep_meta)
        txn.updated_at = _now_utc().replace(tzinfo=None)

        if code == 0:
            txn.payout_result_desc = (
                "Utility → Working succeeded. Sending to merchant…"
            )[:500]
            db.flush()
            logger.info(
                "M-PESA Utility→Working ok txn=%s; starting merchant payout",
                txn.id,
            )
            _submit_merchant_payout(db, txn)
            db.commit()
            db.refresh(txn)
            return txn

        # Sweep failed — if Utility is empty, Working may already hold funds.
        insufficient = code == 1 or "insufficient" in base_desc.lower()
        not_allowed = code == 21 or "not allowed" in base_desc.lower()
        if insufficient:
            txn.payout_result_desc = (
                f"Utility → Working skipped ({base_desc or 'insufficient'}). "
                "Trying merchant payout from Working…"
            )[:500]
            db.flush()
            logger.warning(
                "M-PESA Utility→Working insufficient txn=%s; trying merchant payout",
                txn.id,
            )
            _submit_merchant_payout(db, txn)
            db.commit()
            db.refresh(txn)
            return txn

        txn.payout_status = PAYOUT_FAILED
        txn.payout_result_code = code
        if not_allowed:
            initiator = (get_settings().mpesa_b2b_initiator or "your API operator").strip()
            txn.payout_result_desc = (
                "Utility → Working blocked: B2B initiator is not allowed to run "
                "BusinessTransferFromUtilityToMMF. On the M-PESA org portal, enable "
                f"B2B Intra Account Transfer (Utility → Working/MMF) for initiator "
                f"{initiator}, or move funds manually then set "
                "MPESA_B2B_UTILITY_TO_WORKING=false and Retry send."
            )[:500]
        else:
            txn.payout_result_desc = (
                f"Utility → Working failed: {base_desc or 'unknown error'}"
            )[:500]
        txn.payout_completed_at = _now_utc().replace(tzinfo=None)
        db.commit()
        db.refresh(txn)
        return txn

    # Merchant payout result.
    txn.payout_result_code = code
    dest_type = txn.payout_shortcode_type or ""
    not_allowed = code == 21 or "not allowed" in base_desc.lower()
    base_desc = _rewrite_payout_limit_desc(base_desc, dest_type)
    base_desc = _rewrite_invalid_receiver_desc(
        base_desc,
        dest_type=dest_type,
        shortcode=txn.payout_shortcode or "",
        result_code=result_code,
    )
    if code is None and _result_code_token(result_code):
        token = _result_code_token(result_code)
        if token.upper() not in (base_desc or "").upper():
            base_desc = f"{base_desc} ({token})".strip() if base_desc else token
    if code == 1 or "insufficient" in base_desc.lower():
        if _is_b2c_destination(dest_type):
            base_desc = (
                f"{base_desc} "
                "B2C debits the Utility account. Confirm Utility has funds on the M-PESA org portal."
            ).strip()
        else:
            base_desc = (
                f"{base_desc} "
                "B2B debits the Working account. Auto Utility→Working may have failed — "
                "check both balances on the M-PESA org portal."
            ).strip()
    elif not_allowed and _is_b2c_destination(dest_type):
        initiator = (get_settings().mpesa_b2b_initiator or "your API operator").strip()
        base_desc = (
            "B2C blocked: initiator is not allowed to send BusinessPayment to a phone. "
            f"On the M-PESA org portal, enable B2C for initiator {initiator}."
        )
    txn.payout_result_desc = base_desc[:500] or None
    _merge_payout_callback(
        txn,
        result_callback=payload,
        merchant_payout={
            **((txn.payout_callback_payload or {}).get("merchant_payout") or {}),
            "result_callback": payload,
        },
    )
    txn.updated_at = _now_utc().replace(tzinfo=None)

    if code == 0:
        txn.payout_status = PAYOUT_SUCCESS
        txn.payout_receipt_number = (
            result.get("TransactionID")
            or _result_parameter(result, "TransactionReceipt")
            or txn.payout_receipt_number
        )
        txn.payout_completed_at = _now_utc().replace(tzinfo=None)
    else:
        txn.payout_status = PAYOUT_FAILED
        txn.payout_completed_at = _now_utc().replace(tzinfo=None)

    db.commit()
    db.refresh(txn)
    return txn


def apply_b2b_timeout(db: Session, payload: dict[str, Any]) -> MpesaTransaction | None:
    """Handle QueueTimeOutURL when Safaricom does not return a result in time."""
    result = payload.get("Result") or payload
    txn = _find_txn_for_b2b_callback(db, payload)
    if not txn or txn.payout_status == PAYOUT_SUCCESS:
        return None

    phase = _payout_phase(txn) or PHASE_MERCHANT_PAYOUT
    if phase == PHASE_UTILITY_TO_WORKING:
        # Sweep timed out — try merchant payout anyway in case Working already funded.
        _merge_payout_callback(
            txn,
            utility_to_working={
                **((txn.payout_callback_payload or {}).get("utility_to_working") or {}),
                "timeout_callback": payload,
            },
        )
        txn.payout_result_desc = (
            "Utility → Working timed out. Trying merchant payout from Working…"
        )[:500]
        db.flush()
        logger.warning(
            "M-PESA Utility→Working timeout txn=%s; trying merchant payout",
            txn.id,
        )
        _submit_merchant_payout(db, txn)
        db.commit()
        db.refresh(txn)
        return txn

    txn.payout_status = PAYOUT_FAILED
    txn.payout_result_desc = (
        result.get("ResultDesc") or "Merchant payout timed out before Safaricom returned a result."
    )[:500]
    _merge_payout_callback(txn, timeout_callback=payload)
    txn.payout_completed_at = _now_utc().replace(tzinfo=None)
    txn.updated_at = _now_utc().replace(tzinfo=None)
    db.commit()
    db.refresh(txn)
    return txn


def _result_parameter(result: dict[str, Any], name: str) -> str | None:
    parameters = result.get("ResultParameters") or {}
    items = parameters.get("ResultParameter", []) or []
    if isinstance(items, dict):
        items = [items]
    for item in items:
        if item.get("Key") == name:
            value = item.get("Value")
            return str(value) if value is not None else None
    return None


def retry_payout(db: Session, collection_txn: MpesaTransaction) -> MpesaTransaction:
    if collection_txn.status != "success":
        raise MpesaApiError("Only successful collections can be paid out.")
    collection_txn.payout_status = None
    collection_txn.payout_originator_conversation_id = None
    collection_txn.payout_result_code = None
    collection_txn.payout_result_desc = None
    collection_txn.payout_receipt_number = None
    collection_txn.payout_completed_at = None
    # Keep last attempt for audit but start a clean Utility→Working → merchant pipeline.
    if isinstance(collection_txn.payout_callback_payload, dict):
        collection_txn.payout_callback_payload = {
            "prior_attempt": collection_txn.payout_callback_payload,
        }
    db.flush()
    result = queue_payout_for_collection(db, collection_txn, force=True)
    if result is None:
        raise MpesaApiError("Payout could not be started.")
    db.commit()
    db.refresh(result)
    return result
