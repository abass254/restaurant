"""Link M-PESA STK attempts to orders and validate Instagram payment receipts."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import MpesaTransaction, Order

_RECEIPT_RE = re.compile(r"^[A-Z0-9]{6,20}$")


def normalize_mpesa_receipt(value: str | None) -> str:
    if not value:
        return ""
    return str(value).strip().upper()


def order_requires_mpesa_receipt_confirmation(order: Order) -> bool:
    """M-PESA orders without a reflected successful payment need a receipt code.

    When Daraja has already confirmed payment on a linked transaction, staff
    can mark the order paid in one click. Otherwise they must enter the
    customer's M-PESA transaction code (walk-in till payments, delayed
    callbacks, or customers who insist they have already paid).
    """
    from app.support.order_status import PAYMENT_MPESA

    if str(getattr(order, "payment_method", "") or "") != PAYMENT_MPESA:
        return False
    if getattr(order, "paid_at", None) is not None:
        return False
    return not order_has_successful_mpesa_payment(order)


def link_mpesa_transaction_to_order(
    db: Session,
    order: Order,
    txn: MpesaTransaction,
) -> None:
    """Associate ``txn`` with ``order`` and point the order at the latest attempt."""
    txn.order_id = order.id
    order.mpesa_transaction_id = txn.id
    db.flush()


def load_order_mpesa_transactions(db: Session, order: Order) -> list[MpesaTransaction]:
    return (
        db.query(MpesaTransaction)
        .filter(MpesaTransaction.order_id == order.id)
        .order_by(MpesaTransaction.created_at.desc(), MpesaTransaction.id.desc())
        .all()
    )


def order_has_successful_mpesa_payment(order: Order) -> bool:
    if getattr(order, "paid_at", None) is not None:
        return True
    txns = getattr(order, "mpesa_transactions", None) or []
    return any(getattr(txn, "status", None) == "success" for txn in txns)


def _expected_order_amount(order: Order) -> int:
    return max(1, int(round(float(order.total or 0))))


def _txn_matches_receipt(txn: MpesaTransaction, normalized: str) -> bool:
    return (
        txn.status == "success"
        and normalize_mpesa_receipt(txn.mpesa_receipt_number) == normalized
    )


def _account_mpesa_transactions(db: Session, account_id: str) -> list[MpesaTransaction]:
    from sqlalchemy import or_

    return (
        db.query(MpesaTransaction)
        .outerjoin(Order, MpesaTransaction.order_id == Order.id)
        .filter(
            or_(
                Order.account_id == account_id,
                MpesaTransaction.account_id == account_id,
            ),
            MpesaTransaction.status == "success",
        )
        .order_by(MpesaTransaction.created_at.desc(), MpesaTransaction.id.desc())
        .all()
    )


def validate_mpesa_receipt_for_order(
    db: Session,
    order: Order,
    receipt_code: str,
) -> MpesaTransaction:
    """Ensure ``receipt_code`` matches a successful payment for this order."""
    normalized = normalize_mpesa_receipt(receipt_code)
    if not normalized:
        raise ValueError("Enter the M-PESA transaction code from the customer's SMS.")
    if not _RECEIPT_RE.match(normalized):
        raise ValueError("Enter a valid M-PESA transaction code (6–20 letters/numbers).")

    for txn in load_order_mpesa_transactions(db, order):
        if _txn_matches_receipt(txn, normalized):
            return txn

    expected_amount = _expected_order_amount(order)
    matches = [
        txn
        for txn in _account_mpesa_transactions(db, order.account_id)
        if _txn_matches_receipt(txn, normalized) and txn.amount == expected_amount
    ]
    if len(matches) == 1:
        txn = matches[0]
        if txn.order_id and txn.order_id != order.id:
            linked = db.query(Order).filter(Order.id == txn.order_id).first()
            if linked and linked.paid_at:
                raise ValueError(
                    "That M-PESA code is already linked to another paid order.",
                )
        return txn
    if len(matches) > 1:
        raise ValueError(
            "Multiple payments match that code. Contact support to link the right one.",
        )

    raise ValueError(
        "That M-PESA code does not match a successful payment for this order amount.",
    )


def _receipt_already_used(db: Session, normalized: str, *, exclude_order_id: str | None) -> bool:
    q = db.query(MpesaTransaction).filter(
        MpesaTransaction.status == "success",
        MpesaTransaction.mpesa_receipt_number == normalized,
    )
    for txn in q.all():
        if txn.order_id and exclude_order_id and txn.order_id == exclude_order_id:
            continue
        if txn.order_id:
            linked = db.query(Order).filter(Order.id == txn.order_id).first()
            if linked and linked.paid_at:
                return True
        elif txn.account_id:
            return True
    return False


def record_merchant_direct_mpesa_for_order(
    db: Session,
    order: Order,
    receipt_code: str | None,
    *,
    confirmed_by_user_id: str | None = None,
) -> MpesaTransaction:
    """Bookkeep a payment made straight to the merchant (not via DukAI STK).

    Creates a successful ``mpesa_transactions`` row with payout skipped — the
    money never sat in the hub Paybill, so nothing should be swept out.
    """
    normalized = normalize_mpesa_receipt(receipt_code)
    if normalized and not _RECEIPT_RE.match(normalized):
        raise ValueError("Enter a valid M-PESA transaction code (6–20 letters/numbers).")
    if normalized and _receipt_already_used(db, normalized, exclude_order_id=order.id):
        raise ValueError("That M-PESA code is already linked to another paid order.")

    phone = (order.customer_phone or "").strip() or "254700000000"
    amount = _expected_order_amount(order)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    txn = MpesaTransaction(
        initiated_by_user_id=confirmed_by_user_id,
        account_id=order.account_id,
        phone_number=phone[:20],
        amount=amount,
        account_reference=(order.order_number or order.id)[:12],
        transaction_desc=f"Direct M-PESA {order.order_number or order.id}"[:200],
        merchant_request_id=None,
        checkout_request_id=f"DIRECT-{uuid.uuid4().hex[:24].upper()}",
        status="success",
        result_code=0,
        result_desc=(
            "Merchant confirmed direct M-PESA payment with SMS code."
            if normalized
            else "Merchant confirmed direct M-PESA payment without receipt code."
        ),
        mpesa_receipt_number=normalized or None,
        completed_at=now,
        callback_payload={
            "merchant_direct_confirm": True,
            "receipt_code_provided": bool(normalized),
            "confirmed_by": confirmed_by_user_id,
        },
        payout_status="skipped",
        payout_result_desc="Customer paid the merchant directly (not via DukAI hub).",
        payout_amount=amount,
        payout_completed_at=now,
        order_id=order.id,
        created_at=now,
        updated_at=now,
    )
    db.add(txn)
    db.flush()
    return txn


def confirm_mpesa_receipt_for_order(
    db: Session,
    order: Order,
    receipt_code: str | None,
    *,
    confirmed_by_user_id: str | None = None,
) -> MpesaTransaction:
    """Match a hub payment, or record merchant-confirmed direct payment."""
    if not normalize_mpesa_receipt(receipt_code):
        return record_merchant_direct_mpesa_for_order(
            db,
            order,
            None,
            confirmed_by_user_id=confirmed_by_user_id,
        )
    try:
        return validate_mpesa_receipt_for_order(db, order, receipt_code)
    except ValueError as exc:
        message = str(exc)
        if "does not match a successful payment" not in message:
            raise
        return record_merchant_direct_mpesa_for_order(
            db,
            order,
            receipt_code,
            confirmed_by_user_id=confirmed_by_user_id,
        )
