"""Turn combo meals into plain meals built from a fixed recipe plus modifiers.

For every catalogue row still typed ``combo``:

* each included dish's recipe (times its quantity) is merged into the meal's own recipe,
  per shop that sells the meal;
* an included dish without a recipe but with tracked stock becomes an included
  one-option modifier, so selling the meal still deducts that dish;
* the included dishes' modifiers are attached to the meal (after the meal's own);
* the combo links are removed and the row becomes ``meal``.

Safe to re-run: converted rows are no longer ``combo``.
"""

from __future__ import annotations

import sys
from collections import OrderedDict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from app.models import (  # noqa: E402
    Catalogue,
    CatalogueModifierGroup,
    InventoryItem,
    ModifierGroup,
    ModifierOption,
    RecipeLine,
)


def _by_order(rows):
    return sorted(rows or [], key=lambda row: (row.sort_order or 0, str(row.id)))


def _tracked_stock(db: Session, account_id: str, product_id: str) -> bool:
    return (
        db.query(InventoryItem.id)
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.product_id == product_id,
            InventoryItem.stock_quantity.isnot(None),
        )
        .first()
        is not None
    )


def _included_dish_group(account_id: str, component: Catalogue, quantity: Decimal, now: datetime) -> ModifierGroup:
    name = (component.name or "Included dish")[:120]
    return ModifierGroup(
        account_id=account_id,
        name=name,
        min_select=1,
        max_select=1,
        included=True,
        created_at=now,
        updated_at=now,
        options=[
            ModifierOption(
                name=name,
                product_id=component.id,
                stock_qty=quantity,
                is_default=True,
                sort_order=0,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        ],
    )


def convert_combos(db: Session) -> int:
    combos = db.query(Catalogue).filter(Catalogue.product_type == "combo").all()
    now = datetime.utcnow()
    for combo in combos:
        parts = _by_order(combo.combo_component_links)
        account_ids = [
            account_id
            for (account_id,) in db.query(InventoryItem.account_id)
            .filter(InventoryItem.product_id == combo.id)
            .distinct()
        ]

        group_ids: list[str] = [link.group_id for link in _by_order(combo.modifier_group_links)]
        for part in parts:
            for link in _by_order(part.component.modifier_group_links if part.component else []):
                if link.group_id not in group_ids:
                    group_ids.append(link.group_id)

        for account_id in account_ids:
            totals: OrderedDict[str, Decimal] = OrderedDict()

            def add(ingredient_id: str, qty: Decimal) -> None:
                totals[ingredient_id] = totals.get(ingredient_id, Decimal("0")) + qty

            for line in _by_order(combo.recipe_lines):
                if line.account_id == account_id:
                    add(line.ingredient_product_id, Decimal(str(line.quantity)))
            for part in parts:
                component = part.component
                if component is None:
                    continue
                count = Decimal(str(part.quantity or 1))
                lines = [line for line in _by_order(component.recipe_lines) if line.account_id == account_id]
                for line in lines:
                    add(line.ingredient_product_id, Decimal(str(line.quantity)) * count)
                if not lines and _tracked_stock(db, account_id, component.id):
                    group = _included_dish_group(account_id, component, count, now)
                    db.add(group)
                    db.flush()
                    group_ids.append(group.id)

            existing = {
                line.ingredient_product_id: line for line in combo.recipe_lines if line.account_id == account_id
            }
            for index, (ingredient_id, qty) in enumerate(totals.items()):
                line = existing.get(ingredient_id)
                if line is None:
                    line = RecipeLine(
                        account_id=account_id,
                        ingredient_product_id=ingredient_id,
                        created_at=now,
                    )
                    combo.recipe_lines.append(line)
                line.quantity = qty
                line.sort_order = index

        linked = {link.group_id for link in combo.modifier_group_links}
        for index, group_id in enumerate(group_ids):
            if group_id in linked:
                continue
            combo.modifier_group_links.append(
                CatalogueModifierGroup(group_id=group_id, sort_order=index, created_at=now)
            )
        for index, link in enumerate(
            sorted(combo.modifier_group_links, key=lambda link: group_ids.index(link.group_id))
        ):
            link.sort_order = index

        for part in parts:
            db.delete(part)
        combo.product_type = "meal"
        combo.updated_at = now

    db.commit()
    return len(combos)


def main() -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        count = convert_combos(db)
        print(f"converted {count} combo meal(s) to meals" if count else "no combo meals left to convert")
    finally:
        db.close()


if __name__ == "__main__":
    main()
