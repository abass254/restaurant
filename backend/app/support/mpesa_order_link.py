"""Link M-PESA STK attempts to orders and validate Instagram payment receipts."""

from __future__ import annotations

import re

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
