"""Option groups, combo meals and how the order API prices and stocks them."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import menu, orders
from app.api.v1.menu import (
    ComboComponentIn,
    ComboComponentsReplace,
    ItemGroupsReplace,
    ModifierGroupIn,
    ModifierGroupPatch,
    ModifierOptionIn,
    RecipeLineIn,
    RecipeReplace,
)
from app.api.v1.orders import OrderCreate
from app.services.inventory_stock_service import restore_stock_for_order
from app.database import Base
from app.models import Catalogue, ComboComponent, InventoryItem, ModifierGroup, ModifierOption, OrderItem
from app.services.menu_options import option_availability
from app.schemas import InventoryItemOut

ACCOUNT = "acct-1"


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    user = SimpleNamespace(id="u1")
    monkeypatch.setattr(menu, "validate_csrf", lambda *_a, **_k: None)
    monkeypatch.setattr(menu, "require_user", lambda *_a, **_k: user)
    monkeypatch.setattr(menu, "assert_merchant_section_any_access", lambda *_a, **_k: None)
    monkeypatch.setattr(menu, "active_account_id", lambda _u: ACCOUNT)
    monkeypatch.setattr(orders, "validate_csrf", lambda *_a, **_k: None)
    monkeypatch.setattr(orders, "_auth_orders_user", lambda *_a, **_k: user)
    monkeypatch.setattr(orders, "_require_shop", lambda _u: ACCOUNT)

    items = [
        ("big-mac", "Big Mac", "meal", 500, 5),
        ("meal", "Big Mac Meal", "combo", 700, None),
        ("fries", "Fries", "meal", 150, None),
        ("coke", "Coke", "retail", 100, 10),
    ]
    for pid, name, kind, price, stock in items:
        session.add(
            Catalogue(id=pid, name=name, slug=pid, product_type=kind, created_by_account_id=ACCOUNT)
        )
        session.add(
            InventoryItem(
                id=f"inv-{pid}",
                account_id=ACCOUNT,
                product_id=pid,
                selling_price=price,
                stock_quantity=stock,
                inventory_role="for_sale",
                is_active=True,
            )
        )
    session.add(Catalogue(id="shared", name="Chips", slug="chips", product_type="meal"))
    session.commit()
    yield session
    session.close()


def _create_group(db, name, low, high, *options: ModifierOptionIn, included=False):
    return menu.create_modifier_group(
        ModifierGroupIn(
            name=name, min_select=low, max_select=high, included=included, options=list(options),
        ),
        request=None,
        db=db,
        session={},
    )["data"]


def _attach(db, product_id, *group_ids):
    return menu.replace_item_modifier_groups(
        product_id, ItemGroupsReplace(group_ids=list(group_ids)), request=None, db=db, session={},
    )


def _option_id(db, name):
    return db.query(ModifierOption).filter(ModifierOption.name == name).one().id


def _order(db, *lines: dict):
    payload = OrderCreate(
        source="walkin",
        fulfillment_type="dine_in",
        table_number="7",
        items=list(lines),
    )
    return orders.create_order(payload, request=None, db=db, session={})


@pytest.fixture()
def big_mac_meal(db):
    changes = _create_group(
        db, "Burger changes", 0, 3,
        ModifierOptionIn(name="No pickles"),
        ModifierOptionIn(name="Extra cheese", price_delta=50),
    )
    size = _create_group(
        db, "Size", 1, 1,
        ModifierOptionIn(name="Medium", is_default=True),
        ModifierOptionIn(name="Large", price_delta=60),
    )
    drink = _create_group(
        db, "Choose drink", 1, 1,
        ModifierOptionIn(name="Coke", product_id="coke"),
        ModifierOptionIn(name="Water"),
        included=True,
    )
    _attach(db, "big-mac", changes.id)
    _attach(db, "meal", size.id, drink.id)
    # Legacy combo data: new combos can no longer be created through the API.
    db.add(ComboComponent(combo_id="meal", component_product_id="big-mac", quantity=1))
    db.commit()


def test_new_combo_components_are_rejected(db):
    with pytest.raises(HTTPException) as exc:
        menu.replace_combo_components(
            "meal",
            ComboComponentsReplace(components=[ComboComponentIn(product_id="big-mac")]),
            request=None,
            db=db,
            session={},
        )
    assert exc.value.status_code == 422


def test_group_create_and_patch_replaces_options(db):
    group = _create_group(
        db, "Choose side", 1, 1,
        ModifierOptionIn(name="Fries"),
        ModifierOptionIn(name="Salad", price_delta=30),
    )
    fries_id = group.options[0].id
    updated = menu.update_modifier_group(
        group.id,
        ModifierGroupPatch(
            name="Side",
            options=[
                ModifierOptionIn(id=fries_id, name="Fries", is_default=True),
                ModifierOptionIn(name="Wedges", price_delta=40),
            ],
        ),
        request=None,
        db=db,
        session={},
    )["data"]
    assert updated.name == "Side"
    assert [o.name for o in updated.options] == ["Fries", "Wedges"]
    assert updated.options[0].id == fries_id and updated.options[0].is_default
    assert db.query(ModifierOption).count() == 2

    with pytest.raises(HTTPException) as exc:
        _create_group(db, "Bad", 2, 1, ModifierOptionIn(name="A"))
    assert exc.value.status_code == 422


def test_attach_requires_own_dish_and_own_groups(db):
    group = _create_group(db, "Extras", 0, 2, ModifierOptionIn(name="Egg", price_delta=20))
    with pytest.raises(HTTPException) as exc:
        _attach(db, "shared", group.id)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        _attach(db, "big-mac", "someone-elses-group")
    assert exc.value.status_code == 422

    body = _attach(db, "big-mac", group.id)
    assert [g["name"] for g in body["data"]] == ["Extras"]


def test_inventory_output_includes_groups_and_components(db, big_mac_meal):
    item = db.get(InventoryItem, "inv-meal")
    out = InventoryItemOut.from_model(item)
    assert [g.name for g in out.product.modifier_groups] == ["Size", "Choose drink"]
    component = out.product.combo_components[0]
    assert component.name == "Big Mac"
    assert [g.name for g in component.modifier_groups] == ["Burger changes"]


def test_required_group_and_max_are_enforced(db, big_mac_meal):
    with pytest.raises(HTTPException) as exc:
        _order(db, {"inventory_item_id": "inv-meal", "quantity": 1,
                    "modifier_option_ids": [_option_id(db, "Coke")]})
    assert exc.value.status_code == 422
    assert "Size" in str(exc.value.detail)

    with pytest.raises(HTTPException) as exc:
        _order(db, {"inventory_item_id": "inv-meal", "quantity": 1,
                    "modifier_option_ids": [_option_id(db, "Medium"), _option_id(db, "Large"),
                                            _option_id(db, "Coke")]})
    assert exc.value.status_code == 422


def test_group_shared_by_combo_and_its_dish_counts_one_pick_for_both(db, big_mac_meal):
    sauce = _create_group(db, "Sauce", 1, 1, ModifierOptionIn(name="Ketchup"))
    _attach(db, "big-mac", db.query(ModifierGroup).filter(ModifierGroup.name == "Burger changes").one().id, sauce.id)
    _attach(db, "meal", *[g.id for g in db.query(ModifierGroup).filter(
        ModifierGroup.name.in_(("Size", "Choose drink"))).all()], sauce.id)
    body = _order(db, {"inventory_item_id": "inv-meal", "quantity": 1,
                       "modifier_option_ids": [_option_id(db, "Medium"), _option_id(db, "Coke"),
                                               _option_id(db, "Ketchup")]})
    assert body["data"].items[0].product_name.startswith("Big Mac Meal")


def test_dish_price_is_computed_on_the_server(db, big_mac_meal):
    body = _order(db, {"inventory_item_id": "inv-big-mac", "quantity": 1, "unit_price": 1,
                       "modifier_option_ids": [_option_id(db, "Extra cheese")],
                       "modifiers": [{"name": "Chilli", "price": 10}]})
    line = db.query(OrderItem).one()
    assert float(line.unit_price) == 560.0
    assert [m["name"] for m in line.modifiers] == ["Extra cheese", "Chilli"]
    assert body["data"].table_number == "7"


def test_raw_material_option_deducts_its_amount(db):
    db.add(Catalogue(id="cheese", name="Cheese", slug="cheese", product_type="retail", unit="kg"))
    db.add(
        InventoryItem(
            id="inv-cheese", account_id=ACCOUNT, product_id="cheese", stock_quantity=2,
            inventory_role="raw_material", is_active=True,
        )
    )
    db.commit()
    group = _create_group(
        db, "Extras", 0, 2,
        ModifierOptionIn(name="Extra cheese", price_delta=50, product_id="cheese", stock_qty=0.05),
        ModifierOptionIn(name="No onions"),
    )
    assert group.options[0].stock_qty == 0.05 and group.options[0].product_unit == "kg"
    _attach(db, "big-mac", group.id)

    _order(db, {"inventory_item_id": "inv-big-mac", "quantity": 3,
                "modifier_option_ids": [_option_id(db, "Extra cheese"), _option_id(db, "No onions")]})
    db.expire_all()
    assert float(db.get(InventoryItem, "inv-cheese").stock_quantity) == pytest.approx(1.85)


def test_supply_option_charges_its_own_price_per_count(db):
    group = _create_group(
        db, "Add a drink", 0, 2,
        ModifierOptionIn(name="Coke", product_id="coke", price_delta=100),
        ModifierOptionIn(name="No ice"),
    )
    assert group.included is False
    _attach(db, "fries", group.id)
    coke = _option_id(db, "Coke")

    _order(db, {"inventory_item_id": "inv-fries", "quantity": 2,
                "modifier_option_ids": [coke, coke, _option_id(db, "No ice")]})
    line = db.query(OrderItem).one()
    assert float(line.unit_price) == 150 + 2 * 100
    mods = {m["name"]: m for m in line.modifiers}
    assert mods["Coke"]["quantity"] == 2 and mods["Coke"]["price"] == 200
    assert mods["No ice"]["price"] == 0
    db.expire_all()
    assert float(db.get(InventoryItem, "inv-coke").stock_quantity) == 10 - 2 * 2


def _add_supply(db, pid, name, unit, stock, role="raw_material"):
    db.add(Catalogue(id=pid, name=name, slug=pid, product_type="retail", unit=unit))
    db.add(
        InventoryItem(
            id=f"inv-{pid}", account_id=ACCOUNT, product_id=pid, stock_quantity=stock,
            inventory_role=role, is_active=True, buying_price=90,
        )
    )
    db.commit()


def test_recipe_is_saved_and_rejects_dishes(db):
    _add_supply(db, "flour", "Flour", "kg", 2)
    body = menu.replace_recipe(
        "fries", RecipeReplace(lines=[RecipeLineIn(product_id="flour", quantity=0.1)]),
        request=None, db=db, session={},
    )
    assert body["data"][0]["name"] == "Flour" and body["data"][0]["unit"] == "kg"
    out = InventoryItemOut.from_model(db.get(InventoryItem, "inv-fries"))
    assert [(r.name, r.quantity) for r in out.product.recipe] == [("Flour", 0.1)]

    with pytest.raises(HTTPException) as exc:
        menu.replace_recipe(
            "fries", RecipeReplace(lines=[RecipeLineIn(product_id="big-mac", quantity=1)]),
            request=None, db=db, session={},
        )
    assert exc.value.status_code == 422


def test_recipe_deducts_on_plain_sale_and_restores(db):
    _add_supply(db, "flour", "Flour", "kg", 0.25)
    menu.replace_recipe(
        "fries", RecipeReplace(lines=[RecipeLineIn(product_id="flour", quantity=0.1)]),
        request=None, db=db, session={},
    )
    # Recipe amounts are estimates: running short must not block the sale.
    _order(db, {"inventory_item_id": "inv-fries", "quantity": 3})
    db.expire_all()
    assert float(db.get(InventoryItem, "inv-flour").stock_quantity) == pytest.approx(-0.05)

    order = db.query(OrderItem).one().order
    restore_stock_for_order(db, order)
    db.commit()
    db.expire_all()
    assert float(db.get(InventoryItem, "inv-flour").stock_quantity) == pytest.approx(0.25)


def test_combo_line_name_price_and_stock(db, big_mac_meal):
    _order(db, {"inventory_item_id": "inv-meal", "quantity": 2,
                "modifier_option_ids": [_option_id(db, "Large"), _option_id(db, "Coke"),
                                        _option_id(db, "No pickles")]})
    line = db.query(OrderItem).one()
    assert line.product_name == "Big Mac Meal (Large)"
    assert float(line.unit_price) == 760.0
    groups = [(m["group"], m["name"]) for m in line.modifiers]
    assert ("Includes", "Big Mac") in groups
    assert ("Big Mac", "No pickles") in groups
    assert ("Choose drink", "Coke") in groups

    db.expire_all()
    assert float(db.get(InventoryItem, "inv-coke").stock_quantity) == 8
    assert float(db.get(InventoryItem, "inv-big-mac").stock_quantity) == 3


def test_option_sold_out_toggle_survives_group_save_and_blocks_orders(db):
    group = _create_group(
        db, "Starch", 1, 1,
        ModifierOptionIn(name="Rice"),
        ModifierOptionIn(name="Ugali"),
    )
    _attach(db, "fries", group.id)
    ugali = _option_id(db, "Ugali")

    out = menu.set_modifier_option_active(
        ugali, menu.OptionActivePatch(is_active=False), request=None, db=db, session={},
    )["data"]
    assert out.is_active is False

    other = ModifierGroup(account_id="acct-2", name="Theirs", options=[ModifierOption(name="X")])
    db.add(other)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        menu.set_modifier_option_active(
            other.options[0].id, menu.OptionActivePatch(is_active=False), request=None, db=db, session={},
        )
    assert exc.value.status_code == 404

    menu.update_modifier_group(
        group.id,
        ModifierGroupPatch(name="Starch", options=[
            ModifierOptionIn(id=_option_id(db, "Rice"), name="Rice"),
            ModifierOptionIn(id=ugali, name="Ugali"),
        ]),
        request=None, db=db, session={},
    )
    db.expire_all()
    assert db.get(ModifierOption, ugali).is_active is False

    with pytest.raises(HTTPException) as exc:
        _order(db, {"inventory_item_id": "inv-fries", "quantity": 1, "modifier_option_ids": [ugali]})
    assert exc.value.status_code == 422


def test_option_availability_reasons(db):
    _add_supply(db, "cheese", "Cheese", "kg", 2)
    db.get(InventoryItem, "inv-cheese").kitchen_quantity = 0.01
    db.commit()
    group = _create_group(
        db, "Extras", 0, 3,
        ModifierOptionIn(name="Coke", product_id="coke"),
        ModifierOptionIn(name="Cheese", product_id="cheese", stock_qty=0.05),
        ModifierOptionIn(name="No onions"),
    )
    shop = SimpleNamespace(id=ACCOUNT, store_type="restaurant", kitchen_issuing_enabled=False)

    def reasons():
        return {row["option_id"]: row for row in option_availability(db, shop)}

    rows = reasons()
    coke, cheese, onions = (o.id for o in group.options)
    assert rows[coke]["available"] and rows[coke]["on_hand"] == 10 and rows[coke]["location"] == "store"
    assert rows[cheese]["available"] and rows[cheese]["location"] == "store"
    assert rows[onions]["available"] and rows[onions]["on_hand"] is None

    shop.kitchen_issuing_enabled = True
    rows = reasons()
    assert rows[cheese]["reason"] == "out_of_stock" and rows[cheese]["location"] == "kitchen"
    assert rows[coke]["available"]

    db.get(InventoryItem, "inv-coke").stock_quantity = 0
    db.get(ModifierOption, onions).is_active = False
    db.commit()
    rows = reasons()
    assert rows[coke]["reason"] == "out_of_stock"
    assert rows[onions]["reason"] == "sold_out" and not rows[onions]["available"]


def test_legacy_supply_options_get_their_supply_price(db):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "migrations" / "2026_10_15_220000_option_prices_explicit.py"
    spec = importlib.util.spec_from_file_location("option_prices_explicit", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    paid = _create_group(db, "Add a drink", 0, 2, ModifierOptionIn(name="Coke", product_id="coke"))
    free = _create_group(
        db, "Drink", 1, 1, ModifierOptionIn(name="Coke", product_id="coke"), included=True,
    )
    size = _create_group(db, "Size", 1, 1, ModifierOptionIn(name="Large", price_delta=60))

    assert migration.copy_supply_prices(db) == 1
    db.expire_all()
    assert float(db.get(ModifierOption, paid.options[0].id).price_delta) == 100
    assert float(db.get(ModifierOption, free.options[0].id).price_delta) == 0
    assert float(db.get(ModifierOption, size.options[0].id).price_delta) == 60
    assert migration.copy_supply_prices(db) == 0
