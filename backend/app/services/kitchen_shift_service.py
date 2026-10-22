"""Kitchen shift handovers and stock accountability."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.orm import Session

from app.models import Account, KitchenShiftSession
from app.services.kitchen_issue_service import kitchen_item_out, kitchen_supplies
from app.services.restaurant_stock_service import (
    StockTakeError,
    complete_stock_take,
    create_stock_take,
)


class KitchenShiftError(ValueError):
    pass


def _quantity(value: Any) -> Decimal:
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise KitchenShiftError("Enter a valid quantity for every kitchen item.") from None
    if not quantity.is_finite() or quantity < 0:
        raise KitchenShiftError("Kitchen quantities must be zero or more.")
    return quantity.quantize(Decimal("0.001"))


def _current_session(db: Session, account_id: str, *, lock: bool = False) -> KitchenShiftSession | None:
    query = (
        db.query(KitchenShiftSession)
        .filter(
            KitchenShiftSession.account_id == account_id,
            KitchenShiftSession.status.in_(("active", "closing")),
        )
        .order_by(KitchenShiftSession.clocked_in_at.desc())
    )
    if lock:
        query = query.with_for_update()
    return query.first()


def shift_state(db: Session, account_id: str) -> dict[str, Any]:
    current = _current_session(db, account_id)
    return {
        "session": (
            {
                "id": current.id,
                "status": current.status,
                "opening_stock": current.opening_stock,
                "closing_stock": current.closing_stock,
                "closing_note": current.closing_note,
                "orders_cleared": current.orders_cleared,
                "clocked_in_by": current.clocked_in_by,
                "clocked_out_by": current.clocked_out_by,
                "clocked_in_at": current.clocked_in_at.isoformat(),
                "clocked_out_at": current.clocked_out_at.isoformat() if current.clocked_out_at else None,
            }
            if current
            else None
        ),
        "items": [kitchen_item_out(item) for item in kitchen_supplies(db, account_id)],
    }


def clock_in(
    db: Session,
    account: Account,
    user_id: str,
    confirmations: dict[str, Decimal],
) -> KitchenShiftSession:
    db.query(Account).filter(Account.id == account.id).with_for_update().one()
    if _current_session(db, account.id, lock=True):
        raise KitchenShiftError("A kitchen shift is already active or closing. Finish it before clocking in.")

    items = kitchen_supplies(db, account.id)
    expected = {item.id: _quantity(item.kitchen_quantity or 0) for item in items}
    if set(confirmations) != set(expected):
        raise KitchenShiftError("Review and confirm every kitchen item before clocking in.")

    differences = [
        f"{item.product.name if item.product else 'Item'}: system has {expected[item.id]}, "
        f"confirmed {_quantity(confirmations[item.id])}"
        for item in items
        if _quantity(confirmations[item.id]) != expected[item.id]
    ]
    if differences:
        raise KitchenShiftError(
            "The handover does not match kitchen stock. Ask the store to record the correct issue or adjustment, "
            "then refresh and confirm again. " + "; ".join(differences[:5])
        )

    now = datetime.utcnow()
    session = KitchenShiftSession(
        account_id=account.id,
        status="active",
        opening_stock=[
            {
                "inventory_item_id": item.id,
                "name": item.product.name if item.product else "Item",
                "unit": item.product.unit if item.product and item.product.unit else "Piece",
                "quantity": float(expected[item.id]),
            }
            for item in items
        ],
        clocked_in_by=user_id,
        clocked_in_at=now,
    )
    db.add(session)
    db.flush()
    return session


def clock_out(
    db: Session,
    account_id: str,
    user_id: str,
    counts: dict[str, Decimal],
    note: str | None,
    orders_cleared: bool,
) -> KitchenShiftSession:
    session = _current_session(db, account_id, lock=True)
    if session is None:
        raise KitchenShiftError("There is no active kitchen shift to clock out.")
    if session.status != "active":
        raise KitchenShiftError("Kitchen shift close-out is already in progress.")
    if not orders_cleared:
        raise KitchenShiftError("Finish or hand over all active orders before clocking out.")

    items = kitchen_supplies(db, account_id)
    current = {item.id: _quantity(item.kitchen_quantity or 0) for item in items}
    if set(counts) != set(current):
        raise KitchenShiftError("Count every kitchen item before clocking out.")
    normalized_counts = {item_id: _quantity(value) for item_id, value in counts.items()}
    has_variance = any(normalized_counts[item_id] != qty for item_id, qty in current.items())
    clean_note = (note or "").strip() or None
    if has_variance and not clean_note:
        raise KitchenShiftError("Add a note explaining the stock difference before clocking out.")

    session.status = "closing"
    db.flush()
    take = None
    if items:
        try:
            take = create_stock_take(
                db,
                account_id,
                user_id=user_id,
                location="kitchen",
                notes=f"Kitchen shift close-out: {clean_note or 'No variance'}",
                inventory_item_ids=list(current),
            )
            for line in take.lines:
                line.counted_qty = normalized_counts[line.inventory_item_id]
            complete_stock_take(db, account_id, take.id, user_id=user_id)
        except StockTakeError as exc:
            raise KitchenShiftError(str(exc)) from exc

    session.status = "closed"
    session.closing_stock = [
        {
            "inventory_item_id": item.id,
            "name": item.product.name if item.product else "Item",
            "unit": item.product.unit if item.product and item.product.unit else "Piece",
            "quantity": float(normalized_counts[item.id]),
        }
        for item in items
    ]
    session.closing_note = clean_note
    session.orders_cleared = True
    session.clocked_out_by = user_id
    session.clocked_out_at = datetime.utcnow()
    session.stock_take_id = take.id if take else None
    db.flush()
    return session
