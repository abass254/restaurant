"""Option groups and combo meals: loading, validation and pricing of order lines."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Account,
    Catalogue,
    CatalogueModifierGroup,
    ComboComponent,
    InventoryItem,
    ModifierGroup,
    ModifierOption,
    ModifierOptionRecipe,
    RecipeLine,
)

from app.services.sell_units import sell_units_for_item
from app.support.store_type import is_restaurant


MAX_OPTION_COUNT = 20


class LineOptionsError(ValueError):
    pass


def menu_options_loaders(product_path):
    """Eager-load groups, options and combo parts beneath ``product_path``."""
    return [
        product_path.selectinload(Catalogue.modifier_group_links)
        .joinedload(CatalogueModifierGroup.group)
        .selectinload(ModifierGroup.options)
        .joinedload(ModifierOption.product),
        product_path.selectinload(Catalogue.combo_component_links)
        .joinedload(ComboComponent.component)
        .selectinload(Catalogue.modifier_group_links)
        .joinedload(CatalogueModifierGroup.group)
        .selectinload(ModifierGroup.options),
        product_path.selectinload(Catalogue.recipe_lines).joinedload(RecipeLine.ingredient),
        product_path.selectinload(Catalogue.recipe_serving_units),
    ]


def account_groups(product: Catalogue | None, account_id: str) -> list[ModifierGroup]:
    if product is None:
        return []
    return [
        link.group
        for link in product.modifier_group_links or []
        if link.group is not None and link.group.account_id == account_id
    ]


def rule_label(group: ModifierGroup) -> str:
    low, high = group.min_select or 0, group.max_select or 1
    if low == high:
        return f"pick {low}" if low else "optional"
    if low == 0:
        return f"up to {high}"
    return f"{low}–{high}"


@dataclass
class ResolvedOptions:
    price_delta: Decimal = Decimal("0")
    modifiers: list[dict] = field(default_factory=list)
    size_label: str | None = None
    chosen: list[ModifierOption] = field(default_factory=list)


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _stock_item_ids(db: Session, account_id: str, product_ids: set[str]) -> dict[str, str]:
    """Map catalogue ids to this shop's stock-tracked inventory rows."""
    if not product_ids:
        return {}
    rows = (
        db.query(InventoryItem.product_id, InventoryItem.id)
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.product_id.in_(product_ids),
            InventoryItem.stock_quantity.isnot(None),
        )
        .all()
    )
    return {str(product_id): str(item_id) for product_id, item_id in rows}


def option_unit_price(option: ModifierOption, group: ModifierGroup) -> Decimal:
    """Included groups are free; otherwise each pick charges the option's own price."""
    if group.included:
        return Decimal("0")
    return _money(option.price_delta)


def _unit_key(value: str | None) -> str:
    return (value or "").strip().casefold().rstrip("s")


def account_recipe(
    product: Catalogue | None,
    account_id: str,
    serving_unit: str | None = None,
) -> list[RecipeLine]:
    if product is None:
        return []
    lines = [line for line in product.recipe_lines or [] if line.account_id == account_id]
    if not lines:
        return []

    units = {line.serving_unit or "servings" for line in lines}
    if serving_unit:
        requested = _unit_key(serving_unit)
        matches = [line for line in lines if _unit_key(line.serving_unit) == requested]
        if matches:
            return matches

    defaults = [
        setting.serving_unit
        for setting in product.recipe_serving_units or []
        if setting.account_id == account_id
    ]
    preferred = defaults[0] if defaults else (next(iter(units)) if len(units) == 1 else None)
    if preferred:
        matches = [line for line in lines if _unit_key(line.serving_unit) == _unit_key(preferred)]
        if matches:
            return matches
    return lines if len(units) == 1 else []


def _recipe_line_quantity(line: RecipeLine) -> Decimal:
    batch_quantity = getattr(line, "batch_quantity", None)
    batch_yield = getattr(line, "batch_yield", None)
    if batch_quantity is not None and batch_yield is not None and Decimal(str(batch_yield)) > 0:
        return Decimal(str(batch_quantity)) / Decimal(str(batch_yield))
    return Decimal(str(line.quantity))


def line_stock_usage(
    db: Session,
    account_id: str,
    product: Catalogue,
    chosen: list[ModifierOption] | None = None,
    serving_unit: str | None = None,
) -> list[dict]:
    """Other stock one unit of ``product`` uses: recipe ingredients, meal parts and linked options.

    Returns ``[{"stock_item_id", "qty", "recipe"?, "option"?, "prepared"?}]``; supplies without
    tracked stock are skipped. Recipe amounts are estimates and carry ``recipe: True``.
    Rows a modifier brings in carry ``option: True`` so a prepared meal keeps them; a modifier
    using a prepared menu item takes one of its prepared portions (``prepared: True``).
    """
    # (catalogue id, qty, kind) where kind is "exact", "recipe" or "option_recipe".
    needs: list[tuple[str, Decimal, str]] = []
    for line in account_recipe(product, account_id, serving_unit):
        needs.append((str(line.ingredient_product_id), _recipe_line_quantity(line), "recipe"))
    if product.is_combo():
        for component in product.combo_component_links or []:
            parts = Decimal(str(component.quantity or 1))
            needs.append((str(component.component_product_id), parts, "exact"))
            for line in account_recipe(component.component, account_id):
                needs.append((str(line.ingredient_product_id), _recipe_line_quantity(line) * parts, "recipe"))
    meal_ids = {str(product.id)}
    if product.is_combo():
        meal_ids |= {str(component.component_product_id) for component in product.combo_component_links or []}
    # Prepared inventory row id -> portions, for modifiers that use a prepared menu item.
    prepared: dict[str, Decimal] = {}
    for option in chosen or []:
        source_kind = getattr(option, "source_kind", None)
        if source_kind:
            _source_needs(db, account_id, option, meal_ids, needs, prepared)
        else:
            needs.extend(_extra_needs(option, meal_ids))
    if not needs and not prepared:
        return []

    stock_ids = _stock_item_ids(db, account_id, {product_id for product_id, _, _ in needs})
    totals: dict[tuple[str, str], Decimal] = {}
    for product_id, qty, kind in needs:
        stock_id = stock_ids.get(product_id)
        if stock_id:
            key = (stock_id, kind)
            totals[key] = totals.get(key, Decimal("0")) + qty
    flags = {"exact": {}, "recipe": {"recipe": True}, "option_recipe": {"recipe": True, "option": True}}
    return [
        {"stock_item_id": stock_id, "qty": float(qty), **flags[kind]}
        for (stock_id, kind), qty in totals.items()
    ] + [
        {"stock_item_id": stock_id, "qty": float(qty), "prepared": True, "option": True}
        for stock_id, qty in prepared.items()
    ]


def _extra_needs(option: ModifierOption, meal_ids: set[str]) -> list[tuple[str, Decimal, str]]:
    """Supply one pick of an extra uses on these meals; legacy extras link one supply directly."""
    recipes = list(option.recipes or [])
    if recipes:
        return [
            (str(recipe.product_id), Decimal(str(recipe.stock_qty or 1)), "exact")
            for recipe in recipes
            if str(recipe.menu_product_id) in meal_ids
        ]
    if option.product_id:
        return [(str(option.product_id), Decimal(str(option.stock_qty or 1)), "exact")]
    return []


def _item_unit_factor(item: InventoryItem | None, portion_unit: str | None) -> Decimal:
    """Factor converting 1 ``portion_unit`` into the item's base unit using defined Unit conversions."""
    if item is None or not portion_unit or not portion_unit.strip():
        return Decimal("1")
    wanted = portion_unit.strip().lower()
    units = sell_units_for_item(item)
    base_name = (str(units[0].get("name") or "") if units else "").strip().lower()
    if wanted == base_name:
        return Decimal("1")
    for unit in units[1:]:
        if str(unit.get("name") or "").strip().lower() == wanted:
            ref = str(unit.get("reference_unit") or "").strip().lower()
            conv = unit.get("conversion_amount")
            if unit.get("reverse") is True and conv and (not ref or ref == base_name):
                return Decimal("1") / Decimal(str(conv))
            return Decimal(str(unit.get("factor") or 1))
    return Decimal("1")


def _source_needs(
    db: Session,
    account_id: str,
    option: ModifierOption,
    meal_ids: set[str],
    needs: list[tuple[str, Decimal, str]],
    prepared: dict[str, Decimal],
) -> None:
    """Stock one pick of a modifier uses through its source: a store item, a menu item or an extra."""
    kind = option.source_kind
    per_pick = Decimal(str(option.stock_qty or 1))
    if kind == "store_item" and option.source_product_id:
        inv = (
            db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(InventoryItem.account_id == account_id, InventoryItem.product_id == option.source_product_id)
            .first()
        )
        factor = _item_unit_factor(inv, getattr(option, "portion_unit", None))
        needs.append((str(option.source_product_id), per_pick * factor, "exact"))
    elif kind == "menu" and option.source_product_id:
        menu = option.source_product
        inv = (
            db.query(InventoryItem)
            .filter(InventoryItem.account_id == account_id, InventoryItem.product_id == option.source_product_id)
            .first()
        )
        if inv is not None and inv.prepared_quantity is not None:
            prepared[str(inv.id)] = prepared.get(str(inv.id), Decimal("0")) + per_pick
            return
        lines = account_recipe(menu, account_id)
        if lines:
            needs.extend(
                (str(line.ingredient_product_id), _recipe_line_quantity(line) * per_pick, "option_recipe")
                for line in lines
            )
        else:
            needs.append((str(option.source_product_id), per_pick, "exact"))
    elif kind == "extra" and option.source_option is not None:
        extra = option.source_option
        matched = _extra_needs(extra, meal_ids)
        if not matched and extra.recipes:
            first = extra.recipes[0]
            matched = [(str(first.product_id), Decimal(str(first.stock_qty or 1)), "exact")]
        needs.extend((pid, qty * per_pick, k) for pid, qty, k in matched)


def resolve_line_options(
    db: Session,
    account_id: str,
    product: Catalogue,
    option_ids: list[str],
) -> ResolvedOptions:
    """Validate picks against the item's groups (and its included dishes'), then price them.

    Raises :class:`LineOptionsError` with a cashier-readable message.
    """
    # (scope label, group). Scope label is the included dish's name for combos.
    scopes: list[tuple[str | None, ModifierGroup]] = [
        (None, group) for group in account_groups(product, account_id)
    ]
    components = list(product.combo_component_links or []) if product.is_combo() else []
    for component in components:
        for group in account_groups(component.component, account_id):
            scopes.append((component.component.name if component.component else None, group))

    option_scope: dict[str, tuple[int, ModifierOption]] = {}
    option_scopes: dict[str, list[int]] = {}
    for index, (_, group) in enumerate(scopes):
        for option in group.options or []:
            if option.is_active is False:
                continue
            option_scope.setdefault(option.id, (index, option))
            option_scopes.setdefault(option.id, []).append(index)

    # A repeated id means "that many of it"; group rules count distinct choices.
    counts: Counter[str] = Counter()
    for option_id in option_ids:
        if option_id not in option_scope:
            raise LineOptionsError(f"That choice isn't available for {product.name}.")
        counts[option_id] += 1
    if any(count > MAX_OPTION_COUNT for count in counts.values()):
        raise LineOptionsError(f"{product.name}: at most {MAX_OPTION_COUNT} of one choice.")
    picks = Counter(index for option_id in counts for index in option_scopes[option_id])

    for index, (label, group) in enumerate(scopes):
        count = picks[index]
        title = f"{label}: {group.name}" if label else group.name
        low, high = group.min_select or 0, group.max_select or 1
        if count < low:
            raise LineOptionsError(
                f"{product.name}: choose {low} for “{title}”."
                if low == 1
                else f"{product.name}: choose at least {low} for “{title}”."
            )
        if count > high:
            raise LineOptionsError(f"{product.name}: choose at most {high} for “{title}”.")

    result = ResolvedOptions()
    for component in components:
        result.modifiers.append(
            {
                "group": "Includes",
                "name": component.component.name if component.component else "Item",
                "price": 0,
                "quantity": component.quantity or 1,
                "kind": "component",
            }
        )

    chosen = sorted(
        (option_scope[option_id] for option_id in counts),
        key=lambda hit: hit[0],
    )
    for index, option in chosen:
        label, group = scopes[index]
        quantity = counts[option.id]
        price = option_unit_price(option, group) * quantity
        result.price_delta += price
        result.chosen.extend([option] * quantity)
        result.modifiers.append(
            {
                "group": label or group.name,
                "name": option.name,
                "price": float(price),
                "option_id": option.id,
                **({"quantity": quantity} if quantity > 1 else {}),
            }
        )
        if label is None and "size" in (group.name or "").lower() and result.size_label is None:
            result.size_label = option.name
    return result


def option_availability(db: Session, account: Account | None) -> list[dict]:
    """Each of the shop's options: sold out by staff, or short of stock for one pick.

    Stock is read where a sale takes it: the kitchen for raw materials when kitchen
    issuing is on, otherwise the store. Untracked or unlinked options never run out.
    """
    if account is None:
        return []
    account_id = str(account.id)
    options = (
        db.query(ModifierOption)
        .join(ModifierGroup, ModifierGroup.id == ModifierOption.group_id)
        .options(
            joinedload(ModifierOption.product),
            selectinload(ModifierOption.recipes).joinedload(ModifierOptionRecipe.product),
            joinedload(ModifierOption.source_product),
        )
        .filter(ModifierGroup.account_id == account_id)
        .all()
    )
    menu_recipes = {
        str(option.source_product_id): account_recipe(option.source_product, account_id)
        for option in options
        if option.source_kind == "menu" and option.source_product is not None
    }
    linked = (
        {str(option.product_id) for option in options if option.product_id}
        | {str(recipe.product_id) for option in options for recipe in option.recipes or []}
        | {
            str(option.source_product_id)
            for option in options
            if option.source_kind in ("store_item", "menu") and option.source_product_id
        }
        | {str(line.ingredient_product_id) for lines in menu_recipes.values() for line in lines}
    )
    stock = {
        str(item.product_id): item
        for item in (
            db.query(InventoryItem)
            .filter(InventoryItem.account_id == account_id, InventoryItem.product_id.in_(linked))
            .all()
            if linked
            else []
        )
    }
    kitchen_on = is_restaurant(account) and bool(getattr(account, "kitchen_issuing_enabled", False))

    def on_hand_of(product_id: str) -> tuple[Decimal | None, str | None]:
        item = stock.get(product_id)
        if item is None or item.stock_quantity is None:
            return None, None
        location = "kitchen" if kitchen_on and item.normalized_role() == "raw_material" else "store"
        raw = item.kitchen_quantity if location == "kitchen" else item.stock_quantity
        return Decimal(str(raw or 0)), location

    def source_row(option: ModifierOption, extra_rows: dict[str, dict]) -> dict:
        """on_hand / location / unit / short for a modifier that uses a store item, menu item or extra."""
        kind = option.source_kind
        per_pick = Decimal(str(option.stock_qty or 1))
        if kind == "extra":
            row = extra_rows.get(str(option.source_option_id))
            if row is None:
                return {"short": False}
            return {
                "short": not row["available"],
                "on_hand": row["on_hand"],
                "location": row["location"],
                "unit": row["unit"],
            }
        product_id = str(option.source_product_id or "")
        item = stock.get(product_id)
        unit = option.source_product.unit if option.source_product else None
        if item is not None and item.is_active is False:
            return {"short": True, "unit": unit}
        if kind == "menu" and item is not None and item.prepared_quantity is not None:
            have = Decimal(str(item.prepared_quantity or 0))
            return {"short": have < per_pick, "on_hand": float(have), "location": "prepared", "unit": unit}
        if kind == "menu" and menu_recipes.get(product_id):
            short = False
            for line in menu_recipes[product_id]:
                have, _ = on_hand_of(str(line.ingredient_product_id))
                if have is not None and have < _recipe_line_quantity(line) * per_pick:
                    short = True
            return {"short": short}
        have, where = on_hand_of(product_id)
        factor = _item_unit_factor(item, getattr(option, "portion_unit", None))
        needed = per_pick * factor
        return {
            "short": have is not None and have < needed,
            "on_hand": float(have) if have is not None else None,
            "location": where,
            "unit": unit,
        }

    rows: list[dict] = []
    sourced: list[ModifierOption] = []
    for option in options:
        if option.source_kind:
            sourced.append(option)
            continue
        # (supply id, per pick, unit); an extra stays available while any of its meals can make one.
        uses = [
            (str(recipe.product_id), Decimal(str(recipe.stock_qty or 1)), recipe.product.unit if recipe.product else None)
            for recipe in option.recipes or []
        ] or (
            [(str(option.product_id), Decimal(str(option.stock_qty or 1)), option.product.unit if option.product else None)]
            if option.product_id
            else []
        )
        on_hand: Decimal | None = None
        location: str | None = None
        unit: str | None = None
        short = bool(uses)
        for product_id, per_pick, use_unit in uses:
            have, where = on_hand_of(product_id)
            if have is None or have >= per_pick:
                short = False
            if have is not None and (on_hand is None or have > on_hand):
                on_hand, location, unit = have, where, use_unit
        if option.is_active is False:
            reason = "sold_out"
        elif short:
            reason = "out_of_stock"
        else:
            reason = None
        rows.append(
            {
                "option_id": option.id,
                "group_id": option.group_id,
                "is_active": option.is_active is not False,
                "available": reason is None,
                "reason": reason,
                "on_hand": float(on_hand) if on_hand is not None else None,
                "location": location,
                "unit": unit,
            }
        )

    by_option = {row["option_id"]: row for row in rows}
    for option in sourced:
        source = source_row(option, by_option)
        if option.is_active is False:
            reason = "sold_out"
        elif source["short"]:
            reason = "out_of_stock"
        else:
            reason = None
        rows.append(
            {
                "option_id": option.id,
                "group_id": option.group_id,
                "is_active": option.is_active is not False,
                "available": reason is None,
                "reason": reason,
                "on_hand": source.get("on_hand"),
                "location": source.get("location"),
                "unit": source.get("unit"),
            }
        )
    return rows
