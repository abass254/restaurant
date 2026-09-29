"""Adjust per-shop inventory stock when orders are placed or cancelled."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy.orm import Session, joinedload

from app.models import InventoryItem, Order, StockMovement


class InsufficientStockError(ValueError):
    """Raised when a line requests more than the tracked stock on hand."""

    def __init__(self, product_name: str, requested: Decimal, available: Decimal):
        self.product_name = product_name
        self.requested = requested
        self.available = available
        super().__init__(
            f"Insufficient stock for {product_name}: requested {requested}, "
            f"only {available} available."
        )


class UntrackedStockError(ValueError):
    """Raised when a manual stock movement targets a service or unlimited item."""

    def __init__(self, product_name: str, reason: str):
        self.product_name = product_name
        self.reason = reason
        super().__init__(f"Cannot adjust stock for {product_name}: {reason}")


StockDirection = Literal["in", "out"]
StockReason = Literal["receive", "adjustment", "damage", "other"]


def _aggregate_lines(lines: list[tuple[str, int | float | Decimal]]) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = {}
    for item_id, qty in lines:
        normalized_id = str(item_id or "").strip()
        if not normalized_id:
            continue
        try:
            quantity = Decimal(str(qty)).quantize(Decimal("0.001"))
        except (InvalidOperation, TypeError, ValueError):
            continue
        if quantity <= 0:
            continue
        totals[normalized_id] = totals.get(normalized_id, Decimal("0")) + quantity
    return totals


def _locked_item(
    db: Session,
    item_id: str,
    *,
    account_id: str | None = None,
) -> InventoryItem | None:
    query = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.id == item_id)
    )
    if account_id:
        query = query.filter(InventoryItem.account_id == account_id)
    return query.with_for_update().first()


def _product_name(item: InventoryItem) -> str:
    return (item.product.name if item.product else "Product").strip() or "Product"


def deduct_stock(
    db: Session,
    lines: list[tuple[str, int | float | Decimal]],
    *,
    account_id: str | None = None,
) -> bool:
    """Lock inventory rows and subtract quantities.

    Items with ``stock_quantity = NULL`` (services / unlimited stock) are
    skipped. Returns ``True`` when at least one tracked row was decremented.
    """
    totals = _aggregate_lines(lines)
    if not totals:
        return False

    now = datetime.utcnow()
    adjusted = False
    for item_id, qty in totals.items():
        item = _locked_item(db, item_id, account_id=account_id)
        if item is None or item.stock_quantity is None:
            continue
        if qty > item.stock_quantity:
            raise InsufficientStockError(
                _product_name(item),
                qty,
                item.stock_quantity,
            )
        item.stock_quantity -= qty
        item.updated_at = now
        adjusted = True
    return adjusted


def restore_stock(
    db: Session,
    lines: list[tuple[str, int | float | Decimal]],
    *,
    account_id: str | None = None,
) -> None:
    """Return previously deducted quantities to inventory."""
    totals = _aggregate_lines(lines)
    if not totals:
        return

    now = datetime.utcnow()
    for item_id, qty in totals.items():
        item = _locked_item(db, item_id, account_id=account_id)
        if item is None or item.stock_quantity is None:
            continue
        item.stock_quantity += qty
        item.updated_at = now


def adjust_stock(
    db: Session,
    lines: list[tuple[str, int | float | Decimal]],
    *,
    direction: StockDirection,
    account_id: str,
    reason: StockReason,
    note: str | None = None,
    user_id: str | None = None,
    record_only: bool = False,
) -> list[StockMovement]:
    """Apply manual stock-in / stock-out deltas and write movement rows.

    Unlike order deduct/restore, untracked (NULL qty) and service items raise
    ``UntrackedStockError`` so barcode tools fail loudly.

    ``record_only`` writes the ledger without changing on-hand quantity —
    used to backfill purchase history after stock was already increased.
    """
    totals = _aggregate_lines(lines)
    if not totals:
        raise ValueError("Add at least one line with quantity greater than zero.")

    now = datetime.utcnow()
    movements: list[StockMovement] = []
    trimmed_note = (note or "").strip() or None
    if trimmed_note and len(trimmed_note) > 500:
        trimmed_note = trimmed_note[:500]

    for item_id, qty in totals.items():
        item = _locked_item(db, item_id, account_id=account_id)
        if item is None:
            raise ValueError(f"Inventory item not found: {item_id}")

        name = _product_name(item)
        if item.product and item.product.is_service():
            raise UntrackedStockError(name, "services do not track stock")
        if item.stock_quantity is None:
            raise UntrackedStockError(
                name,
                "stock is unlimited / not tracked — set a quantity first",
            )

        before = Decimal(str(item.stock_quantity)).quantize(Decimal("0.001"))
        if record_only:
            after = before
        elif direction == "out":
            if qty > before:
                raise InsufficientStockError(name, qty, before)
            after = before - qty
        else:
            after = before + qty

        if not record_only:
            item.stock_quantity = after
            item.updated_at = now
            if direction == "in" and after > 0 and not item.is_active:
                item.is_active = True

        movement = StockMovement(
            account_id=account_id,
            inventory_item_id=item.id,
            direction=direction,
            quantity=qty,
            quantity_before=before,
            quantity_after=after,
            reason=reason,
            note=trimmed_note,
            created_by=user_id,
            created_at=now,
        )
        movement.inventory_item = item
        db.add(movement)
        movements.append(movement)

    return movements


def apply_unit_costs(
    movements: list[StockMovement],
    costs: dict[str, float],
    *,
    update_buying_price: bool = True,
) -> None:
    """Stamp purchase cost onto inbound movements and refresh buying price."""
    for movement in movements:
        raw = costs.get(movement.inventory_item_id)
        if raw is None:
            continue
        try:
            cost = round(float(raw), 2)
        except (TypeError, ValueError):
            continue
        if cost < 0:
            continue
        movement.unit_cost = cost
        if not update_buying_price:
            continue
        item = getattr(movement, "inventory_item", None)
        if item is None:
            continue
        item.buying_price = cost
        item.updated_at = movement.created_at or getattr(item, "updated_at", None)


def lines_from_order(order: Order) -> list[tuple[str, Decimal]]:
    lines: list[tuple[str, Decimal]] = []
    for item in order.items or []:
        if not item.inventory_item_id:
            continue
        factor = Decimal(str(getattr(item, "unit_factor", None) or 1))
        lines.append(
            (
                str(item.inventory_item_id),
                Decimal(str(item.quantity)) * factor,
            ),
        )
    return lines


def deduct_stock_for_order(db: Session, order: Order) -> bool:
    return deduct_stock(
        db,
        lines_from_order(order),
        account_id=str(order.account_id),
    )


def restore_stock_for_order(db: Session, order: Order) -> None:
    restore_stock(
        db,
        lines_from_order(order),
        account_id=str(order.account_id),
    )
