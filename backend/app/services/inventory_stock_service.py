"""Adjust per-shop inventory stock when orders are placed or cancelled."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

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


lock_item = _locked_item


def _product_name(item: InventoryItem) -> str:
    return (item.product.name if item.product else "Product").strip() or "Product"


def deduct_stock(
    db: Session,
    lines: list[tuple[str, int | float | Decimal]],
    *,
    account_id: str | None = None,
    allow_negative: bool = False,
) -> bool:
    """Lock inventory rows and subtract quantities.

    Items with ``stock_quantity = NULL`` (services / unlimited stock) are
    skipped. Returns ``True`` when at least one tracked row was decremented.
    ``allow_negative`` is for recipe estimates, which must not block a sale.
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
        if qty > item.stock_quantity and not allow_negative:
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


class PurchaseVoidError(ValueError):
    """Raised when a stock movement cannot be voided as a purchase."""


def void_purchase(
    db: Session,
    movement_id: str,
    *,
    account_id: str,
    reason: str,
    user_id: str | None = None,
) -> StockMovement | None:
    """Void a purchase (stock-in / receive) and take its stock back out.

    History-only purchases (``record_only``) never added stock, so they are
    just marked voided. Returns ``None`` when the movement does not exist.
    """
    movement = (
        db.query(StockMovement)
        .filter(
            StockMovement.id == movement_id,
            StockMovement.account_id == account_id,
        )
        .with_for_update()
        .first()
    )
    if movement is None:
        return None
    if movement.direction != "in" or movement.reason != "receive":
        raise PurchaseVoidError("Only purchases can be voided.")
    if movement.voided_at is not None:
        raise PurchaseVoidError("This purchase is already voided.")

    trimmed_reason = reason.strip()[:1000]
    now = datetime.utcnow()
    qty = Decimal(str(movement.quantity)).quantize(Decimal("0.001"))
    added_stock = (
        movement.quantity_before is None
        or movement.quantity_after is None
        or movement.quantity_after != movement.quantity_before
    )

    item = _locked_item(db, movement.inventory_item_id, account_id=account_id)
    if added_stock and item is not None and item.stock_quantity is not None and qty > 0:
        before = Decimal(str(item.stock_quantity)).quantize(Decimal("0.001"))
        if qty > before:
            raise InsufficientStockError(_product_name(item), qty, before)
        after = before - qty
        item.stock_quantity = after
        item.updated_at = now
        reversal = StockMovement(
            account_id=account_id,
            inventory_item_id=item.id,
            direction="out",
            quantity=qty,
            quantity_before=before,
            quantity_after=after,
            reason="adjustment",
            note=f"Voided purchase · {trimmed_reason}"[:500],
            created_by=user_id,
            created_at=now,
        )
        db.add(reversal)

    movement.voided_at = now
    movement.voided_by = user_id
    movement.void_reason = trimmed_reason
    return movement


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
            cost = round(float(raw), 4)
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
        quantity = Decimal(str(item.quantity or 0))
        if item.inventory_item_id:
            factor = Decimal(str(getattr(item, "unit_factor", None) or 1))
            lines.append((str(item.inventory_item_id), quantity * factor))
        usage = getattr(item, "stock_usage", None)
        if usage is not None:
            lines.extend(stock_usage_lines(usage, quantity))
        else:
            lines.extend(modifier_stock_lines(getattr(item, "modifiers", None), quantity))
    return lines


def stock_usage_lines(
    usage,
    quantity: Decimal,
    *,
    recipe: bool | None = None,
) -> list[tuple[str, Decimal]]:
    """Ingredients, meal parts and linked options recorded on an order line.

    ``recipe`` filters to recipe estimates (True) or exact items (False); None returns both.
    """
    if not isinstance(usage, list):
        return []
    return [
        (str(row["stock_item_id"]), quantity * Decimal(str(row.get("qty") or 0)))
        for row in usage
        if isinstance(row, dict)
        and row.get("stock_item_id")
        and (recipe is None or bool(row.get("recipe")) == recipe)
    ]


def modifier_stock_lines(modifiers, quantity: Decimal) -> list[tuple[str, Decimal]]:
    """Stock snapshotted inside modifiers by orders placed before ``stock_usage`` existed."""
    lines: list[tuple[str, Decimal]] = []
    if not isinstance(modifiers, list):
        return lines
    for mod in modifiers:
        if not isinstance(mod, dict) or not mod.get("stock_item_id"):
            continue
        per_unit = Decimal(str(mod.get("stock_qty") or 1))
        lines.append((str(mod["stock_item_id"]), quantity * per_unit))
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


# ---------------------------------------------------------------------------
# Ledger-first stock changes (restaurant shops).
#
# Every change writes a ``StockMovement`` with its cost and source links, so
# on-hand stock is explained entirely by the ledger. Retail keeps using the
# functions above.
# ---------------------------------------------------------------------------

QTY = Decimal("0.001")
MONEY = Decimal("0.01")
UNIT_COST = Decimal("0.0001")

LedgerReason = Literal[
    "receive",
    "sale",
    "sale_reversal",
    "adjustment",
    "damage",
    "wastage",
    "count_variance",
    "issue",
    "kitchen_return",
    "other",
]

StockLocation = Literal["store", "kitchen"]


@dataclass
class LedgerLine:
    inventory_item_id: str
    quantity: Decimal
    order_item_id: str | None = None
    location: StockLocation = "store"


def location_quantity(item: InventoryItem, location: StockLocation) -> Decimal | None:
    raw = item.kitchen_quantity if location == "kitchen" else item.stock_quantity
    return None if raw is None else Decimal(str(raw))


def total_on_hand(item: InventoryItem) -> Decimal | None:
    """Store plus kitchen; ``None`` when the item is not stock-tracked."""
    if item.stock_quantity is None:
        return None
    return _qty(item.stock_quantity) + _qty(item.kitchen_quantity)


def _set_location_quantity(item: InventoryItem, location: StockLocation, value: Decimal) -> None:
    if location == "kitchen":
        item.kitchen_quantity = value
    else:
        item.stock_quantity = value


def _qty(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(QTY)


def weighted_average_cost(
    on_hand: Decimal | None,
    current_cost: Any,
    received_qty: Decimal,
    received_unit_cost: Decimal,
) -> Decimal:
    """Average cost per base unit after receiving stock.

    Negative on-hand (recipe estimates overshooting) counts as zero, so the
    new cost is never pulled below what was actually paid.
    """
    held = max(on_hand or Decimal("0"), Decimal("0"))
    if current_cost is None or held == 0:
        return received_unit_cost.quantize(UNIT_COST)
    total = held * Decimal(str(current_cost)) + received_qty * received_unit_cost
    return (total / (held + received_qty)).quantize(UNIT_COST)


def record_movement(
    db: Session,
    item: InventoryItem,
    *,
    account_id: str,
    direction: StockDirection,
    quantity: Decimal,
    reason: LedgerReason,
    allow_negative: bool = False,
    unit_cost: Decimal | None = None,
    update_average_cost: bool = False,
    note: str | None = None,
    user_id: str | None = None,
    links: dict[str, str | None] | None = None,
    now: datetime | None = None,
    location: StockLocation = "store",
) -> StockMovement:
    """Change a locked, stock-tracked row and write its ledger entry.

    ``unit_cost`` is per base unit; it defaults to the item's current average
    cost. ``update_average_cost`` folds an inbound cost into ``buying_price``.
    ``location`` picks the store (``stock_quantity``) or kitchen balance.
    """
    now = now or datetime.utcnow()
    qty = _qty(quantity)
    before = _qty(location_quantity(item, location))
    if direction == "out":
        if qty > before and not allow_negative:
            raise InsufficientStockError(_product_name(item), qty, before)
        after = before - qty
    else:
        after = before + qty

    if direction == "in" and update_average_cost and unit_cost is not None:
        held = max(_qty(item.stock_quantity), Decimal("0")) + max(_qty(item.kitchen_quantity), Decimal("0"))
        item.buying_price = weighted_average_cost(held, item.buying_price, qty, unit_cost)

    cost = unit_cost if unit_cost is not None else item.buying_price
    cost_value = Decimal(str(cost)).quantize(UNIT_COST) if cost is not None else None
    _set_location_quantity(item, location, after)
    item.updated_at = now
    if direction == "in" and after > 0 and not item.is_active:
        item.is_active = True

    trimmed_note = (note or "").strip()[:500] or None
    movement = StockMovement(
        account_id=account_id,
        inventory_item_id=item.id,
        direction=direction,
        quantity=qty,
        quantity_before=before,
        quantity_after=after,
        reason=reason,
        location=location,
        note=trimmed_note,
        unit_cost=cost_value,
        total_cost=(cost_value * qty).quantize(MONEY) if cost_value is not None else None,
        created_by=user_id,
        created_at=now,
        **(links or {}),
    )
    movement.inventory_item = item
    db.add(movement)
    return movement


def record_stock_out(
    db: Session,
    lines: list[LedgerLine],
    *,
    account_id: str,
    reason: LedgerReason,
    order_id: str | None = None,
    allow_negative: bool = False,
    user_id: str | None = None,
    note: str | None = None,
) -> list[StockMovement]:
    """Take stock out for several lines, one movement per item, location and order line.

    Untracked rows (``stock_quantity`` NULL) are skipped. The shortage check
    uses each item's total per location across all lines.
    """
    per_item: dict[tuple[str, StockLocation], dict[str | None, Decimal]] = {}
    for line in lines:
        item_id = str(line.inventory_item_id or "").strip()
        try:
            qty = _qty(line.quantity)
        except (InvalidOperation, TypeError, ValueError):
            continue
        if not item_id or qty <= 0:
            continue
        bucket = per_item.setdefault((item_id, line.location), {})
        bucket[line.order_item_id] = bucket.get(line.order_item_id, Decimal("0")) + qty

    now = datetime.utcnow()
    movements: list[StockMovement] = []
    for (item_id, location), by_line in per_item.items():
        item = _locked_item(db, item_id, account_id=account_id)
        if item is None or item.stock_quantity is None:
            continue
        total = sum(by_line.values(), Decimal("0"))
        available = _qty(location_quantity(item, location))
        if total > available and not allow_negative:
            raise InsufficientStockError(_product_name(item), total, available)
        for order_item_id, qty in by_line.items():
            movements.append(
                record_movement(
                    db,
                    item,
                    account_id=account_id,
                    direction="out",
                    quantity=qty,
                    reason=reason,
                    allow_negative=True,
                    note=note,
                    user_id=user_id,
                    links={"order_id": order_id, "order_item_id": order_item_id},
                    now=now,
                    location=location,
                )
            )
    return movements


def transfer(
    db: Session,
    item: InventoryItem,
    quantity: Decimal,
    *,
    account_id: str,
    from_location: StockLocation,
    to_location: StockLocation,
    reason: LedgerReason,
    allow_negative: bool = False,
    user_id: str | None = None,
    note: str | None = None,
    links: dict[str, str | None] | None = None,
    now: datetime | None = None,
) -> tuple[StockMovement, StockMovement]:
    """Move stock between store and kitchen at the current average cost.

    Writes an ``out`` row at the source and an ``in`` row at the destination,
    so total on hand and stock value are unchanged.
    """
    now = now or datetime.utcnow()
    if item.kitchen_quantity is None:
        item.kitchen_quantity = Decimal("0")
    common = {
        "account_id": account_id,
        "quantity": quantity,
        "reason": reason,
        "user_id": user_id,
        "note": note,
        "links": links,
        "now": now,
    }
    out_row = record_movement(
        db, item, direction="out", allow_negative=allow_negative, location=from_location, **common,
    )
    in_row = record_movement(db, item, direction="in", location=to_location, **common)
    return out_row, in_row
