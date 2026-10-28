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
from app.models import (
    Catalogue,
    CatalogueModifierGroup,
    ComboComponent,
    InventoryItem,
    ModifierGroup,
    ModifierOption,
    OrderItem,
)
from app.services.menu_options import line_stock_usage, option_availability
from app.services.restaurant_stock_service import prepare_recipe_batch
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


def _create_group(db, name, low, high, *options: ModifierOptionIn, included=False, is_extra=False):
    return menu.create_modifier_group(
        ModifierGroupIn(
            name=name,
            min_select=low,
            max_select=high,
            included=included,
            is_extra=is_extra,
            options=list(options),
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


def test_modifier_groups_keep_extras_separate_from_modifiers(db):
    created = menu.create_modifier_group(
        ModifierGroupIn(
            name="Add-ons",
            min_select=0,
            max_select=1,
            is_extra=True,
            options=[ModifierOptionIn(name="Avocado", product_id="coke", stock_qty=0.5)],
        ),
        request=None,
        db=db,
        session={},
    )["data"]
    assert created.is_extra is True

    updated = menu.update_modifier_group(
        created.id,
        ModifierGroupPatch(is_extra=False),
        request=None,
        db=db,
        session={},
    )["data"]
    assert updated.is_extra is False
    assert updated.options[0].product_id is None

    with pytest.raises(HTTPException) as exc:
        menu.create_modifier_group(
            ModifierGroupIn(name="Empty extras", is_extra=True, options=[]),
            request=None,
            db=db,
            session={},
        )
    assert exc.value.status_code == 422


def _extra_recipes(db, option_id, *lines):
    return menu.replace_extra_recipes(
        option_id,
        menu.OptionRecipesReplace(lines=[menu.OptionRecipeLineIn(**line) for line in lines]),
        request=None, db=db, session={},
    )["data"]


def test_extra_recipes_per_meal_attach_and_deduct_by_meal(db):
    _add_supply(db, "chicken", "Chicken", "kg", 5)
    _add_supply(db, "wings", "Chicken wings", "pcs", 40)
    group = _create_group(
        db, "Chicken extras", 0, 1, ModifierOptionIn(name="Chicken stick", price_delta=80), is_extra=True,
    )
    option_id = group.options[0].id

    saved = _extra_recipes(
        db, option_id,
        {"menu_product_id": "big-mac", "product_id": "chicken", "portions_per_unit": 8, "portion_unit": "stick"},
        {"menu_product_id": "fries", "product_id": "wings", "portions_per_unit": 1, "portion_unit": "piece"},
    )
    assert [(r.menu_product_id, r.product_id) for r in saved.recipes] == [("big-mac", "chicken"), ("fries", "wings")]
    assert saved.recipes[0].stock_qty == pytest.approx(0.125)
    linked = {link.product_id for link in db.query(CatalogueModifierGroup).filter_by(group_id=group.id)}
    assert linked == {"big-mac", "fries"}

    option = db.get(ModifierOption, option_id)
    on_burger = line_stock_usage(db, ACCOUNT, db.get(Catalogue, "big-mac"), [option])
    on_fries = line_stock_usage(db, ACCOUNT, db.get(Catalogue, "fries"), [option])
    assert [(row["stock_item_id"], row["qty"]) for row in on_burger if row["stock_item_id"] != "inv-big-mac"] == [
        ("inv-chicken", pytest.approx(0.125))
    ]
    assert [(row["stock_item_id"], row["qty"]) for row in on_fries] == [("inv-wings", pytest.approx(1))]

    with pytest.raises(HTTPException) as exc:
        _extra_recipes(
            db, option_id,
            {"menu_product_id": "big-mac", "product_id": "chicken", "portions_per_unit": 8, "portion_unit": "stick"},
            {"menu_product_id": "big-mac", "product_id": "chicken", "portions_per_unit": 4, "portion_unit": "stick"},
        )
    assert exc.value.status_code == 422

    modifier = _create_group(db, "Size", 1, 1, ModifierOptionIn(name="Large"))
    with pytest.raises(HTTPException) as exc:
        _extra_recipes(
            db, modifier.options[0].id,
            {"menu_product_id": "big-mac", "product_id": "chicken", "portions_per_unit": 8, "portion_unit": "stick"},
        )
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
    extra = _create_group(
        db, "Extras", 0, 1,
        ModifierOptionIn(name="Extra cheese", price_delta=50, product_id="cheese", stock_qty=0.05),
        is_extra=True,
    )
    changes = _create_group(db, "Changes", 0, 1, ModifierOptionIn(name="No onions"))
    assert extra.options[0].stock_qty == 0.05 and extra.options[0].product_unit == "kg"
    _attach(db, "big-mac", extra.id, changes.id)

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
    assert float(db.get(InventoryItem, "inv-coke").stock_quantity) == 10


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
        "fries",
        RecipeReplace(lines=[RecipeLineIn(product_id="flour", quantity=0.1)], serving_unit="plates"),
        request=None, db=db, session={},
    )
    assert body["data"][0]["name"] == "Flour" and body["data"][0]["unit"] == "kg"
    assert body["serving_unit"] == "plates"
    out = InventoryItemOut.from_model(db.get(InventoryItem, "inv-fries"))
    assert [(r.name, r.quantity) for r in out.product.recipe] == [("Flour", 0.1)]
    assert out.product.recipe_serving_unit == "plates"

    legacy_body = menu.replace_recipe(
        "fries", RecipeReplace(lines=[RecipeLineIn(product_id="flour", quantity=0.1)]),
        request=None, db=db, session={},
    )
    assert legacy_body["serving_unit"] == "plates"

    cleared = menu.replace_recipe(
        "fries", RecipeReplace(lines=[], serving_unit="sticks"),
        request=None, db=db, session={},
    )
    assert cleared["data"] == [] and cleared["serving_unit"] == "sticks"

    with pytest.raises(HTTPException) as exc:
        menu.replace_recipe(
            "fries", RecipeReplace(lines=[RecipeLineIn(product_id="big-mac", quantity=1)]),
            request=None, db=db, session={},
        )
    assert exc.value.status_code == 422


def test_recipe_lines_can_reuse_supply_for_different_equivalences(db):
    _add_supply(db, "flour", "Flour", "kg", 2)
    body = menu.replace_recipe(
        "fries",
        RecipeReplace(
            lines=[
                RecipeLineIn(product_id="flour", quantity=0.1, serving_unit="plates"),
                RecipeLineIn(product_id="flour", quantity=0.05, serving_unit="sticks"),
            ],
            serving_unit="plates",
        ),
        request=None,
        db=db,
        session={},
    )

    assert {line["serving_unit"] for line in body["data"]} == {"plates", "sticks"}
    product = db.get(Catalogue, "fries")
    plates = line_stock_usage(db, ACCOUNT, product, [], serving_unit="plate")
    sticks = line_stock_usage(db, ACCOUNT, product, [], serving_unit="sticks")
    assert plates[0]["qty"] == pytest.approx(0.1)
    assert sticks[0]["qty"] == pytest.approx(0.05)

    with pytest.raises(HTTPException) as exc:
        menu.replace_recipe(
            "fries",
            RecipeReplace(
                lines=[
                    RecipeLineIn(product_id="flour", quantity=0.1, serving_unit="plates"),
                    RecipeLineIn(product_id="flour", quantity=0.2, serving_unit="plates"),
                ],
            ),
            request=None,
            db=db,
            session={},
        )
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc:
        menu.replace_recipe(
            "fries",
            RecipeReplace(
                lines=[
                    RecipeLineIn(
                        product_id="flour",
                        batch_quantity=10,
                        batch_yield=72,
                        serving_unit="plates",
                    ),
                    RecipeLineIn(
                        product_id="coke",
                        batch_quantity=1,
                        batch_yield=73,
                        serving_unit="plates",
                    ),
                ],
                serving_unit="plates",
            ),
            request=None,
            db=db,
            session={},
        )
    assert exc.value.status_code == 422


def test_order_uses_menu_recipe_equivalence_not_inventory_sell_unit(db, monkeypatch):
    _add_supply(db, "flour", "Flour", "kg", 20)
    monkeypatch.setattr(orders, "is_restaurant", lambda _shop: True)
    recipe = menu.replace_recipe(
        "fries",
        RecipeReplace(
            lines=[
                RecipeLineIn(
                    product_id="flour",
                    quantity=10 / 72,
                    batch_quantity=10,
                    batch_yield=72,
                    serving_unit="plates",
                ),
                RecipeLineIn(product_id="flour", quantity=0.05, serving_unit="sticks"),
            ],
            serving_unit="plates",
        ),
        request=None,
        db=db,
        session={},
    )
    plates = next(line for line in recipe["data"] if line["serving_unit"] == "plates")
    assert plates["batch_quantity"] == pytest.approx(10)
    assert plates["batch_yield"] == pytest.approx(72)
    assert plates["quantity"] == pytest.approx(10 / 72)
    prepare_recipe_batch(db, ACCOUNT, "inv-fries", serving_unit="plates")
    db.commit()
    monkeypatch.setattr(
        orders,
        "resolve_sell_unit",
        lambda _item, unit: {"name": unit or "Piece", "factor": 1},
    )

    _order(db, {"inventory_item_id": "inv-fries", "quantity": 1, "sell_unit": "sticks"})
    db.expire_all()
    assert float(db.get(InventoryItem, "inv-flour").stock_quantity) == pytest.approx(10)
    assert float(db.get(InventoryItem, "inv-fries").prepared_quantity) == pytest.approx(71)
    usage = db.query(OrderItem).one().stock_usage
    assert usage[0]["prepared"] is True


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
    assert float(db.get(InventoryItem, "inv-coke").stock_quantity) == 10
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
        ModifierOptionIn(name="No onions", product_id="coke"),
        is_extra=True,
    )
    onions = next(option.id for option in group.options if option.name == "No onions")
    db.get(ModifierOption, onions).product_id = None
    db.commit()
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

    paid = _create_group(db, "Add a drink", 0, 2, ModifierOptionIn(name="Coke"))
    free = _create_group(
        db, "Drink", 1, 1, ModifierOptionIn(name="Coke"), included=True,
    )
    db.get(ModifierOption, paid.options[0].id).product_id = "coke"
    db.get(ModifierOption, free.options[0].id).product_id = "coke"
    db.commit()
    size = _create_group(db, "Size", 1, 1, ModifierOptionIn(name="Large", price_delta=60))

    assert migration.copy_supply_prices(db) == 1
    db.expire_all()
    assert float(db.get(ModifierOption, paid.options[0].id).price_delta) == 100
    assert float(db.get(ModifierOption, free.options[0].id).price_delta) == 0
    assert float(db.get(ModifierOption, size.options[0].id).price_delta) == 60
    assert migration.copy_supply_prices(db) == 0


def test_order_rejects_selling_price_below_buying_price(db):
    from decimal import Decimal
    from fastapi import HTTPException

    coke = db.get(InventoryItem, "inv-coke")
    coke.buying_price = Decimal("80.00")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _order(db, {"inventory_item_id": "inv-coke", "quantity": 1, "unit_price": 50})
    assert exc.value.status_code == 422
    assert "Selling price" in str(exc.value.detail)
    assert "less than buying price" in str(exc.value.detail)

    res = _order(db, {"inventory_item_id": "inv-coke", "quantity": 1, "unit_price": 85})
    assert "data" in res
    assert res["data"].total == Decimal("85.00")


def _sourced_modifiers(db):
    """Fries made from flour, an extra chicken stick on Big Mac, and a "Side & drink" modifier using them."""
    _add_supply(db, "flour", "Flour", "kg", 2)
    _add_supply(db, "chicken", "Chicken", "kg", 5)
    menu.replace_recipe(
        "fries",
        RecipeReplace(lines=[RecipeLineIn(product_id="flour", quantity=0.1)], serving_unit="plates"),
        request=None, db=db, session={},
    )
    extras = _create_group(db, "Chicken extras", 0, 1, ModifierOptionIn(name="Chicken stick"), is_extra=True)
    stick = extras.options[0].id
    _extra_recipes(
        db, stick,
        {"menu_product_id": "big-mac", "product_id": "chicken", "portions_per_unit": 8, "portion_unit": "stick"},
    )
    group = _create_group(
        db, "Side & drink", 0, 4,
        ModifierOptionIn(name="Coke", price_delta=100, source_kind="store_item", source_product_id="coke"),
        ModifierOptionIn(name="Fries", source_kind="menu", source_product_id="fries"),
        ModifierOptionIn(name="Chicken", source_kind="extra", source_option_id=stick),
        ModifierOptionIn(name="Spicy"),
    )
    _attach(db, "big-mac", group.id)
    return group, stick


def test_modifier_sources_reuse_store_menu_and_extra_stock(db):
    group, stick = _sourced_modifiers(db)
    by_name = {option.name: option for option in group.options}
    assert by_name["Coke"].source_kind == "store_item" and by_name["Coke"].source_name == "Coke"
    assert by_name["Chicken"].source_option_id == stick and by_name["Spicy"].source_kind is None

    burger = db.get(Catalogue, "big-mac")

    def usage(name):
        return line_stock_usage(db, ACCOUNT, burger, [db.get(ModifierOption, by_name[name].id)])

    assert usage("Coke") == [{"stock_item_id": "inv-coke", "qty": 1.0}]
    assert usage("Fries") == [
        {"stock_item_id": "inv-flour", "qty": pytest.approx(0.1), "recipe": True, "option": True}
    ]
    assert usage("Chicken") == [{"stock_item_id": "inv-chicken", "qty": pytest.approx(0.125)}]
    assert usage("Spicy") == []

    db.get(InventoryItem, "inv-fries").prepared_quantity = 5
    db.commit()
    assert usage("Fries") == [{"stock_item_id": "inv-fries", "qty": 1.0, "prepared": True, "option": True}]


def test_modifier_sources_deduct_on_a_restaurant_sale(db, monkeypatch):
    monkeypatch.setattr(orders, "is_restaurant", lambda _shop: True)
    _sourced_modifiers(db)
    menu.replace_recipe(
        "big-mac",
        RecipeReplace(
            lines=[RecipeLineIn(product_id="flour", quantity=0.01)],
            serving_unit="plates",
        ),
        request=None, db=db, session={},
    )
    db.get(InventoryItem, "inv-fries").prepared_quantity = 5
    db.commit()

    _order(db, {"inventory_item_id": "inv-big-mac", "quantity": 2,
                "modifier_option_ids": [_option_id(db, "Coke"), _option_id(db, "Fries"), _option_id(db, "Spicy")]})
    db.expire_all()
    assert float(db.get(InventoryItem, "inv-big-mac").stock_quantity) == 3
    assert float(db.get(InventoryItem, "inv-coke").stock_quantity) == 8
    assert float(db.get(InventoryItem, "inv-fries").prepared_quantity) == 3
    assert float(db.get(InventoryItem, "inv-flour").stock_quantity) == pytest.approx(1.98)


def test_modifier_sources_are_validated_and_ignored_on_extras(db):
    with pytest.raises(HTTPException) as exc:
        _create_group(db, "Bad", 0, 1, ModifierOptionIn(name="Chips", source_kind="menu", source_product_id="shared"))
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc:
        _create_group(db, "Bad", 0, 1, ModifierOptionIn(name="X", source_kind="extra", source_option_id="nope"))
    assert exc.value.status_code == 422

    extras = _create_group(
        db, "Extras", 0, 1,
        ModifierOptionIn(name="Coke", source_kind="store_item", source_product_id="coke"),
        is_extra=True,
    )
    assert extras.options[0].source_kind is None

    sides = _create_group(db, "Sides", 0, 1, ModifierOptionIn(name="Fries", source_kind="menu", source_product_id="fries"))
    with pytest.raises(HTTPException) as exc:
        _attach(db, "fries", sides.id)
    assert exc.value.status_code == 422


def test_modifier_sources_drive_availability(db):
    group, stick = _sourced_modifiers(db)
    by_name = {option.name: option.id for option in group.options}
    shop = SimpleNamespace(id=ACCOUNT, store_type="restaurant", kitchen_issuing_enabled=False)

    def rows():
        return {row["option_id"]: row for row in option_availability(db, shop)}

    current = rows()
    assert all(current[by_name[name]]["available"] for name in ("Coke", "Fries", "Chicken", "Spicy"))

    db.get(InventoryItem, "inv-coke").stock_quantity = 0
    db.get(InventoryItem, "inv-fries").prepared_quantity = 0
    db.commit()
    menu.set_modifier_option_active(stick, menu.OptionActivePatch(is_active=False), request=None, db=db, session={})
    current = rows()
    assert current[by_name["Coke"]]["reason"] == "out_of_stock"
    assert current[by_name["Fries"]]["reason"] == "out_of_stock"
    assert current[by_name["Chicken"]]["reason"] == "out_of_stock"
    assert current[by_name["Spicy"]]["available"]
