"""Option groups and combo meals: loading, validation and pricing of order lines."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import (
    Catalogue,
    CatalogueModifierGroup,
    ComboComponent,
    InventoryItem,
    ModifierGroup,
    ModifierOption,
    RecipeLine,
)


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


def _supply_prices(db: Session, account_id: str, product_ids: set[str]) -> dict[str, Decimal]:
    """This shop's selling prices for the given catalogue ids (unpriced supplies are left out)."""
    if not product_ids:
        return {}
    rows = (
        db.query(InventoryItem.product_id, InventoryItem.selling_price)
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.product_id.in_(product_ids),
            InventoryItem.selling_price.isnot(None),
        )
        .all()
    )
    return {str(product_id): _money(price) for product_id, price in rows}


def option_unit_price(
    option: ModifierOption,
    group: ModifierGroup,
    supply_prices: dict[str, Decimal],
) -> Decimal:
    """Included groups are free; a supply charges its selling price, else the option's own price."""
    if group.included:
        return Decimal("0")
    if option.product_id and str(option.product_id) in supply_prices:
        return supply_prices[str(option.product_id)]
    return _money(option.price_delta)


def account_recipe(product: Catalogue | None, account_id: str) -> list[RecipeLine]:
    if product is None:
        return []
    return [line for line in product.recipe_lines or [] if line.account_id == account_id]


def line_stock_usage(
    db: Session,
    account_id: str,
    product: Catalogue,
    chosen: list[ModifierOption] | None = None,
) -> list[dict]:
    """Other stock one unit of ``product`` uses: recipe ingredients, meal parts and linked options.

    Returns ``[{"stock_item_id", "qty", "recipe"?}]``; supplies without tracked stock are
    skipped. Recipe amounts are estimates and carry ``recipe: True``.
    """
    # (catalogue id, qty, is recipe estimate)
    needs: list[tuple[str, Decimal, bool]] = []
    for line in account_recipe(product, account_id):
        needs.append((str(line.ingredient_product_id), Decimal(str(line.quantity)), True))
    if product.is_combo():
        for component in product.combo_component_links or []:
            parts = Decimal(str(component.quantity or 1))
            needs.append((str(component.component_product_id), parts, False))
            for line in account_recipe(component.component, account_id):
                needs.append((str(line.ingredient_product_id), Decimal(str(line.quantity)) * parts, True))
    for option in chosen or []:
        if option.product_id:
            needs.append((str(option.product_id), Decimal(str(option.stock_qty or 1)), False))
    if not needs:
        return []

    stock_ids = _stock_item_ids(db, account_id, {product_id for product_id, _, _ in needs})
    totals: dict[tuple[str, bool], Decimal] = {}
    for product_id, qty, is_recipe in needs:
        stock_id = stock_ids.get(product_id)
        if stock_id:
            key = (stock_id, is_recipe)
            totals[key] = totals.get(key, Decimal("0")) + qty
    return [
        {"stock_item_id": stock_id, "qty": float(qty), **({"recipe": True} if is_recipe else {})}
        for (stock_id, is_recipe), qty in totals.items()
    ]


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
    for index, (_, group) in enumerate(scopes):
        for option in group.options or []:
            if option.is_active is False:
                continue
            option_scope.setdefault(option.id, (index, option))

    # A repeated id means "that many of it"; group rules count distinct choices.
    counts: Counter[str] = Counter()
    for option_id in option_ids:
        if option_id not in option_scope:
            raise LineOptionsError(f"That choice isn't available for {product.name}.")
        counts[option_id] += 1
    if any(count > MAX_OPTION_COUNT for count in counts.values()):
        raise LineOptionsError(f"{product.name}: at most {MAX_OPTION_COUNT} of one choice.")
    picks = Counter(option_scope[option_id][0] for option_id in counts)

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
    supply_prices = _supply_prices(
        db,
        account_id,
        {str(option.product_id) for _, option in chosen if option.product_id},
    )
    for index, option in chosen:
        label, group = scopes[index]
        quantity = counts[option.id]
        price = option_unit_price(option, group, supply_prices) * quantity
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
