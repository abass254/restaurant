"""Restaurant order stock: consume supplies on sale, reverse on cancel / refund.

Every order path (POS, sales autopilot, merchant API) calls
:func:`consume_for_order` for restaurant shops, so menu items use their
recipe ingredients, meal parts and option supplies no matter where the order
came from. Retail shops keep the plain ``deduct_stock`` behaviour.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Account, InventoryItem, Order, OrderItem, StockMovement
from app.services.inventory_stock_service import (
    MONEY,
    LedgerLine,
    lock_item,
    record_movement,
    record_stock_out,
    restore_stock_for_order,
    stock_usage_lines,
)
from app.services.menu_options import line_stock_usage
from app.support.store_type import is_restaurant


def restaurant_line_usage(
    db: Session,
    account_id: str,
    inv_item: InventoryItem | None,
) -> list[dict] | None:
    """Stock one unit of a menu line uses when no options were picked (channel / API orders)."""
    if inv_item is None or inv_item.product is None:
        return None
    return line_stock_usage(db, str(account_id), inv_item.product, []) or None


def _exact_and_recipe_lines(items: list[OrderItem]) -> tuple[list[LedgerLine], list[LedgerLine]]:
    exact: list[LedgerLine] = []
    recipe: list[LedgerLine] = []
    for item in items:
        quantity = Decimal(str(item.quantity or 0))
        if quantity <= 0:
            continue
        if item.inventory_item_id:
            factor = Decimal(str(getattr(item, "unit_factor", None) or 1))
            exact.append(LedgerLine(str(item.inventory_item_id), quantity * factor, item.id))
        usage = getattr(item, "stock_usage", None)
        for stock_id, qty in stock_usage_lines(usage, quantity, recipe=False):
            exact.append(LedgerLine(stock_id, qty, item.id))
        for stock_id, qty in stock_usage_lines(usage, quantity, recipe=True):
            recipe.append(LedgerLine(stock_id, qty, item.id, location="kitchen"))
    return exact, recipe


def kitchen_issuing_on(account: Account | None) -> bool:
    return is_restaurant(account) and bool(getattr(account, "kitchen_issuing_enabled", False))


def _strict_and_flexible_lines(
    db: Session,
    account: Account | None,
    items: list[OrderItem],
) -> tuple[list[LedgerLine], list[LedgerLine]]:
    """Split a sale into lines that must be in stock and lines that may run short.

    Without kitchen issuing everything comes from the store: exact items are
    strict, recipe estimates are flexible. With kitchen issuing, sold-as-is
    supplies (drinks, meal parts) still come strictly from the store, while
    recipe ingredients and raw-material options come from the kitchen.
    """
    exact, recipe = _exact_and_recipe_lines(items)
    if not kitchen_issuing_on(account):
        for line in recipe:
            line.location = "store"
        return exact, recipe

    ids = {line.inventory_item_id for line in exact}
    roles = {
        row.id: row.normalized_role()
        for row in db.query(InventoryItem).filter(InventoryItem.id.in_(ids)).all()
    } if ids else {}
    strict: list[LedgerLine] = []
    flexible = list(recipe)
    for line in exact:
        if roles.get(line.inventory_item_id) == "raw_material":
            line.location = "kitchen"
            flexible.append(line)
        else:
            strict.append(line)
    return strict, flexible


def consume_for_order(
    db: Session,
    order: Order,
    items: list[OrderItem],
    *,
    account: Account | None = None,
    user_id: str | None = None,
) -> bool:
    """Write ``sale`` movements for a restaurant order and snapshot each line's cost.

    Exact items (the item itself, meal parts, option supplies) block the sale
    when short. Recipe estimates may go negative unless the shop turned on
    ``block_sale_on_low_ingredients``. With kitchen issuing, ingredients come
    from the kitchen and sold-as-is supplies from the store.
    Raises ``InsufficientStockError``.
    """
    account = account or db.get(Account, str(order.account_id))
    block_recipe = bool(getattr(account, "block_sale_on_low_ingredients", False))
    strict, flexible = _strict_and_flexible_lines(db, account, items)
    common = {
        "account_id": str(order.account_id),
        "reason": "sale",
        "order_id": order.id,
        "user_id": user_id,
    }
    movements = record_stock_out(db, strict, allow_negative=False, **common)
    movements += record_stock_out(db, flexible, allow_negative=not block_recipe, **common)

    costs: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for movement in movements:
        if movement.order_item_id and movement.total_cost is not None:
            costs[movement.order_item_id] += Decimal(str(movement.total_cost))
    for item in items:
        if item.id in costs:
            item.cost_total = costs[item.id].quantize(MONEY)
    if movements:
        order.stock_deducted = True
    return bool(movements)


def _sale_movements(db: Session, order: Order) -> list[StockMovement]:
    return (
        db.query(StockMovement)
        .filter(
            StockMovement.order_id == order.id,
            StockMovement.reason == "sale",
            StockMovement.voided_at.is_(None),
        )
        .all()
    )


def _already_reversed(db: Session, order: Order) -> bool:
    return (
        db.query(StockMovement.id)
        .filter(
            StockMovement.order_id == order.id,
            StockMovement.reason == "sale_reversal",
        )
        .first()
        is not None
    )


def reverse_for_order(
    db: Session,
    order: Order,
    *,
    wastage: bool = False,
    user_id: str | None = None,
) -> None:
    """Undo an order's stock use when it is cancelled or refunded.

    Orders whose sale was recorded in the ledger get matching ``sale_reversal``
    movements. With ``wastage`` (food already made / not returned) the stock is
    then written off as ``wastage`` so the loss is visible rather than hidden.
    Orders placed without ledger rows (retail, or before this feature) fall
    back to the plain restore.
    """
    sales = _sale_movements(db, order)
    if not sales:
        restore_stock_for_order(db, order)
        return
    if _already_reversed(db, order):
        return

    now = datetime.utcnow()
    account_id = str(order.account_id)
    for sale in sales:
        item = lock_item(db, sale.inventory_item_id, account_id=account_id)
        if item is None or item.stock_quantity is None:
            continue
        links = {"order_id": order.id, "order_item_id": sale.order_item_id}
        unit_cost = Decimal(str(sale.unit_cost)) if sale.unit_cost is not None else None
        location = sale.location or "store"
        record_movement(
            db,
            item,
            account_id=account_id,
            direction="in",
            quantity=Decimal(str(sale.quantity)),
            reason="sale_reversal",
            unit_cost=unit_cost,
            note=f"Order {order.order_number} {order.status}",
            user_id=user_id,
            links=links,
            now=now,
            location=location,
        )
        if wastage:
            record_movement(
                db,
                item,
                account_id=account_id,
                direction="out",
                quantity=Decimal(str(sale.quantity)),
                reason="wastage",
                allow_negative=True,
                unit_cost=unit_cost,
                note=f"Order {order.order_number} {order.status} · not returned to stock",
                user_id=user_id,
                links=links,
                now=now,
                location=location,
            )


def adjust_line_quantity(
    db: Session,
    order: Order,
    line: OrderItem,
    delta: int,
    *,
    user_id: str | None = None,
) -> None:
    """Record stock for a quantity change on an existing restaurant order line."""
    if delta == 0:
        return
    if line.stock_usage is None:
        inv_item = db.get(InventoryItem, line.inventory_item_id) if line.inventory_item_id else None
        line.stock_usage = restaurant_line_usage(db, str(order.account_id), inv_item)
    step = OrderItem(
        id=line.id,
        inventory_item_id=line.inventory_item_id,
        quantity=abs(delta),
        unit_factor=line.unit_factor,
        stock_usage=line.stock_usage,
    )
    account_id = str(order.account_id)
    account = db.get(Account, account_id)
    strict, flexible = _strict_and_flexible_lines(db, account, [step])
    change = Decimal("0")
    if delta > 0:
        block_recipe = bool(getattr(account, "block_sale_on_low_ingredients", False))
        common = {"account_id": account_id, "reason": "sale", "order_id": order.id, "user_id": user_id}
        movements = record_stock_out(db, strict, allow_negative=False, **common)
        movements += record_stock_out(db, flexible, allow_negative=not block_recipe, **common)
        for movement in movements:
            change += Decimal(str(movement.total_cost or 0))
        if movements:
            order.stock_deducted = True
    else:
        now = datetime.utcnow()
        for ledger_line in strict + flexible:
            item = lock_item(db, ledger_line.inventory_item_id, account_id=account_id)
            if item is None or item.stock_quantity is None:
                continue
            movement = record_movement(
                db,
                item,
                account_id=account_id,
                direction="in",
                quantity=ledger_line.quantity,
                reason="sale_reversal",
                note=f"Order {order.order_number} quantity reduced",
                user_id=user_id,
                links={"order_id": order.id, "order_item_id": line.id},
                now=now,
                location=ledger_line.location,
            )
            change -= Decimal(str(movement.total_cost or 0))
    if change:
        line.cost_total = (Decimal(str(line.cost_total or 0)) + change).quantize(MONEY)


def uses_ledger(db: Session, account_id: str) -> bool:
    return is_restaurant(db.get(Account, str(account_id)))
