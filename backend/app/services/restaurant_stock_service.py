"""Restaurant stock accountability: menu costing, stock card, stock takes and reports."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_FLOOR
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    Order,
    OrderItem,
    PreparedMenuStock,
    PurchaseOrder,
    RecipeServingUnit,
    StockMovement,
    StockTake,
    StockTakeLine,
)
from app.services.inventory_stock_service import (
    MONEY,
    InsufficientStockError,
    LedgerLine,
    QTY,
    StockLocation,
    location_quantity,
    lock_item,
    record_movement,
    record_stock_out,
    total_on_hand,
)
from app.services.sell_units import sell_units_for_item
from app.services.menu_options import account_recipe, line_stock_usage
from app.services.kitchen_menu_service import MENU_CATEGORIES
from app.services.order_stock_service import kitchen_issuing_on
from app.support.order_status import CANCELLED, REFUNDED

NON_STOCK_TYPES = ("meal", "combo", "service")
LOCATIONS = ("store", "kitchen")


class StockTakeError(ValueError):
    pass


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def day_bounds(start: date, end: date, tz_offset_minutes: int) -> tuple[datetime, datetime]:
    """Local calendar days [start, end] as naive-UTC datetimes (how rows are stored)."""
    offset = timedelta(minutes=tz_offset_minutes)
    begin = datetime.combine(start, datetime.min.time()) - offset
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time()) - offset
    return begin, finish


# --- Menu costing ------------------------------------------------------------


def menu_costing(db: Session, account_id: str) -> list[dict[str, Any]]:
    """Cost per portion, food cost % and portions left for each menu item.

    With kitchen issuing, ``portions_available`` is what the kitchen can make
    now and ``portions_with_store`` adds what the store could still issue.
    """
    kitchen_on = kitchen_issuing_on(db.get(Account, account_id))
    menu_rows = (
        db.query(InventoryItem)
        .join(Catalogue, Catalogue.id == InventoryItem.product_id)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.account_id == account_id,
            or_(
                Catalogue.product_type.in_(("meal", "combo")),
                and_(
                    ~Catalogue.product_type.in_(("combo", "addon", "service")),
                    func.replace(func.lower(func.trim(Catalogue.category)), " ", "_").in_(
                        MENU_CATEGORIES
                    ),
                ),
            ),
        )
        .order_by(Catalogue.name.asc())
        .all()
    )
    serving_units = dict(
        db.query(RecipeServingUnit.product_id, RecipeServingUnit.serving_unit)
        .filter(RecipeServingUnit.account_id == account_id)
        .all()
    )
    usages: dict[str, list[dict]] = {}
    unit_usages: dict[str, dict[str, list[dict]]] = {}
    stock_ids: set[str] = set()
    for row in menu_rows:
        recipe_units = {
            (line.serving_unit or "servings").strip()
            for line in (row.product.recipe_lines or [])
            if line.account_id == account_id
        } if row.product else set()
        if not recipe_units:
            recipe_units = {serving_units.get(str(row.product_id), "servings")}
        recipe_units = sorted(recipe_units)
        unit_usages[row.id] = {
            unit: line_stock_usage(db, account_id, row.product, [], serving_unit=unit)
            if row.product
            else []
            for unit in recipe_units
        }
        default_unit = serving_units.get(str(row.product_id))
        usage = unit_usages[row.id].get(default_unit) if default_unit else None
        usage = usage or next(iter(unit_usages[row.id].values()), [])
        usages[row.id] = usage
        stock_ids.update(
            entry["stock_item_id"]
            for entries in unit_usages[row.id].values()
            for entry in entries
        )

    stock = {
        item.id: item
        for item in (
            db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(InventoryItem.id.in_(stock_ids))
            .all()
            if stock_ids
            else []
        )
    }

    out: list[dict[str, Any]] = []
    for row in menu_rows:
        product = row.product
        has_recipe = bool(
            product
            and any(line.account_id == account_id for line in product.recipe_lines or [])
        ) or (
            product is not None
            and product.is_combo()
            and any(
                any(line.account_id == account_id for line in component.component.recipe_lines or [])
                for component in product.combo_component_links or []
                if component.component is not None
            )
        )
        cost = Decimal("0")
        missing_cost: list[str] = []
        portions: Decimal | None = None
        limiting: str | None = None
        portions_total: Decimal | None = None
        ingredients: list[dict[str, Any]] = []
        for entry in usages.get(row.id, []):
            item = stock.get(entry["stock_item_id"])
            if item is None:
                continue
            per_portion = Decimal(str(entry["qty"]))
            name = item.product.name if item.product else "Item"
            line_cost = None
            if item.buying_price is None:
                missing_cost.append(name)
            else:
                line_cost = (per_portion * Decimal(str(item.buying_price))).quantize(MONEY)
                cost += line_cost
            total = total_on_hand(item) or Decimal("0")
            from_kitchen = kitchen_on and (
                entry.get("recipe") or item.normalized_role() == "raw_material"
            )
            on_hand = Decimal(str(item.kitchen_quantity or 0)) if from_kitchen else Decimal(str(item.stock_quantity or 0))
            if per_portion > 0:
                can_make = max(on_hand, Decimal("0")) / per_portion
                if portions is None or can_make < portions:
                    portions = can_make
                    limiting = name
                can_make_total = max(total, Decimal("0")) / per_portion
                if portions_total is None or can_make_total < portions_total:
                    portions_total = can_make_total
            ingredients.append(
                {
                    "inventory_item_id": item.id,
                    "name": name,
                    "unit": (item.product.unit if item.product else None) or "Piece",
                    "quantity": float(per_portion),
                    "average_cost": _f(item.buying_price),
                    "cost": _f(line_cost),
                    "stock_quantity": _f(item.stock_quantity),
                    "kitchen_quantity": _f(item.kitchen_quantity),
                    "location": "kitchen" if from_kitchen else "store",
                    "recipe": bool(entry.get("recipe")),
                }
            )
        equivalences: list[dict[str, Any]] = []
        for unit, unit_entries in unit_usages.get(row.id, {}).items():
            capacity: Decimal | None = None
            unit_limiting: str | None = None
            for entry in unit_entries:
                item = stock.get(entry["stock_item_id"])
                if item is None:
                    capacity = Decimal("0")
                    unit_limiting = "Missing supply"
                    continue
                from_kitchen = kitchen_on and (
                    entry.get("recipe") or item.normalized_role() == "raw_material"
                )
                on_hand = (
                    Decimal(str(item.kitchen_quantity or 0))
                    if from_kitchen
                    else Decimal(str(item.stock_quantity or 0))
                )
                per_portion = Decimal(str(entry["qty"]))
                if per_portion > 0:
                    can_make = max(on_hand, Decimal("0")) / per_portion
                    if capacity is None or can_make < capacity:
                        capacity = can_make
                        unit_limiting = item.product.name if item.product else "Supply"
            prepared_balance = location_quantity(row, "prepared", unit, db=db)
            prepared_tracking = row.prepared_quantity is not None
            available = (
                prepared_balance
                if prepared_tracking
                else capacity
            )
            recipe_lines = account_recipe(product, account_id, unit) if product else []
            batch_counts: list[int] = []
            if recipe_lines:
                for recipe_line in recipe_lines:
                    item = stock.get(str(recipe_line.ingredient_product_id))
                    if item is None:
                        batch_counts.append(0)
                        continue
                    from_kitchen = kitchen_on
                    on_hand = (
                        Decimal(str(item.kitchen_quantity or 0))
                        if from_kitchen
                        else Decimal(str(item.stock_quantity or 0))
                    )
                    batch_qty = Decimal(str(recipe_line.batch_quantity or recipe_line.quantity))
                    if batch_qty > 0:
                        batch_counts.append(
                            int((max(on_hand, Decimal("0")) / batch_qty).to_integral_value(rounding=ROUND_FLOOR))
                        )
            equivalences.append(
                {
                    "serving_unit": unit,
                    "portions_available": (
                        int(available.to_integral_value(rounding=ROUND_FLOOR))
                        if available is not None
                        else None
                    ),
                    "prepared_quantity": _f(prepared_balance) if prepared_tracking else None,
                    "portions_producible": (
                        int(capacity.to_integral_value(rounding=ROUND_FLOOR))
                        if capacity is not None
                        else None
                    ),
                    "batches_producible": min(batch_counts) if batch_counts else None,
                    "limiting_ingredient": unit_limiting,
                }
            )
        default_equivalence = next(
            (
                equivalence
                for equivalence in equivalences
                if equivalence["serving_unit"] == serving_units.get(str(row.product_id))
            ),
            equivalences[0] if equivalences else None,
        )
        price = Decimal(str(row.selling_price)) if row.selling_price is not None else None
        out.append(
            {
                "inventory_item_id": row.id,
                "product_id": row.product_id,
                "name": product.name if product else "Item",
                "product_type": product.product_type if product else None,
                "serving_unit": serving_units.get(str(row.product_id), "servings"),
                "selling_price": _f(price),
                "has_recipe": has_recipe,
                "cost_per_portion": float(cost.quantize(MONEY)) if ingredients else None,
                "food_cost_percent": (
                    float((cost / price * 100).quantize(Decimal("0.1")))
                    if ingredients and price and price > 0
                    else None
                ),
                "gross_margin": float((price - cost).quantize(MONEY)) if ingredients and price is not None else None,
                "missing_cost": missing_cost,
                "portions_available": (
                    default_equivalence["portions_available"]
                    if default_equivalence
                    else None
                ),
                "prepared_quantity": (
                    default_equivalence["prepared_quantity"]
                    if default_equivalence
                    else _f(row.prepared_quantity)
                ),
                "limiting_ingredient": limiting,
                "portions_with_store": (
                    int(portions_total.to_integral_value(rounding=ROUND_FLOOR))
                    if kitchen_on and portions_total is not None
                    else None
                ),
                "ingredients": ingredients,
                "equivalences": equivalences,
            }
        )
    return out


def prepare_recipe_batch(
    db: Session,
    account_id: str,
    inventory_item_id: str,
    *,
    batch_count: int = 1,
    serving_unit: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Consume the defined ingredient batch and add its menu portions to prepared stock."""
    dish_item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.id == inventory_item_id,
            InventoryItem.account_id == account_id,
        )
        .with_for_update()
        .first()
    )
    if dish_item is None or dish_item.product is None:
        raise StockTakeError("Menu item not found.")
    if dish_item.prepared_quantity is None:
        raise StockTakeError("Save the batch recipe before preparing portions.")

    recipe_lines = account_recipe(dish_item.product, account_id, serving_unit)
    if not recipe_lines:
        raise StockTakeError("Set a recipe for this menu item before preparing portions.")
    effective_unit = serving_unit or recipe_lines[0].serving_unit or "servings"
    yields = {
        Decimal(str(line.batch_yield or 1))
        for line in recipe_lines
    }
    if len(yields) != 1:
        raise StockTakeError("All supplies in this recipe equivalence must have the same batch yield.")
    portions_per_batch = next(iter(yields))
    if portions_per_batch <= 0:
        raise StockTakeError("The recipe batch must make at least one menu portion.")

    product_ids = {str(line.ingredient_product_id) for line in recipe_lines}
    supplies = {
        item.product_id: item
        for item in (
            db.query(InventoryItem)
            .filter(
                InventoryItem.account_id == account_id,
                InventoryItem.product_id.in_(product_ids),
            )
            .with_for_update()
            .all()
        )
    }
    location: StockLocation = "kitchen" if kitchen_issuing_on(db.get(Account, account_id)) else "store"
    ingredient_lines: list[LedgerLine] = []
    for line in recipe_lines:
        supply = supplies.get(str(line.ingredient_product_id))
        if supply is None:
            raise StockTakeError("A recipe supply is no longer in this shop's inventory.")
        if location_quantity(supply, location) is None:
            raise StockTakeError(f"Stock for {supply.product.name if supply.product else 'a recipe supply'} is not tracked at the selected location.")
        ingredient_lines.append(
            LedgerLine(
                supply.id,
                Decimal(str(line.batch_quantity or line.quantity)) * batch_count,
                location=location,
            )
        )

    now = datetime.utcnow()
    try:
        ingredient_movements = record_stock_out(
            db,
            ingredient_lines,
            account_id=account_id,
            reason="production",
            allow_negative=False,
            user_id=user_id,
            note=f"Prepared {dish_item.product.name}: {batch_count} recipe batch(es)",
        )
        output_movement = record_movement(
            db,
            dish_item,
            account_id=account_id,
            direction="in",
            quantity=portions_per_batch * batch_count,
            reason="production",
            allow_negative=True,
            user_id=user_id,
            note=f"Prepared from {batch_count} recipe batch(es)",
            now=now,
            location="prepared",
            serving_unit=effective_unit,
        )
    except InsufficientStockError as exc:
        raise StockTakeError(str(exc)) from exc
    return {
        "inventory_item_id": dish_item.id,
        "name": dish_item.product.name,
        "prepared_quantity": float(
            location_quantity(dish_item, "prepared", effective_unit, db=db) or 0
        ),
        "serving_unit": effective_unit,
        "batch_count": batch_count,
        "portions_added": float(output_movement.quantity),
        "ingredient_movements": len(ingredient_movements),
    }


# --- Stock card ----------------------------------------------------------------


def stock_card(
    db: Session,
    account_id: str,
    inventory_item_id: str,
    *,
    limit: int = 200,
    before: datetime | None = None,
) -> dict[str, Any]:
    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.id == inventory_item_id, InventoryItem.account_id == account_id)
        .first()
    )
    if item is None:
        raise StockTakeError("Item not found.")
    query = db.query(StockMovement).filter(
        StockMovement.account_id == account_id,
        StockMovement.inventory_item_id == item.id,
    )
    if before is not None:
        query = query.filter(StockMovement.created_at < before)
    rows = query.order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).limit(limit).all()

    order_ids = {m.order_id for m in rows if m.order_id}
    po_ids = {m.purchase_order_id for m in rows if m.purchase_order_id}
    order_numbers = dict(
        db.query(Order.id, Order.order_number).filter(Order.id.in_(order_ids)).all()
    ) if order_ids else {}
    po_refs = dict(
        db.query(PurchaseOrder.id, PurchaseOrder.reference).filter(PurchaseOrder.id.in_(po_ids)).all()
    ) if po_ids else {}

    total = total_on_hand(item)
    return {
        "item": {
            "id": item.id,
            "name": item.product.name if item.product else "Item",
            "unit": (item.product.unit if item.product else None) or "Piece",
            "stock_quantity": _f(item.stock_quantity),
            "kitchen_quantity": _f(item.kitchen_quantity),
            "prepared_quantity": _f(item.prepared_quantity),
            "total_quantity": _f(total),
            "average_cost": _f(item.buying_price),
            "stock_value": (
                float((total * Decimal(str(item.buying_price))).quantize(MONEY))
                if total is not None and item.buying_price is not None
                else None
            ),
        },
        "movements": [
            {
                "id": m.id,
                "direction": m.direction,
                "reason": m.reason,
                "location": m.location or "store",
                "kitchen_issue_id": m.kitchen_issue_id,
                "quantity": float(m.quantity),
                "signed_quantity": float(m.quantity if m.direction == "in" else -m.quantity),
                "quantity_before": _f(m.quantity_before),
                "quantity_after": _f(m.quantity_after),
                "unit_cost": _f(m.unit_cost),
                "total_cost": _f(m.total_cost),
                "note": m.note,
                "order_id": m.order_id,
                "order_number": order_numbers.get(m.order_id),
                "purchase_order_id": m.purchase_order_id,
                "purchase_order_reference": po_refs.get(m.purchase_order_id),
                "stock_take_id": m.stock_take_id,
                "created_at": _iso(m.created_at),
                "voided_at": _iso(m.voided_at),
            }
            for m in rows
        ],
    }


# --- Stock takes -----------------------------------------------------------------


def _countable_items(
    db: Session,
    account_id: str,
    location: StockLocation | None = None,
) -> list[InventoryItem]:
    query = (
        db.query(InventoryItem)
        .join(Catalogue, Catalogue.id == InventoryItem.product_id)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.stock_quantity.isnot(None),
            ~func.lower(func.coalesce(Catalogue.product_type, "retail")).in_(NON_STOCK_TYPES),
        )
    )
    if location == "kitchen":
        query = query.filter(InventoryItem.kitchen_quantity.isnot(None))
    return query.order_by(Catalogue.name.asc()).all()


def _check_location(db: Session, account_id: str, location: str) -> StockLocation:
    if location not in LOCATIONS:
        raise StockTakeError("Unknown stock location.")
    if location == "kitchen" and not kitchen_issuing_on(db.get(Account, account_id)):
        raise StockTakeError("Turn on store and kitchen in Settings first.")
    return location  # type: ignore[return-value]


def get_stock_take(db: Session, account_id: str, take_id: str, *, lock: bool = False) -> StockTake:
    query = (
        db.query(StockTake)
        .options(selectinload(StockTake.lines).joinedload(StockTakeLine.inventory_item).joinedload(InventoryItem.product))
        .filter(StockTake.id == take_id, StockTake.account_id == account_id)
    )
    if lock:
        query = query.with_for_update(of=StockTake)
    take = query.first()
    if take is None:
        raise StockTakeError("Stock take not found.")
    return take


def create_stock_take(
    db: Session,
    account_id: str,
    *,
    user_id: str | None,
    inventory_item_ids: list[str] | None = None,
    notes: str | None = None,
    location: str = "store",
) -> StockTake:
    where = _check_location(db, account_id, location)
    items = _countable_items(db, account_id, where)
    if inventory_item_ids:
        wanted = set(inventory_item_ids)
        items = [item for item in items if item.id in wanted]
    if not items:
        raise StockTakeError(
            "Nothing in the kitchen to count yet." if where == "kitchen" else "No stock-tracked supplies to count."
        )
    now = datetime.utcnow()
    take = StockTake(
        account_id=account_id,
        status="draft",
        location=where,
        notes=(notes or "").strip() or None,
        created_by=user_id,
        created_at=now,
        updated_at=now,
    )
    take.lines = [
        StockTakeLine(
            inventory_item_id=item.id,
            item_name=item.product.name if item.product else "Item",
            expected_qty=location_quantity(item, where) or Decimal("0"),
            unit_cost=item.buying_price,
        )
        for item in items
    ]
    db.add(take)
    db.flush()
    return take


def save_counts(
    db: Session,
    account_id: str,
    take_id: str,
    counts: dict[str, Decimal | None],
) -> StockTake:
    take = get_stock_take(db, account_id, take_id, lock=True)
    if take.status != "draft":
        raise StockTakeError("This stock take is closed.")
    by_id = {line.id: line for line in take.lines}
    for line_id, counted in counts.items():
        line = by_id.get(line_id)
        if line is None:
            raise StockTakeError("That line isn't on this stock take.")
        if counted is not None and counted < 0:
            raise StockTakeError(f"{line.item_name}: count can't be negative.")
        line.counted_qty = Decimal(str(counted)).quantize(QTY) if counted is not None else None
    take.updated_at = datetime.utcnow()
    return take


def complete_stock_take(
    db: Session,
    account_id: str,
    take_id: str,
    *,
    user_id: str | None,
) -> StockTake:
    """Set on-hand to the counted figures, writing ``count_variance`` movements for differences."""
    take = get_stock_take(db, account_id, take_id, lock=True)
    if take.status != "draft":
        raise StockTakeError("This stock take is closed.")
    counted_lines = [line for line in take.lines if line.counted_qty is not None]
    if not counted_lines:
        raise StockTakeError("Enter at least one count before completing.")
    now = datetime.utcnow()
    where: StockLocation = "kitchen" if take.location == "kitchen" else "store"
    for line in counted_lines:
        item = lock_item(db, line.inventory_item_id, account_id=account_id)
        if item is None or item.stock_quantity is None:
            continue
        current = Decimal(str(location_quantity(item, where) or 0)).quantize(QTY)
        counted = Decimal(str(line.counted_qty)).quantize(QTY)
        line.expected_qty = current
        line.variance_qty = counted - current
        line.unit_cost = item.buying_price
        if counted == current:
            continue
        record_movement(
            db,
            item,
            account_id=account_id,
            direction="in" if counted > current else "out",
            quantity=abs(counted - current),
            reason="count_variance",
            allow_negative=True,
            note="Kitchen close-out count" if where == "kitchen" else "Stock take",
            user_id=user_id,
            links={"stock_take_id": take.id},
            now=now,
            location=where,
        )
    take.status = "completed"
    take.counted_at = now
    take.updated_at = now
    return take


def cancel_stock_take(db: Session, account_id: str, take_id: str) -> StockTake:
    take = get_stock_take(db, account_id, take_id, lock=True)
    if take.status != "draft":
        raise StockTakeError("This stock take is closed.")
    take.status = "cancelled"
    take.updated_at = datetime.utcnow()
    return take


def list_stock_takes(db: Session, account_id: str, location: str | None = None) -> list[StockTake]:
    query = (
        db.query(StockTake)
        .options(selectinload(StockTake.lines))
        .filter(StockTake.account_id == account_id)
    )
    if location in LOCATIONS:
        query = query.filter(StockTake.location == location)
    return query.order_by(StockTake.created_at.desc()).limit(100).all()


def stock_take_out(take: StockTake, *, with_lines: bool = True) -> dict[str, Any]:
    variance_value = Decimal("0")
    counted = 0
    for line in take.lines:
        if line.counted_qty is not None:
            counted += 1
        if line.variance_qty is not None and line.unit_cost is not None:
            variance_value += Decimal(str(line.variance_qty)) * Decimal(str(line.unit_cost))
    where: StockLocation = "kitchen" if take.location == "kitchen" else "store"
    out: dict[str, Any] = {
        "id": take.id,
        "status": take.status,
        "location": where,
        "notes": take.notes,
        "counted_at": _iso(take.counted_at),
        "created_at": _iso(take.created_at),
        "line_count": len(take.lines),
        "counted_count": counted,
        "variance_value": float(variance_value.quantize(MONEY)),
    }
    if with_lines:
        out["lines"] = [
            {
                "id": line.id,
                "inventory_item_id": line.inventory_item_id,
                "item_name": line.item_name,
                "unit": (
                    line.inventory_item.product.unit
                    if line.inventory_item is not None and line.inventory_item.product is not None
                    else None
                )
                or "Piece",
                "units": [
                    {"name": unit["name"], "factor": unit["factor"]}
                    for unit in sell_units_for_item(line.inventory_item)
                ] if line.inventory_item is not None else [],
                "expected_qty": _f(line.expected_qty),
                "current_qty": (
                    _f(location_quantity(line.inventory_item, where) or Decimal("0"))
                    if line.inventory_item is not None
                    else None
                ),
                "counted_qty": _f(line.counted_qty),
                "variance_qty": _f(line.variance_qty),
                "unit_cost": _f(line.unit_cost),
                "variance_value": (
                    float((Decimal(str(line.variance_qty)) * Decimal(str(line.unit_cost))).quantize(MONEY))
                    if line.variance_qty is not None and line.unit_cost is not None
                    else None
                ),
            }
            for line in take.lines
        ]
    return out


# --- Reports -----------------------------------------------------------------------

_BUCKETS = ("purchased", "issued", "returned", "used_in_sales", "wasted", "adjusted", "count_variance")


def _bucket(movement: StockMovement) -> str:
    reason = movement.reason
    if reason == "receive" or (reason == "adjustment" and movement.purchase_order_id):
        return "purchased"
    if reason == "issue":
        return "issued"
    if reason == "kitchen_return":
        return "returned"
    if reason in ("sale", "sale_reversal", "production"):
        return "used_in_sales"
    if reason in ("wastage", "damage"):
        return "wasted"
    if reason == "count_variance":
        return "count_variance"
    return "adjusted"


def usage_report(
    db: Session,
    account_id: str,
    start: datetime,
    end: datetime,
    location: str | None = None,
) -> dict[str, Any]:
    """Opening + purchased +/- issued/returned - used - wasted +/- adjusted +/- count variance = closing.

    Opening and closing are rebuilt from today's on-hand minus later ledger
    movements. ``count_variance`` is what physical counts found that nothing
    else explains: the number to watch for theft, spoilage or wrong recipes.

    ``location`` limits the report to the store or the kitchen; without it the
    two are combined and transfers between them cancel out. ``issued`` and
    ``returned`` are signed as stock coming into the location.
    """
    where: StockLocation | None = location if location in LOCATIONS else None  # type: ignore[assignment]
    items = _countable_items(db, account_id, where)
    item_ids = [item.id for item in items]
    if not item_ids:
        return {"location": where, "items": [], "totals": {}}
    query = db.query(StockMovement).filter(
        StockMovement.account_id == account_id,
        StockMovement.inventory_item_id.in_(item_ids),
        StockMovement.created_at >= start,
    )
    if where is not None:
        query = query.filter(StockMovement.location == where)
    movements = query.all()
    after_end: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    after_start: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    qty: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    value: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    for m in movements:
        signed = Decimal(str(m.quantity)) * (1 if m.direction == "in" else -1)
        signed_cost = Decimal(str(m.total_cost or 0)) * (1 if m.direction == "in" else -1)
        after_start[m.inventory_item_id] += signed
        if m.created_at >= end:
            after_end[m.inventory_item_id] += signed
            continue
        bucket = _bucket(m)
        qty[m.inventory_item_id][bucket] += signed
        value[m.inventory_item_id][bucket] += signed_cost

    rows: list[dict[str, Any]] = []
    totals = {f"{bucket}_value": Decimal("0") for bucket in _BUCKETS}
    for item in items:
        on_hand = (
            Decimal(str(location_quantity(item, where) or 0)) if where else (total_on_hand(item) or Decimal("0"))
        )
        opening = on_hand - after_start[item.id]
        closing = on_hand - after_end[item.id]
        row_qty = qty[item.id]
        if not row_qty and opening == 0 and closing == 0:
            continue
        row = {
            "inventory_item_id": item.id,
            "name": item.product.name if item.product else "Item",
            "unit": (item.product.unit if item.product else None) or "Piece",
            "average_cost": _f(item.buying_price),
            "opening": float(opening),
            "purchased": float(row_qty["purchased"]),
            "issued": float(row_qty["issued"]),
            "returned": float(row_qty["returned"]),
            "issued_value": float(value[item.id]["issued"]),
            # Usage and waste are shown as positive amounts consumed.
            "used_in_sales": float(-row_qty["used_in_sales"]),
            "wasted": float(-row_qty["wasted"]),
            "adjusted": float(row_qty["adjusted"]),
            "count_variance": float(row_qty["count_variance"]),
            "closing": float(closing),
            "used_in_sales_value": float(-value[item.id]["used_in_sales"]),
            "wasted_value": float(-value[item.id]["wasted"]),
            "purchased_value": float(value[item.id]["purchased"]),
            "count_variance_value": float(value[item.id]["count_variance"]),
        }
        for bucket in _BUCKETS:
            sign = -1 if bucket in ("used_in_sales", "wasted") else 1
            totals[f"{bucket}_value"] += sign * value[item.id][bucket]
        rows.append(row)
    return {
        "location": where,
        "items": rows,
        "totals": {key: float(val.quantize(MONEY)) for key, val in totals.items()},
    }


def kitchen_day_report(db: Session, account_id: str, start: datetime, end: datetime) -> dict[str, Any]:
    """The kitchen's day: what it had, was given, used, wasted, and what the count found.

    ``expected_closing`` is what should be left from the recipes; ``variance``
    is the difference the close-out count found (negative = missing).
    """
    if not kitchen_issuing_on(db.get(Account, account_id)):
        raise StockTakeError("Turn on store and kitchen in Settings first.")
    report = usage_report(db, account_id, start, end, location="kitchen")
    takes = (
        db.query(StockTake)
        .options(selectinload(StockTake.lines))
        .filter(
            StockTake.account_id == account_id,
            StockTake.location == "kitchen",
            StockTake.status == "completed",
            StockTake.counted_at >= start,
            StockTake.counted_at < end,
        )
        .order_by(StockTake.counted_at.asc())
        .all()
    )
    counted: dict[str, float] = {}
    for take in takes:
        for line in take.lines:
            if line.counted_qty is not None:
                counted[line.inventory_item_id] = float(line.counted_qty)
    for row in report["items"]:
        row["expected_closing"] = row["closing"] - row["count_variance"]
        row["counted"] = counted.get(row["inventory_item_id"])
    return {
        **report,
        "close_out_counts": [stock_take_out(take, with_lines=False) for take in takes],
    }


def profit_report(
    db: Session,
    account_id: str,
    start: datetime,
    end: datetime,
    tz_offset_minutes: int = 180,
) -> dict[str, Any]:
    """Sales vs cost of the stock they used, per menu item and per local calendar day."""
    local_offset = timedelta(minutes=tz_offset_minutes)
    rows = (
        db.query(Order.created_at, OrderItem)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .filter(
            Order.account_id == account_id,
            Order.created_at >= start,
            Order.created_at < end,
            ~Order.status.in_((CANCELLED, REFUNDED)),
        )
        .all()
    )
    by_item: dict[str, dict[str, Any]] = {}
    by_day: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {"revenue": Decimal("0"), "cost": Decimal("0")}
    )
    revenue_total = Decimal("0")
    cost_total = Decimal("0")
    uncosted = 0
    for created_at, line in rows:
        revenue = Decimal(str(line.line_total or 0))
        cost = Decimal(str(line.cost_total)) if line.cost_total is not None else None
        key = line.product_id or line.product_name
        entry = by_item.setdefault(
            key,
            {
                "name": line.product_name,
                "quantity": 0,
                "revenue": Decimal("0"),
                "cost": Decimal("0"),
                "uncosted_lines": 0,
            },
        )
        entry["quantity"] += int(line.quantity or 0)
        entry["revenue"] += revenue
        if cost is None:
            entry["uncosted_lines"] += 1
            uncosted += 1
        else:
            entry["cost"] += cost
            cost_total += cost
        revenue_total += revenue
        day = ((created_at or datetime.utcnow()) + local_offset).date().isoformat()
        by_day[day]["revenue"] += revenue
        by_day[day]["cost"] += cost or Decimal("0")

    def _margin(revenue: Decimal, cost: Decimal) -> float | None:
        if revenue <= 0:
            return None
        return float(((revenue - cost) / revenue * 100).quantize(Decimal("0.1")))

    items = sorted(
        (
            {
                "name": entry["name"],
                "quantity": entry["quantity"],
                "revenue": float(entry["revenue"]),
                "cost": float(entry["cost"]),
                "gross_profit": float(entry["revenue"] - entry["cost"]),
                "margin_percent": _margin(entry["revenue"], entry["cost"]),
                "uncosted_lines": entry["uncosted_lines"],
            }
            for entry in by_item.values()
        ),
        key=lambda row: row["revenue"],
        reverse=True,
    )
    return {
        "totals": {
            "revenue": float(revenue_total),
            "cost": float(cost_total),
            "gross_profit": float(revenue_total - cost_total),
            "margin_percent": _margin(revenue_total, cost_total),
            "uncosted_lines": uncosted,
        },
        "items": items,
        "days": [
            {
                "date": day,
                "revenue": float(vals["revenue"]),
                "cost": float(vals["cost"]),
                "gross_profit": float(vals["revenue"] - vals["cost"]),
            }
            for day, vals in sorted(by_day.items())
        ],
    }
