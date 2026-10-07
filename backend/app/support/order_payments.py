"""How an order's total is shared between payment methods.

Most orders have one ``payment_method`` covering the whole total. A split
order has ``payment_method = "split"`` and a ``payment_splits`` list such as
``[{"method": "cash", "amount": 500}, {"method": "mpesa", "amount": 300}]``
whose amounts add up to the total.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.support.order_status import (
    PAYMENT_CASH,
    PAYMENT_CARD,
    PAYMENT_CREDIT,
    PAYMENT_MPESA,
    PAYMENT_OTHER,
    PAYMENT_SPLIT,
)

PAYMENT_LABELS: dict[str, str] = {
    PAYMENT_MPESA: "M-PESA",
    PAYMENT_CASH: "Cash",
    PAYMENT_CARD: "Card",
    PAYMENT_CREDIT: "Credit",
    PAYMENT_OTHER: "Other",
    PAYMENT_SPLIT: "Split",
}

_CENT = Decimal("0.01")


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENT)


def normalize_payment_splits(splits: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Merge repeated methods and drop zero amounts, keeping first-seen order."""
    merged: dict[str, Decimal] = {}
    for row in splits or []:
        method = str(row.get("method") or "").strip()
        amount = _money(row.get("amount"))
        if not method or amount <= 0:
            continue
        merged[method] = merged.get(method, Decimal("0")) + amount
    return [{"method": m, "amount": float(a)} for m, a in merged.items()]


def payment_portions(order: Any) -> dict[str, Decimal]:
    """Amount owed through each payment method for ``order``."""
    method = getattr(order, "payment_method", None) or ""
    if method == PAYMENT_SPLIT:
        return {
            row["method"]: _money(row["amount"])
            for row in normalize_payment_splits(getattr(order, "payment_splits", None))
        }
    if not method:
        return {}
    return {method: _money(getattr(order, "total", 0))}


def payment_methods(order: Any) -> set[str]:
    method = getattr(order, "payment_method", None) or ""
    if method == PAYMENT_SPLIT:
        return {
            row["method"]
            for row in normalize_payment_splits(getattr(order, "payment_splits", None))
        }
    return {method} if method else set()


def payment_portion(order: Any, method: str) -> Decimal:
    return payment_portions(order).get(method, Decimal("0.00"))


def order_uses_payment(order: Any, method: str) -> bool:
    return method in payment_methods(order)


def payment_summary(order: Any, currency: str | None = None) -> str:
    """Human label, e.g. ``"Cash"`` or ``"Cash KES 500 + M-PESA KES 300"``."""
    method = getattr(order, "payment_method", None) or ""
    if method != PAYMENT_SPLIT:
        return PAYMENT_LABELS.get(method, method.replace("_", " ").title())
    cur = currency or getattr(order, "currency", None) or "KES"
    return " + ".join(
        f"{PAYMENT_LABELS.get(m, m.title())} {cur} {amount:,.2f}"
        for m, amount in payment_portions(order).items()
    )
