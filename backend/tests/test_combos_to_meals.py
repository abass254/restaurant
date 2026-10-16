"""The one-time migration that turns combo meals into meals built from modifiers."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Catalogue,
    CatalogueModifierGroup,
    ComboComponent,
    InventoryItem,
    ModifierGroup,
    ModifierOption,
    RecipeLine,
)

ACCOUNT = "acct-1"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "2026_10_15_210000_combos_to_meals.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("combos_to_meals", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()

    rows = [
        # (id, name, type, stock)
        ("meal", "Stew Meal", "combo", None),
        ("stew", "Beef stew", "meal", None),
        ("rice", "Rice plate", "meal", None),
        ("samosa", "Samosa", "meal", 20),
        ("beef", "Beef", "retail", 10),
        ("onion", "Onion", "retail", 30),
        ("grain", "Rice grain", "retail", 50),
    ]
    for pid, name, kind, stock in rows:
        session.add(Catalogue(id=pid, name=name, slug=pid, product_type=kind, created_by_account_id=ACCOUNT))
        session.add(
            InventoryItem(
                id=f"inv-{pid}", account_id=ACCOUNT, product_id=pid, stock_quantity=stock,
                inventory_role="raw_material" if kind == "retail" else "for_sale", is_active=True,
            )
        )
    session.flush()

    def recipe(product_id, ingredient_id, qty):
        session.add(RecipeLine(account_id=ACCOUNT, product_id=product_id, ingredient_product_id=ingredient_id,
                               quantity=qty))

    recipe("meal", "onion", 1)
    recipe("stew", "beef", 0.2)
    recipe("stew", "onion", 1)
    recipe("rice", "grain", 0.15)

    drink = ModifierGroup(account_id=ACCOUNT, name="Choose drink", min_select=1, max_select=1, included=True,
                          options=[ModifierOption(name="Water")])
    spice = ModifierGroup(account_id=ACCOUNT, name="Spice level", min_select=0, max_select=1,
                          options=[ModifierOption(name="Hot")])
    session.add_all([drink, spice])
    session.flush()
    session.add(CatalogueModifierGroup(product_id="meal", group_id=drink.id, sort_order=0))
    session.add(CatalogueModifierGroup(product_id="stew", group_id=spice.id, sort_order=0))
    session.add(CatalogueModifierGroup(product_id="rice", group_id=drink.id, sort_order=0))

    session.add(ComboComponent(combo_id="meal", component_product_id="stew", quantity=2, sort_order=0))
    session.add(ComboComponent(combo_id="meal", component_product_id="rice", quantity=1, sort_order=1))
    session.add(ComboComponent(combo_id="meal", component_product_id="samosa", quantity=3, sort_order=2))
    session.commit()
    yield session
    session.close()


def test_combo_becomes_meal_with_merged_recipe_and_modifiers(db):
    migration = _load_migration()
    assert migration.convert_combos(db) == 1

    db.expire_all()
    meal = db.get(Catalogue, "meal")
    assert meal.product_type == "meal"
    assert db.query(ComboComponent).count() == 0

    recipe = {line.ingredient_product_id: float(line.quantity) for line in meal.recipe_lines}
    assert recipe == {"onion": pytest.approx(3), "beef": pytest.approx(0.4), "grain": pytest.approx(0.15)}

    names = [link.group.name for link in sorted(meal.modifier_group_links, key=lambda link: link.sort_order)]
    assert names == ["Choose drink", "Spice level", "Samosa"]

    samosa = next(link.group for link in meal.modifier_group_links if link.group.name == "Samosa")
    assert samosa.included and samosa.min_select == 1 and samosa.max_select == 1
    option = samosa.options[0]
    assert option.product_id == "samosa" and float(option.stock_qty) == 3 and option.is_default

    # Component dishes stay on the menu untouched.
    assert db.get(Catalogue, "stew").product_type == "meal"
    assert len(db.get(Catalogue, "stew").recipe_lines) == 2

    assert migration.convert_combos(db) == 0
