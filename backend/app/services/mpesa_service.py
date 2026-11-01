"""
M-PESA Express (STK Push / Lipa Na M-PESA Online) client.

Reference: https://developer.safaricom.co.ke/docs#lipa-na-m-pesa-online
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from dataclasses import dataclass

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


def is_kenya_msisdn(raw: str) -> bool:
    """True when ``raw`` normalizes to a 12-digit Kenyan M-PESA MSISDN (2547/2541)."""
    msisdn = normalize_msisdn(raw)
    return msisdn.startswith("254") and len(msisdn) == 12 and msisdn[3] in {"7", "1"}


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
    shop_customer_id: str | None = None,
    credit_collect_amount: int | None = None,
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
                    "Add payout details under Store basics.",
                )
            transaction_account = _merchant_transaction_account(merchant_profile)
            dest_type = (merchant_profile.shortcode_type or "").lower()
            if dest_type == "paybill" and not transaction_account:
                raise MpesaApiError(
                    "Your Paybill account number is missing. "
                    "Add it under Store basics → Payment terms.",
                )
            _require_hub_collection_config(config)
            stk_account_reference = (
                transaction_account
                or account_reference[:12]
                or config.account_reference_prefix[:12]
            )
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
    dest_type = (
        merchant_profile.shortcode_type if merchant_profile else None
    )
    from app.support.mpesa_amounts import min_collection_kes, require_min_amount

    require_min_amount(
        int(amount),
        min_collection_kes(dest_type, sandbox=sandbox),
        label="Payment",
    )
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
        shop_customer_id=shop_customer_id,
        credit_collect_amount=credit_collect_amount,
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


def refresh_pending_stk(
    db: Session,
    txn: MpesaTransaction,
    *,
    auto_payout: bool = True,
) -> str:
    """Ask Daraja whether a waiting STK already finished, and apply the result.

    Returns ``paid``, ``failed``, or ``pending``.

    STK Push Query answers with a result code but never an M-PESA receipt, so a
    row settled this way is stamped ``safaricom_confirmed`` instead. That marker
    stands in for the receipt when deciding whether money reached TransChap.

    Pass ``auto_payout=False`` to settle the collection without releasing funds
    to the merchant, leaving that to a deliberate admin action.
    """
    if txn.status == "success" and bool((txn.mpesa_receipt_number or "").strip()):
        return "paid"
    checkout_id = (txn.checkout_request_id or "").strip()
    if not checkout_id:
        return "pending" if txn.status == "pending" else "failed"

    try:
        body = query_status(db, checkout_id)
    except MpesaApiError as exc:
        message = str(exc).lower()
        if "being processed" in message or "500.001.1001" in message:
            return "pending"
        raise

    raw_code = body.get("ResultCode")
    try:
        code = int(raw_code) if raw_code is not None and str(raw_code) != "" else None
    except (TypeError, ValueError):
        code = None
    if code is None:
        return "pending" if txn.status == "pending" else "failed"

    txn.result_code = code
    txn.result_desc = _stk_result_desc(code, body.get("ResultDesc"))[:500]
    txn.updated_at = _now_utc()
    payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
    txn.callback_payload = {**payload, "stk_query": body}

    if code == 0:
        txn.status = "success"
        txn.completed_at = _now_utc()
        txn.callback_payload = {
            **(txn.callback_payload or {}),
            "safaricom_confirmed": {
                "source": "stk_push_query",
                "at": _now_utc().isoformat(),
                "result_desc": body.get("ResultDesc"),
            },
        }
        db.flush()
        updated_order_ids = _sync_linked_orders_on_success(db, txn)
        _sync_linked_bookings_on_success(db, txn)
        apply_credit_collection_if_paid(db, txn)
        if auto_payout:
            try:
                from app.services import mpesa_payout_service

                mpesa_payout_service.queue_payout_for_collection(db, txn)
            except Exception:
                logger.exception(
                    "M-PESA merchant payout failed after STK query txn=%s",
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
        return "paid"

    txn.status = "cancelled" if code in (1032, 1037) else "failed"
    txn.completed_at = _now_utc()
    db.commit()
    db.refresh(txn)
    return "failed"


def retry_stk_transaction(
    db: Session,
    txn: MpesaTransaction,
    *,
    initiated_by_user_id: str | None = None,
) -> tuple[MpesaTransaction, str, str]:
    """Complete a waiting STK if Safaricom already has it, otherwise send a new prompt."""
    if txn.status == "success" and bool((txn.mpesa_receipt_number or "").strip()):
        raise MpesaApiError("This payment is already complete.")

    outcome = "failed"
    if txn.status == "pending":
        outcome = refresh_pending_stk(db, txn)
        if outcome == "paid":
            return txn, "paid", "The customer already paid. This sale is now complete."

    new_txn = stk_push(
        db,
        phone_number=txn.phone_number,
        amount=int(txn.amount),
        account_reference=txn.account_reference,
        transaction_desc=txn.transaction_desc or "Payment",
        initiated_by_user_id=initiated_by_user_id,
        account_id=txn.account_id,
        shop_customer_id=txn.shop_customer_id,
        credit_collect_amount=txn.credit_collect_amount,
    )

    if txn.status == "pending" and txn.id != new_txn.id:
        txn.status = "cancelled"
        txn.result_desc = "Prompt resent. Previous M-PESA prompt was replaced."
        txn.completed_at = _now_utc()
        txn.updated_at = _now_utc()
        db.add(txn)

    if txn.order_id:
        from app.models import Order
        from app.support.mpesa_order_link import link_mpesa_transaction_to_order

        order = db.query(Order).filter(Order.id == txn.order_id).first()
        if order is not None:
            link_mpesa_transaction_to_order(db, order, new_txn)

    db.commit()
    db.refresh(new_txn)
    return (
        new_txn,
        "resent",
        f"STK push sent to {new_txn.phone_number}. Ask the customer to check their phone.",
    )


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
        apply_credit_collection_if_paid(db, txn)
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
    from app.support.order_status import AWAITING_PAYMENT, PAYMENT_RECEIVED, PLACED

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
        if order.status not in {AWAITING_PAYMENT, PLACED}:
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
        try:
            from app.services.booking_notification_service import notify_booking_confirmed

            notify_booking_confirmed(db, booking)
        except Exception:
            logger.exception(
                "Booking confirmation email failed for booking=%s", booking.id
            )
    return updated


def apply_credit_collection_if_paid(db: Session, txn: MpesaTransaction) -> None:
    """Take a successful credit-collection STK off the customer's tab once."""
    if txn.status != "success":
        return
    customer_id = getattr(txn, "shop_customer_id", None)
    amount = getattr(txn, "credit_collect_amount", None)
    if not customer_id or not amount or getattr(txn, "credit_collected_at", None):
        return

    from app.models import ShopCustomer
    from app.services.customer_service import CustomerService, CustomerServiceError

    customer = (
        db.query(ShopCustomer)
        .filter(ShopCustomer.id == customer_id)
        .with_for_update()
        .first()
    )
    if customer is None:
        logger.warning("Credit collection txn=%s customer %s missing", txn.id, customer_id)
        return
    try:
        CustomerService(db).collect_credit(customer, amount)
    except CustomerServiceError as exc:
        if "does not owe" not in str(exc):
            logger.exception(
                "Credit collection txn=%s could not be applied for customer=%s",
                txn.id,
                customer_id,
            )
            return
    txn.credit_collected_at = _now_utc().replace(tzinfo=None)
    txn.updated_at = _now_utc()


def confirm_collection_manually(
    db: Session,
    *,
    transaction_id: str,
    receipt_number: str,
    confirmed_by_user_id: str | None = None,
) -> MpesaTransaction:
    """Mark a failed/stuck client collection as paid using the customer's SMS code."""
    from app.support.mpesa_order_link import normalize_mpesa_receipt

    txn = (
        db.query(MpesaTransaction)
        .filter(MpesaTransaction.id == transaction_id)
        .first()
    )
    if txn is None:
        raise MpesaApiError("Transaction not found.")

    payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
    if payload.get("admin_merchant_payout"):
        raise MpesaApiError("Admin hub payouts cannot be confirmed as client collections.")

    already_paid = txn.status == "success" and bool((txn.mpesa_receipt_number or "").strip())
    if already_paid:
        raise MpesaApiError("This collection is already confirmed.")

    normalized = normalize_mpesa_receipt(receipt_number)
    if not normalized:
        raise MpesaApiError("Enter the M-PESA transaction code from the customer's SMS.")
    if not re.fullmatch(r"[A-Z0-9]{6,20}", normalized):
        raise MpesaApiError("Enter a valid M-PESA transaction code (6–20 letters/numbers).")

    duplicate = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.id != txn.id,
            MpesaTransaction.status == "success",
            MpesaTransaction.mpesa_receipt_number == normalized,
        )
        .first()
    )
    if duplicate:
        raise MpesaApiError("That M-PESA code is already on another successful payment.")

    now = _now_utc()
    prior_status = txn.status or "unknown"
    txn.status = "success"
    txn.result_code = 0
    txn.mpesa_receipt_number = normalized
    txn.completed_at = now
    txn.updated_at = now
    txn.result_desc = (
        f"Admin confirmed collection (was {prior_status}). Receipt {normalized}."
    )[:500]
    txn.callback_payload = {
        **payload,
        "admin_confirmed": True,
        "admin_confirmed_by": confirmed_by_user_id,
        "admin_confirmed_from_status": prior_status,
    }

    db.flush()
    updated_order_ids = _sync_linked_orders_on_success(db, txn)
    _sync_linked_bookings_on_success(db, txn)
    apply_credit_collection_if_paid(db, txn)
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
    from app.support.mpesa_amounts import min_collection_kes, require_min_amount

    require_min_amount(
        int(amount),
        min_collection_kes(
            profile.shortcode_type if profile else None,
            sandbox=use_mpesa_sandbox(db),
        ),
        label="Payment",
    )
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


def _hakikisha_identifier_types(shortcode_type: str) -> tuple[str, ...]:
    kind = (shortcode_type or "").lower()
    if kind in {"till", "buygoods", "buy_goods"}:
        return ("2",)
    if kind in {"pochi", "pochi_la_biashara", "phone", "b2c", "msisdn"}:
        return ("1", "2")
    return ("4",)


def _hakikisha_success_name(body: dict[str, Any]) -> str | None:
    name = str(body.get("OrganizationName") or "").strip()
    if not name:
        return None
    code = str(body.get("ResponseCode") or "").strip()
    message = str(body.get("ResponseMessage") or "").strip().lower()
    if message == "success" or code in {"0", "4000"}:
        return name
    return None


def _sandbox_lookup_name(shortcode: str, shortcode_type: str) -> str:
    kind = (shortcode_type or "").lower()
    if kind in {"pochi", "pochi_la_biashara"}:
        return "Sandbox Pochi wallet"
    if kind in {"phone", "b2c", "msisdn"}:
        return "Sandbox M-PESA customer"
    if kind in {"till", "buygoods", "buy_goods"}:
        return f"Sandbox Till {shortcode}"
    return f"Sandbox Paybill {shortcode}"


def _daraja_error_text(body: dict[str, Any], response: httpx.Response) -> str:
    fault = body.get("fault") if isinstance(body.get("fault"), dict) else {}
    return (
        str(body.get("errorMessage") or "").strip()
        or str(body.get("DetailedMessage") or "").strip()
        or str(body.get("ResponseMessage") or "").strip()
        or str(fault.get("faultstring") or "").strip()
        or (response.text or "").strip()[:300]
    )


def _is_missing_api_product(message: str) -> bool:
    lower = (message or "").lower()
    return "no apiproduct match" in lower or "invalid api call as no apiproduct" in lower


@dataclass(frozen=True)
class DestinationLookup:
    source: Literal["mpesa", "manual"]
    name: str | None = None


def lookup_destination_name(
    db: Session,
    *,
    shortcode: str,
    shortcode_type: str,
) -> DestinationLookup:
    """Look up the M-PESA registered name for a Paybill, Till, Pochi, or phone.

    Uses Daraja Query Organization Info (Hakikisha). That product is optional on
    a Daraja app — if it is not subscribed we fall back to a manual confirm step
    instead of blocking save.
    """
    config = resolve_mpesa_config(db)
    sandbox = use_mpesa_sandbox(db)
    last_error = "Could not look up this destination on M-PESA."

    try:
        token = fetch_access_token(config)
        url = f"{config.base_url().rstrip('/')}/sfcverify/v1/query/info"
        for identifier_type in _hakikisha_identifier_types(shortcode_type):
            payload = {
                "IdentifierType": identifier_type,
                "Identifier": shortcode,
            }
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
                parsed = response.json()
                if isinstance(parsed, dict):
                    body = parsed
            except Exception:
                body = {}
            name = _hakikisha_success_name(body)
            if name:
                return DestinationLookup(source="mpesa", name=name)
            last_error = _daraja_error_text(body, response) or last_error
            logger.info(
                "M-PESA destination lookup miss type=%s id=%s status=%s body=%s",
                identifier_type,
                shortcode,
                response.status_code,
                body or response.text[:400],
            )
            if _is_missing_api_product(last_error):
                logger.warning(
                    "Daraja app is missing Query Organization Info (Hakikisha); "
                    "using manual destination confirmation."
                )
                break
    except MpesaConfigurationMissing:
        if sandbox:
            return DestinationLookup(
                source="mpesa",
                name=_sandbox_lookup_name(shortcode, shortcode_type),
            )
        raise
    except MpesaApiError:
        if sandbox:
            return DestinationLookup(
                source="mpesa",
                name=_sandbox_lookup_name(shortcode, shortcode_type),
            )
        raise
    except httpx.HTTPError as exc:
        logger.warning("M-PESA destination lookup network error: %s", exc)
        if sandbox:
            return DestinationLookup(
                source="mpesa",
                name=_sandbox_lookup_name(shortcode, shortcode_type),
            )
        raise MpesaApiError(
            "Could not reach M-PESA to look up this destination. Try again."
        ) from exc

    if sandbox:
        return DestinationLookup(
            source="mpesa",
            name=_sandbox_lookup_name(shortcode, shortcode_type),
        )
    if _is_missing_api_product(last_error):
        return DestinationLookup(source="manual")
    raise MpesaApiError(
        last_error
        or "M-PESA did not recognise this destination. Check the number and try again."
    )
