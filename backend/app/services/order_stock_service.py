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

from sqlalchemy.orm import Session, joinedload

from app.models import Account, InventoryItem, Order, OrderItem, StockMovement
from app.services.customer_service import CustomerService
from app.services.inventory_stock_service import (
    MONEY,
    LedgerLine,
    lock_item,
    location_quantity,
    record_movement,
    record_stock_out,
    restore_stock_for_order,
    stock_usage_lines,
)
from app.services.menu_options import line_stock_usage
from app.support.order_payments import payment_portion
from app.support.order_status import PAYMENT_CREDIT
from app.support.store_type import is_restaurant


def restaurant_line_usage(
    db: Session,
    account_id: str,
    inv_item: InventoryItem | None,
    serving_unit: str | None = None,
) -> list[dict] | None:
    """Snapshot either prepared portions or ingredient use for a menu line."""
    if inv_item is None or inv_item.product is None:
        return None
    return order_line_usage(db, account_id, inv_item, serving_unit=serving_unit)


def order_line_usage(
    db: Session,
    account_id: str,
    inv_item: InventoryItem | None,
    chosen=None,
    serving_unit: str | None = None,
) -> list[dict] | None:
    if inv_item is None or inv_item.product is None:
        return None
    if not serving_unit:
        serving_unit = next(
            (
                setting.serving_unit
                for setting in (inv_item.product.recipe_serving_units or [])
                if setting.account_id == account_id
            ),
            None,
        )
    usage = line_stock_usage(
        db,
        str(account_id),
        inv_item.product,
        chosen or [],
        serving_unit=serving_unit,
    )
    for row in usage:
        if not row.get("prepared") or row.get("serving_unit"):
            continue
        prepared_item = (
            db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(
                InventoryItem.id == row["stock_item_id"],
                InventoryItem.account_id == account_id,
            )
            .first()
        )
        if prepared_item and prepared_item.product:
            row["serving_unit"] = next(
                (
                    setting.serving_unit
                    for setting in (prepared_item.product.recipe_serving_units or [])
                    if setting.account_id == account_id
                ),
                next(
                    (
                        recipe_line.serving_unit
                        for recipe_line in prepared_item.product.recipe_lines or []
                        if recipe_line.account_id == account_id
                    ),
                    "servings",
                ),
            )
    if inv_item.prepared_quantity is None:
        return usage or None
    return [
        {
            "stock_item_id": str(inv_item.id),
            "qty": 1,
            "prepared": True,
            "serving_unit": serving_unit or "servings",
        },
        *(row for row in usage if not row.get("recipe") or row.get("option")),
    ]


def _exact_and_recipe_lines(items: list[OrderItem]) -> tuple[list[LedgerLine], list[LedgerLine]]:
    exact: list[LedgerLine] = []
    recipe: list[LedgerLine] = []
    for item in items:
        quantity = Decimal(str(item.quantity or 0))
        if quantity <= 0:
            continue
        usage = getattr(item, "stock_usage", None)
        uses_prepared_stock = isinstance(usage, list) and any(
            isinstance(row, dict)
            and row.get("prepared")
            and (not row.get("option") or str(row.get("stock_item_id")) == str(item.inventory_item_id))
            for row in usage
        )
        factor = Decimal(str(getattr(item, "unit_factor", None) or 1))
        if item.inventory_item_id and not uses_prepared_stock:
            exact.append(LedgerLine(str(item.inventory_item_id), quantity * factor, item.id))
        if isinstance(usage, list):
            for row in usage:
                if isinstance(row, dict) and row.get("prepared") and row.get("stock_item_id"):
                    exact.append(
                        LedgerLine(
                            str(row["stock_item_id"]),
                            quantity * factor * Decimal(str(row.get("qty") or 1)),
                            item.id,
                            location="prepared",
                            serving_unit=str(row.get("serving_unit") or "servings"),
                        )
                    )
        for stock_id, qty in stock_usage_lines(usage, quantity * factor, recipe=False):
            exact.append(LedgerLine(stock_id, qty, item.id))
        for stock_id, qty in stock_usage_lines(usage, quantity * factor, recipe=True):
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
    # Direct items adjust stock without blocking (allow negative)
    movements = record_stock_out(db, strict, allow_negative=True, **common)
    # Recipe ingredients check that the required recipe quantity is in stock
    movements += record_stock_out(db, flexible, allow_negative=False, **common)

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


def _unreversed_sales(db: Session, order: Order, sales: list[StockMovement]) -> list[tuple[StockMovement, Decimal]]:
    """Each (item, order line, location) still out of stock after earlier reversals, with its first sale row."""
    reversed_qty: dict[tuple[str, str | None, str | None], Decimal] = defaultdict(lambda: Decimal("0"))
    for row in (
        db.query(StockMovement)
        .filter(
            StockMovement.order_id == order.id,
            StockMovement.reason == "sale_reversal",
            StockMovement.voided_at.is_(None),
        )
        .all()
    ):
        reversed_qty[(row.inventory_item_id, row.order_item_id, row.location)] += Decimal(str(row.quantity))
    outstanding: dict[tuple[str, str | None, str | None], tuple[StockMovement, Decimal]] = {}
    for sale in sales:
        key = (sale.inventory_item_id, sale.order_item_id, sale.location)
        first, qty = outstanding.get(key, (sale, Decimal("0")))
        outstanding[key] = (first, qty + Decimal(str(sale.quantity)))
    remaining = []
    for key, (sale, qty) in outstanding.items():
        left = qty - reversed_qty[key]
        if left > 0:
            remaining.append((sale, left))
    return remaining


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
    remaining = _unreversed_sales(db, order, sales)
    if not remaining:
        return

    now = datetime.utcnow()
    account_id = str(order.account_id)
    for sale, quantity in remaining:
        item = lock_item(db, sale.inventory_item_id, account_id=account_id)
        if item is None:
            continue
        links = {"order_id": order.id, "order_item_id": sale.order_item_id}
        unit_cost = Decimal(str(sale.unit_cost)) if sale.unit_cost is not None else None
        location = sale.location or "store"
        serving_unit = getattr(sale, "serving_unit", None)
        if location_quantity(item, location, serving_unit, db=db) is None:
            continue
        record_movement(
            db,
            item,
            account_id=account_id,
            direction="in",
            quantity=quantity,
            reason="sale_reversal",
            unit_cost=unit_cost,
            note=f"Order {order.order_number} {order.status}",
            user_id=user_id,
            links=links,
            now=now,
            location=location,
            serving_unit=serving_unit,
        )
        if wastage:
            record_movement(
                db,
                item,
                account_id=account_id,
                direction="out",
                quantity=quantity,
                reason="wastage",
                allow_negative=True,
                unit_cost=unit_cost,
                note=f"Order {order.order_number} {order.status} · not returned to stock",
                user_id=user_id,
                links=links,
                now=now,
                location=location,
                serving_unit=serving_unit,
            )


def release_order_holds(
    db: Session,
    order: Order,
    *,
    wastage: bool = False,
    user_id: str | None = None,
) -> None:
    """Give back what a cancelled, refunded or deleted order held: its stock and the customer's credit."""
    if order.stock_deducted:
        reverse_for_order(db, order, wastage=wastage, user_id=user_id)
        order.stock_deducted = False
    credit_due = payment_portion(order, PAYMENT_CREDIT)
    if credit_due > 0:
        CustomerService(db).release_credit_for_order(
            str(order.account_id),
            phone=order.customer_phone,
            amount=credit_due,
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
        line.stock_usage = restaurant_line_usage(
            db,
            str(order.account_id),
            inv_item,
            serving_unit=getattr(line, "serving_unit", None),
        )
    step = OrderItem(
        id=line.id,
        inventory_item_id=line.inventory_item_id,
        quantity=abs(delta),
        unit_factor=line.unit_factor,
        stock_usage=line.stock_usage,
        serving_unit=getattr(line, "serving_unit", None),
    )
    account_id = str(order.account_id)
    account = db.get(Account, account_id)
    strict, flexible = _strict_and_flexible_lines(db, account, [step])
    change = Decimal("0")
    if delta > 0:
        block_recipe = bool(getattr(account, "block_sale_on_low_ingredients", False))
        common = {"account_id": account_id, "reason": "sale", "order_id": order.id, "user_id": user_id}
        movements = record_stock_out(db, strict, allow_negative=True, **common)
        movements += record_stock_out(db, flexible, allow_negative=False, **common)
        for movement in movements:
            change += Decimal(str(movement.total_cost or 0))
        if movements:
            order.stock_deducted = True
    else:
        now = datetime.utcnow()
        for ledger_line in strict + flexible:
            item = lock_item(db, ledger_line.inventory_item_id, account_id=account_id)
            if item is None or location_quantity(
                item,
                ledger_line.location,
                ledger_line.serving_unit,
                db=db,
            ) is None:
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
                serving_unit=ledger_line.serving_unit,
            )
            change -= Decimal(str(movement.total_cost or 0))
    if change:
        line.cost_total = (Decimal(str(line.cost_total or 0)) + change).quantize(MONEY)


def uses_ledger(db: Session, account_id: str) -> bool:
    return is_restaurant(db.get(Account, str(account_id)))
