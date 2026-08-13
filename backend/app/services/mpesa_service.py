"""
M-PESA Express (STK Push / Lipa Na M-PESA Online) client.

Reference: https://developer.safaricom.co.ke/docs#lipa-na-m-pesa-online
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

# Safaricom validates the Timestamp field against East Africa Time (UTC+3).
# Sending a UTC timestamp here makes the request look 3 hours stale and
# Daraja returns the generic "500.001.1001 Wrong credentials" error.
EAT = timezone(timedelta(hours=3))

import httpx
from sqlalchemy.orm import Session

from app.models import MerchantMpesaProfile, MpesaConfiguration, MpesaTransaction

logger = logging.getLogger(__name__)


class MpesaConfigurationMissing(RuntimeError):
    """Raised when Daraja env credentials are incomplete."""


class MpesaApiError(RuntimeError):
    """Raised when Daraja returns an error response."""


# In-memory token cache keyed by config id (tokens are short-lived, ~1h).
_token_cache: dict[str, tuple[str, datetime]] = {}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_msisdn(raw: str) -> str:
    """Convert 07XXXXXXXX / +2547XXXXXXXX / 2547XXXXXXXX to 2547XXXXXXXX."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("254"):
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return "254" + digits[1:]
    if digits.startswith("7") or digits.startswith("1"):
        if len(digits) == 9:
            return "254" + digits
    return digits


def use_mpesa_sandbox(db: Session) -> bool:
    """Whether STK/B2B should use Daraja sandbox credentials.

    ``MPESA_MODE=production`` (or prod/live) forces live Daraja even if the
    platform Mode toggle is still Dev. ``MPESA_MODE=sandbox`` forces sandbox.
    When unset, follows platform runtime mode.
    """
    from app.config import get_settings
    from app.services.platform_runtime import is_dev_runtime

    mode = (get_settings().mpesa_mode or "").strip().lower()
    if mode in {"production", "prod", "live"}:
        return False
    if mode in {"sandbox", "dev", "development"}:
        return True
    return is_dev_runtime(db)


def get_active_config(db: Session) -> MpesaConfiguration | None:
    """Legacy DB row lookup — hub credentials now live in .env."""
    return (
        db.query(MpesaConfiguration)
        .filter(MpesaConfiguration.is_active.is_(True))
        .order_by(MpesaConfiguration.id.desc())
        .first()
    )


def resolve_mpesa_config(db: Session) -> Any:
    """Return Daraja config from env (sandbox vs production via MPESA_MODE / platform Mode)."""
    from app.support.daraja_sandbox import (
        build_daraja_production_config,
        build_daraja_sandbox_config,
        daraja_env_configured,
    )

    if use_mpesa_sandbox(db):
        sandbox = build_daraja_sandbox_config()
        if not sandbox.consumer_key or not sandbox.consumer_secret:
            raise MpesaConfigurationMissing(
                "Daraja sandbox credentials missing. Set MPESA_SANDBOX_CONSUMER_KEY "
                "and MPESA_SANDBOX_CONSUMER_SECRET in .env (from developer.safaricom.co.ke).",
            )
        if not (sandbox.passkey or "").strip():
            raise MpesaConfigurationMissing(
                "Daraja sandbox passkey missing. Set MPESA_SANDBOX_PASSKEY in .env "
                "(Lipa na M-PESA Online passkey from developer.safaricom.co.ke).",
            )
        return sandbox

    production = build_daraja_production_config()
    if not daraja_env_configured(production):
        raise MpesaConfigurationMissing(
            "Daraja production credentials missing. Set MPESA_CONSUMER_KEY, "
            "MPESA_CONSUMER_SECRET, MPESA_PASSKEY, MPESA_SHORTCODE, and optionally "
            "MPESA_CALLBACK_URL in .env, then restart the backend.",
        )
    if (production.shortcode_type or "").lower() != "paybill":
        raise MpesaConfigurationMissing(
            "Production hub collection requires MPESA_SHORTCODE_TYPE=paybill.",
        )
    return production


def fetch_access_token(config: Any, *, force_refresh: bool = False) -> str:
    """Get a Daraja OAuth access token, cached until ~5 minutes before expiry."""
    cached = _token_cache.get(str(config.id))
    if cached and not force_refresh:
        token, expires_at = cached
        if expires_at - timedelta(minutes=5) > _now_utc():
            return token

    creds = f"{config.consumer_key}:{config.consumer_secret}".encode()
    basic = base64.b64encode(creds).decode()
    url = f"{config.base_url()}/oauth/v1/generate?grant_type=client_credentials"

    with httpx.Client(timeout=30) as client:
        response = client.get(url, headers={"Authorization": f"Basic {basic}"})

    if response.status_code != 200:
        raise MpesaApiError(
            f"Daraja OAuth failed ({response.status_code}): {response.text}",
        )

    body = response.json()
    token = body.get("access_token")
    expires_in = int(body.get("expires_in", 3599))
    if not token:
        raise MpesaApiError(f"Daraja OAuth response missing access_token: {body}")

    _token_cache[str(config.id)] = (token, _now_utc() + timedelta(seconds=expires_in))
    return token


def _timestamp() -> str:
    return datetime.now(EAT).strftime("%Y%m%d%H%M%S")


def _password(shortcode: str, passkey: str, timestamp: str) -> str:
    """Base64(shortcode + passkey + timestamp) — required by Daraja."""
    return base64.b64encode(f"{shortcode}{passkey}{timestamp}".encode()).decode()


def _shortcode_transaction_type(shortcode_type: str) -> str:
    return (
        "CustomerBuyGoodsOnline"
        if (shortcode_type or "").lower() in {"till", "buygoods", "buy_goods"}
        else "CustomerPayBillOnline"
    )


def _merchant_transaction_account(profile: MerchantMpesaProfile | None) -> str | None:
    if not profile:
        return None
    tx = (profile.account_number or "").strip()
    return tx[:12] if tx else None


def _require_hub_collection_config(config: Any) -> None:
    """Hub model: all STK collections go through the platform paybill."""
    if (config.shortcode_type or "").lower() != "paybill":
        raise MpesaApiError(
            "Platform M-PESA must use a Paybill for hub collection. "
            "Set MPESA_SHORTCODE_TYPE=paybill in .env.",
        )


def get_merchant_profile(
    db: Session,
    account_id: str,
) -> MerchantMpesaProfile | None:
    return (
        db.query(MerchantMpesaProfile)
        .filter(MerchantMpesaProfile.account_id == account_id)
        .first()
    )


def stk_push(
    db: Session,
    *,
    phone_number: str,
    amount: int,
    account_reference: str,
    transaction_desc: str,
    initiated_by_user_id: str | None = None,
    account_id: str | None = None,
) -> MpesaTransaction:
    config = resolve_mpesa_config(db)
    sandbox = use_mpesa_sandbox(db)
    merchant_profile = None if sandbox else (
        get_merchant_profile(db, account_id) if account_id else None
    )

    if sandbox:
        collection_shortcode = config.shortcode.strip()
        collection_type = config.shortcode_type
        stk_account_reference = (
            account_reference[:12] or config.account_reference_prefix[:12]
        )
    else:
        if account_id:
            if not merchant_profile:
                raise MpesaApiError(
                    "M-PESA is not configured for this shop. "
                    "Add your transaction account and payout details in Settings.",
                )
            transaction_account = _merchant_transaction_account(merchant_profile)
            if not transaction_account:
                raise MpesaApiError(
                    "Your M-PESA transaction account is missing. "
                    "Add it in Settings under M-PESA Business Number.",
                )
            _require_hub_collection_config(config)
            stk_account_reference = transaction_account
        else:
            stk_account_reference = (
                account_reference[:12] or config.account_reference_prefix[:12]
            )
        collection_shortcode = config.shortcode.strip()
        collection_type = config.shortcode_type

    msisdn = normalize_msisdn(phone_number)

    if not msisdn.startswith("254") or len(msisdn) != 12:
        raise MpesaApiError(
            f"Invalid phone number: '{phone_number}'. Use 2547XXXXXXXX format.",
        )
    if amount < 1:
        raise MpesaApiError("Amount must be at least 1 KES.")
    if not config.callback_url:
        raise MpesaApiError(
            "Callback URL is required. Set it in Settings before sending requests.",
        )

    requested_amount = int(amount)
    push_amount = requested_amount
    if use_mpesa_sandbox(db) and requested_amount != 1:
        push_amount = 1
        logger.info(
            "Dev mode: STK push amount %s KES -> 1 KES (ref=%s)",
            requested_amount,
            account_reference,
        )
    amount = push_amount

    token = fetch_access_token(config)
    timestamp = _timestamp()
    payload = {
        "Password": _password(collection_shortcode, config.passkey, timestamp),
        "BusinessShortCode": collection_shortcode,
        "Timestamp": timestamp,
        "Amount": str(int(amount)),
        "PartyA": msisdn,
        "PartyB": collection_shortcode,
        "TransactionType": _shortcode_transaction_type(collection_type),
        "PhoneNumber": msisdn,
        "TransactionDesc": transaction_desc[:13] or "Payment",
        "AccountReference": stk_account_reference,
        "CallBackURL": config.callback_url,
    }

    url = f"{config.base_url()}/mpesa/stkpush/v1/processrequest"
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

    txn = MpesaTransaction(
        initiated_by_user_id=initiated_by_user_id,
        account_id=account_id,
        phone_number=msisdn,
        amount=int(amount),
        account_reference=stk_account_reference,
        transaction_desc=transaction_desc,
        merchant_request_id=body.get("MerchantRequestID"),
        checkout_request_id=body.get("CheckoutRequestID"),
        status="pending" if response.is_success else "failed",
        result_desc=body.get("ResponseDescription") or body.get("errorMessage"),
        callback_payload={
            "request": payload,
            "response": body,
            **(
                {"dev_requested_amount": requested_amount}
                if requested_amount != int(amount)
                else {}
            ),
        },
        created_at=_now_utc(),
        updated_at=_now_utc(),
    )

    if not response.is_success:
        message = (
            body.get("errorMessage")
            or body.get("ResponseDescription")
            or response.text
            or "STK push request failed."
        )
        if "500.001.1001" in str(body.get("errorCode", "")) or "wrong credentials" in message.lower():
            message = (
                "M-PESA rejected the STK push password (Wrong credentials). "
                "In dev mode, verify MPESA_SANDBOX_PASSKEY matches the Lipa na M-PESA Online "
                "passkey for your Daraja sandbox app."
            )
        txn.result_desc = message[:500]
        db.add(txn)
        db.commit()
        db.refresh(txn)
        raise MpesaApiError(message)

    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn


def query_status(db: Session, checkout_request_id: str) -> dict[str, Any]:
    """Manually query the live status of a previous STK push (in case callback is missed)."""
    config = resolve_mpesa_config(db)
    token = fetch_access_token(config)
    timestamp = _timestamp()
    payload = {
        "BusinessShortCode": config.shortcode,
        "Password": _password(config.shortcode, config.passkey, timestamp),
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id,
    }
    url = f"{config.base_url()}/mpesa/stkpushquery/v1/query"
    with httpx.Client(timeout=30) as client:
        response = client.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}
    if not response.is_success:
        raise MpesaApiError(body.get("errorMessage") or response.text)
    return body


def _stk_result_desc(result_code: int | None, safaricom_desc: str | None) -> str:
    """Map common STK ResultCodes to clearer copy for merchants/admins.

    Safaricom often returns ResultDesc \"The initiator information is invalid.\"
    for ResultCode 2001 on STK — that usually means the customer entered the
    wrong M-PESA PIN, not that hub Daraja credentials are broken.
    """
    raw = (safaricom_desc or "").strip()
    if result_code == 0:
        return raw or "The service request is processed successfully."
    if result_code == 1032:
        return "Customer cancelled the M-PESA prompt."
    if result_code == 1037:
        return "Customer did not respond to the M-PESA prompt in time."
    if result_code == 2001:
        return (
            "Wrong M-PESA PIN (Safaricom ResultCode 2001). "
            "Ask the customer to retry and enter the correct PIN."
        )
    if result_code == 1:
        return raw or "Customer has insufficient M-PESA balance."
    return raw or f"STK failed (ResultCode {result_code})."


def apply_callback(db: Session, payload: dict[str, Any]) -> MpesaTransaction | None:
    """Persist a Safaricom callback against the matching transaction.

    On a successful payment, also advances any order linked to this
    transaction from ``awaiting_payment`` → ``payment_received`` and
    stamps ``paid_at``. This keeps the cashier's order list in sync
    without needing them to manually click through the state machine.
    """
    stk = (payload.get("Body") or {}).get("stkCallback") or {}
    checkout_id = stk.get("CheckoutRequestID")
    if not checkout_id:
        logger.warning("M-PESA callback missing CheckoutRequestID: %s", payload)
        return None

    txn = (
        db.query(MpesaTransaction)
        .filter(MpesaTransaction.checkout_request_id == checkout_id)
        .first()
    )
    if not txn:
        logger.warning("M-PESA callback for unknown CheckoutRequestID %s", checkout_id)
        return None

    # Read before overwriting callback_payload with the Safaricom body.
    force_payout = bool((txn.callback_payload or {}).get("admin_force_payout"))

    result_code = stk.get("ResultCode")
    txn.result_code = int(result_code) if result_code is not None else None
    txn.result_desc = _stk_result_desc(txn.result_code, stk.get("ResultDesc"))[:500]
    txn.callback_payload = payload
    txn.updated_at = _now_utc()

    if result_code == 0:
        txn.status = "success"
        txn.completed_at = _now_utc()
        for item in (stk.get("CallbackMetadata") or {}).get("Item", []):
            if item.get("Name") == "MpesaReceiptNumber":
                txn.mpesa_receipt_number = str(item.get("Value"))[:50]
    elif result_code in (1032, 1037):
        txn.status = "cancelled"
        txn.completed_at = _now_utc()
    else:
        txn.status = "failed"
        txn.completed_at = _now_utc()

    db.flush()

    updated_order_ids: list[str] = []
    if txn.status == "success":
        updated_order_ids = _sync_linked_orders_on_success(db, txn)
        _sync_linked_bookings_on_success(db, txn)
        try:
            from app.services import mpesa_payout_service

            mpesa_payout_service.queue_payout_for_collection(
                db,
                txn,
                force=force_payout,
            )
        except Exception:
            logger.exception(
                "M-PESA merchant payout failed for collection txn=%s",
                txn.id,
            )

    db.commit()
    db.refresh(txn)

    if updated_order_ids:
        from app.services.order_notification_service import notify_order_status_change

        for order_id in updated_order_ids:
            notify_order_status_change(
                db,
                order_id,
                receipt=txn.mpesa_receipt_number,
                force=True,
            )

    return txn


def _sync_linked_orders_on_success(db: Session, txn: MpesaTransaction) -> list[str]:
    """Advance linked orders to ``payment_received`` when an STK push succeeds."""
    from app.models import Order, OrderStatusHistory
    from app.support.order_status import AWAITING_PAYMENT, PAYMENT_RECEIVED

    linked: dict[str, Order] = {}
    if txn.order_id:
        order = db.query(Order).filter(Order.id == txn.order_id).first()
        if order:
            linked[order.id] = order
    for order in db.query(Order).filter(Order.mpesa_transaction_id == txn.id).all():
        linked[order.id] = order

    if not linked:
        return []

    updated: list[str] = []
    now = _now_utc().replace(tzinfo=None)
    for order in linked.values():
        order.mpesa_transaction_id = txn.id
        order.updated_at = now
        if order.status != AWAITING_PAYMENT:
            continue

        prev = order.status
        order.status = PAYMENT_RECEIVED
        order.paid_at = now
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=prev,
                to_status=PAYMENT_RECEIVED,
                changed_by_user_id=None,
                note=(
                    f"M-PESA payment received. Receipt "
                    f"{txn.mpesa_receipt_number or '—'}."
                ),
                created_at=now,
            ),
        )
        updated.append(order.id)

    return updated


def _sync_linked_bookings_on_success(db: Session, txn: MpesaTransaction) -> list[str]:
    """Confirm pending bookings when a deposit STK succeeds."""
    from app.models import Booking
    from app.services import booking_service as booking_svc

    linked: dict[str, Booking] = {}
    booking_id = getattr(txn, "booking_id", None)
    if booking_id:
        booking = db.query(Booking).filter(Booking.id == booking_id).first()
        if booking:
            linked[booking.id] = booking
    for booking in (
        db.query(Booking).filter(Booking.deposit_mpesa_txn_id == txn.id).all()
    ):
        linked[booking.id] = booking

    updated: list[str] = []
    for booking in linked.values():
        if booking.status != "pending":
            continue
        booking.deposit_mpesa_txn_id = txn.id
        booking_svc.confirm_booking_deposit(db, booking)
        updated.append(booking.id)
    return updated

# Last Daraja OAuth test result (env-based config has no DB row to persist to).
_last_test: dict[str, Any] = {"at": None, "result": None}


def get_last_connection_test() -> tuple[datetime | None, str | None]:
    return _last_test.get("at"), _last_test.get("result")


def test_connection(db: Session, config: Any) -> str:
    """Verify credentials by fetching a Daraja OAuth token."""
    del db  # unused; kept for call-site compatibility
    try:
        fetch_access_token(config, force_refresh=True)
        _last_test["result"] = "OK"
        _last_test["at"] = _now_utc()
        return "OK"
    except Exception as exc:
        _last_test["result"] = str(exc)[:500]
        _last_test["at"] = _now_utc()
        raise


def mark_admin_force_payout(db: Session, txn: MpesaTransaction) -> MpesaTransaction:
    """Stamp a pending collection so success callbacks force B2B payout."""
    payload = dict(txn.callback_payload or {})
    payload["admin_force_payout"] = True
    txn.callback_payload = payload
    txn.updated_at = _now_utc()
    db.commit()
    db.refresh(txn)
    return txn


def simulate_successful_collection(
    db: Session,
    *,
    account_id: str,
    phone_number: str,
    amount: int,
    initiated_by_user_id: str | None = None,
) -> MpesaTransaction:
    """Create a synthetic successful hub collection for admin payment simulation."""
    import uuid

    if amount < 1:
        raise MpesaApiError("Amount must be at least 1 KES.")

    profile = get_merchant_profile(db, account_id)
    account_reference = _merchant_transaction_account(profile) or "SIMULATE"
    msisdn = normalize_msisdn(phone_number)
    if not msisdn.startswith("254") or len(msisdn) != 12:
        raise MpesaApiError(
            f"Invalid phone number: '{phone_number}'. Use 2547XXXXXXXX format.",
        )

    now = _now_utc()
    receipt = f"SIM{now.strftime('%y%m%d%H%M%S')}"[:50]
    txn = MpesaTransaction(
        initiated_by_user_id=initiated_by_user_id,
        account_id=account_id,
        phone_number=msisdn,
        amount=int(amount),
        account_reference=account_reference[:12],
        transaction_desc="Admin simulate",
        merchant_request_id=None,
        checkout_request_id=f"ADMIN-SIM-{uuid.uuid4().hex[:20].upper()}",
        status="success",
        result_code=0,
        result_desc="Admin simulated successful collection.",
        mpesa_receipt_number=receipt,
        completed_at=now,
        callback_payload={
            "admin_simulate": True,
            "admin_force_payout": True,
        },
        created_at=now,
        updated_at=now,
    )
    db.add(txn)
    db.flush()
    return txn
