"""Restaurant supplies → menu → POS: ledger, purchase orders, stock takes, reports.

Retail shops must keep their original behaviour (no ledger rows on sales).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import menu, orders
from app.api.v1.menu import ItemGroupsReplace, RecipeLineIn, RecipeReplace
from app.api.v1.orders import OrderCreate, OrderTransition, OrderUpdate
from app.database import Base
from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    ModifierGroup,
    Order,
    OrderItem,
    PurchaseOrder,
    RecipeLine,
    ShopCustomer,
    ShopSupplier,
    StockMovement,
)
from app.schemas import _inventory_product_out
from app.services.catalog.catalog_types import CatalogItem
from app.services.inventory_stock_service import weighted_average_cost
from app.services.order_creation import build_catalog_order
from app.services.order_notification_service import OrderNotificationService
from app.services.order_stock_service import adjust_line_quantity, release_order_holds
from app.services.purchase_order_service import (
    LineInput,
    PurchaseOrderError,
    PurchaseOrderService,
    ReceiveInput,
)
from app.services.restaurant_stock_service import (
    complete_stock_take,
    create_stock_take,
    menu_costing,
    prepare_recipe_batch,
    profit_report,
    save_counts,
    usage_report,
)
from app.services.sell_units import buy_units_for_item
from app.support.store_type import require_restaurant_account

ACCOUNT = "acct-r"


def _make_db(monkeypatch, store_type: str):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    user = SimpleNamespace(id="u1")
    for module in (menu, orders):
        monkeypatch.setattr(module, "validate_csrf", lambda *_a, **_k: None)
    monkeypatch.setattr(menu, "require_user", lambda *_a, **_k: user)
    monkeypatch.setattr(menu, "assert_merchant_section_any_access", lambda *_a, **_k: None)
    monkeypatch.setattr(menu, "active_account_id", lambda _u: ACCOUNT)
    monkeypatch.setattr(orders, "_auth_orders_user", lambda *_a, **_k: user)
    monkeypatch.setattr(orders, "_require_shop", lambda _u: ACCOUNT)
    monkeypatch.setattr(orders, "require_store_admin", lambda *_a, **_k: None)

    session.add(
        Account(
            id=ACCOUNT,
            business_name="Mama Kitchen",
            business_location="Nairobi",
            business_category="restaurant",
            store_type=store_type,
        )
    )
    # (id, name, type, unit, selling price, stock, buying price, role)
    rows = [
        ("chapati", "Chapati", "meal", None, 30, None, None, "for_sale"),
        ("soda", "Soda", "retail", "bottle", 80, 24, 50, "for_sale"),
        ("flour", "Flour", "retail", "kg", None, 10, 100, "raw_material"),
        ("oil", "Cooking oil", "retail", "litre", None, 5, 300, "raw_material"),
        ("eggs", "Eggs", "retail", "piece", 25, 30, 15, "both"),
    ]
    for pid, name, kind, unit, price, stock, cost, role in rows:
        session.add(
            Catalogue(id=pid, name=name, slug=pid, product_type=kind, unit=unit, created_by_account_id=ACCOUNT)
        )
        session.add(
            InventoryItem(
                id=f"inv-{pid}",
                account_id=ACCOUNT,
                product_id=pid,
                selling_price=price,
                stock_quantity=stock,
                buying_price=cost,
                inventory_role=role,
                is_active=True,
            )
        )
    session.add(ShopSupplier(id="sup-1", account_id=ACCOUNT, name="Unga Wholesalers", phone="0700000001"))
    session.commit()
    menu.replace_recipe(
        "chapati",
        RecipeReplace(
            lines=[
                RecipeLineIn(product_id="flour", quantity=0.1),
                RecipeLineIn(product_id="oil", quantity=0.01),
            ]
        ),
        request=None,
        db=session,
        session={},
    )
    return session


@pytest.fixture()
def rdb(monkeypatch):
    session = _make_db(monkeypatch, "restaurant")
    yield session
    session.close()


@pytest.fixture()
def retail_db(monkeypatch):
    session = _make_db(monkeypatch, "retail")
    yield session
    session.close()


def _order(db, *lines: dict):
    payload = OrderCreate(source="walkin", fulfillment_type="dine_in", items=list(lines))
    return orders.create_order(payload, request=None, db=db, session={})["data"]


def _stock(db, item_id: str) -> float:
    db.expire_all()
    return float(db.get(InventoryItem, item_id).stock_quantity)


# --- POS sale --------------------------------------------------------------------


def test_restaurant_sale_writes_ledger_and_cost(rdb):
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10},
                 {"inventory_item_id": "inv-soda", "quantity": 2})
    assert _stock(rdb, "inv-flour") == pytest.approx(9.0)
    assert _stock(rdb, "inv-oil") == pytest.approx(4.9)
    assert _stock(rdb, "inv-soda") == 22

    sales = rdb.query(StockMovement).filter(StockMovement.reason == "sale").all()
    assert {m.inventory_item_id for m in sales} == {"inv-flour", "inv-oil", "inv-soda"}
    assert all(m.order_id == out.id and m.order_item_id for m in sales)
    lines = {line.product_name: line for line in rdb.query(OrderItem).all()}
    # 10 chapati: 1kg flour @100 + 0.1L oil @300 = 130
    assert float(lines["Chapati"].cost_total) == pytest.approx(130.0)
    assert float(lines["Soda"].cost_total) == pytest.approx(100.0)
    assert rdb.get(Order, out.id).stock_deducted is True


def test_restaurant_meal_without_recipe_cannot_be_sold(rdb):
    rdb.add(
        Catalogue(
            id="unconfigured-meal",
            name="Unconfigured meal",
            slug="unconfigured-meal",
            product_type="meal",
            created_by_account_id=ACCOUNT,
        )
    )
    rdb.add(
        InventoryItem(
            id="inv-unconfigured-meal",
            account_id=ACCOUNT,
            product_id="unconfigured-meal",
            selling_price=45,
            inventory_role="for_sale",
            is_active=True,
        )
    )
    rdb.commit()

    with pytest.raises(HTTPException) as exc:
        _order(rdb, {"inventory_item_id": "inv-unconfigured-meal", "quantity": 1})

    assert exc.value.status_code == 422
    assert "recipe" in str(exc.value.detail).lower()


def test_recipe_backed_restaurant_meal_needs_a_menu_price(rdb):
    rdb.get(InventoryItem, "inv-chapati").selling_price = None
    rdb.commit()

    with pytest.raises(HTTPException) as exc:
        _order(
            rdb,
            {"inventory_item_id": "inv-chapati", "quantity": 1, "unit_price": 30},
        )

    assert exc.value.status_code == 422
    assert "price" in str(exc.value.detail).lower()


def test_restaurant_meal_without_recipe_can_receive_modifiers(rdb):
    rdb.query(RecipeLine).filter(
        RecipeLine.account_id == ACCOUNT,
        RecipeLine.product_id == "chapati",
    ).delete()
    group = ModifierGroup(
        id="chapati-modifier",
        account_id=ACCOUNT,
        name="Preparation",
        min_select=0,
        max_select=1,
    )
    rdb.add(group)
    rdb.commit()

    res = menu.replace_item_modifier_groups(
        "chapati",
        ItemGroupsReplace(group_ids=[group.id]),
        request=None,
        db=rdb,
        session={},
    )

    assert [g["id"] for g in res["data"]] == [group.id]


def test_restaurant_meal_with_modifiers_can_have_recipe_cleared(rdb):
    group = ModifierGroup(
        id="chapati-modifier",
        account_id=ACCOUNT,
        name="Preparation",
        min_select=0,
        max_select=1,
    )
    rdb.add(group)
    rdb.commit()
    menu.replace_item_modifier_groups(
        "chapati",
        ItemGroupsReplace(group_ids=[group.id]),
        request=None,
        db=rdb,
        session={},
    )

    res = menu.replace_recipe(
        "chapati",
        RecipeReplace(lines=[]),
        request=None,
        db=rdb,
        session={},
    )

    assert res["data"] == []


def test_preparing_batch_consumes_kitchen_supplies_and_sales_consume_ready_portions(rdb):
    account = rdb.get(Account, ACCOUNT)
    account.kitchen_issuing_enabled = True
    flour = rdb.get(InventoryItem, "inv-flour")
    oil = rdb.get(InventoryItem, "inv-oil")
    flour.kitchen_quantity = 10
    oil.kitchen_quantity = 5
    menu.replace_recipe(
        "chapati",
        RecipeReplace(
            lines=[
                RecipeLineIn(
                    product_id="flour",
                    quantity=0.1,
                    batch_quantity=1,
                    batch_yield=10,
                    serving_unit="plates",
                ),
                RecipeLineIn(
                    product_id="oil",
                    quantity=0.01,
                    batch_quantity=0.1,
                    batch_yield=10,
                    serving_unit="plates",
                ),
            ],
            serving_unit="plates",
        ),
        request=None,
        db=rdb,
        session={},
    )
    dish = rdb.get(InventoryItem, "inv-chapati")
    assert dish.prepared_quantity == 0

    prepared = prepare_recipe_batch(rdb, ACCOUNT, dish.id, user_id="u1")
    rdb.commit()
    rdb.expire_all()
    assert prepared["portions_added"] == pytest.approx(10)
    assert float(rdb.get(InventoryItem, "inv-flour").kitchen_quantity) == pytest.approx(9)
    assert float(rdb.get(InventoryItem, "inv-oil").kitchen_quantity) == pytest.approx(4.9)
    assert float(rdb.get(InventoryItem, "inv-chapati").prepared_quantity) == pytest.approx(10)
    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["inventory_item_id"] == dish.id)
    assert costing["portions_available"] == 10
    assert costing["serving_unit"] == "plates"

    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 2})
    rdb.expire_all()
    assert float(rdb.get(InventoryItem, "inv-chapati").prepared_quantity) == pytest.approx(8)
    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["inventory_item_id"] == dish.id)
    assert costing["portions_available"] == 8
    assert float(rdb.get(InventoryItem, "inv-flour").kitchen_quantity) == pytest.approx(9)
    assert float(rdb.get(InventoryItem, "inv-oil").kitchen_quantity) == pytest.approx(4.9)

    sales = rdb.query(StockMovement).filter(StockMovement.reason == "sale").all()
    assert len(sales) == 1
    assert sales[0].inventory_item_id == "inv-chapati"
    assert sales[0].location == "prepared"
    order = rdb.query(Order).filter(Order.id == sales[0].order_id).one()
    release_order_holds(rdb, order)
    rdb.commit()
    rdb.expire_all()
    assert float(rdb.get(InventoryItem, "inv-chapati").prepared_quantity) == pytest.approx(10)


def test_prepared_portions_are_separate_by_equivalence_and_reverse_correctly(rdb):
    menu.replace_recipe(
        "chapati",
        RecipeReplace(
            lines=[
                RecipeLineIn(
                    product_id="flour",
                    quantity=0.2,
                    batch_quantity=2,
                    batch_yield=10,
                    serving_unit="plates",
                ),
                RecipeLineIn(
                    product_id="flour",
                    quantity=0.25,
                    batch_quantity=1,
                    batch_yield=4,
                    serving_unit="sticks",
                ),
            ],
            serving_unit="plates",
        ),
        request=None,
        db=rdb,
        session={},
    )
    dish = rdb.get(InventoryItem, "inv-chapati")
    prepare_recipe_batch(rdb, ACCOUNT, dish.id, serving_unit="plates")
    prepare_recipe_batch(rdb, ACCOUNT, dish.id, serving_unit="sticks")
    rdb.commit()
    rdb.expire_all()

    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["inventory_item_id"] == dish.id)
    equivalences = {row["serving_unit"]: row for row in costing["equivalences"]}
    assert equivalences["plates"]["portions_available"] == 10
    assert equivalences["sticks"]["portions_available"] == 4
    assert float(rdb.get(InventoryItem, dish.id).prepared_quantity) == pytest.approx(10)

    order_out = _order(
        rdb,
        {"inventory_item_id": dish.id, "quantity": 1, "serving_unit": "sticks"},
    )
    rdb.commit()
    rdb.expire_all()
    order = rdb.get(Order, order_out.id)
    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["inventory_item_id"] == dish.id)
    equivalences = {row["serving_unit"]: row for row in costing["equivalences"]}
    assert equivalences["plates"]["portions_available"] == 10
    assert equivalences["sticks"]["portions_available"] == 3

    release_order_holds(rdb, order)
    rdb.commit()
    rdb.expire_all()
    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["inventory_item_id"] == dish.id)
    equivalences = {row["serving_unit"]: row for row in costing["equivalences"]}
    assert equivalences["plates"]["portions_available"] == 10
    assert equivalences["sticks"]["portions_available"] == 4

    wasted_order_out = _order(
        rdb,
        {"inventory_item_id": dish.id, "quantity": 1, "serving_unit": "sticks"},
    )
    rdb.commit()
    wasted_order = rdb.get(Order, wasted_order_out.id)
    release_order_holds(rdb, wasted_order, wastage=True)
    rdb.commit()
    rdb.expire_all()
    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["inventory_item_id"] == dish.id)
    equivalences = {row["serving_unit"]: row for row in costing["equivalences"]}
    assert equivalences["plates"]["portions_available"] == 10
    assert equivalences["sticks"]["portions_available"] == 3
    wastage = rdb.query(StockMovement).filter(StockMovement.reason == "wastage").one()
    assert wastage.serving_unit == "sticks"


def test_sale_deducts_selected_menu_recipe_portion_per_sold_serving(rdb):
    menu.replace_recipe(
        "chapati",
        RecipeReplace(
            lines=[
                RecipeLineIn(product_id="flour", quantity=10 / 8),
                RecipeLineIn(product_id="oil", quantity=0.8 / 8),
            ],
            serving_unit="plates",
        ),
        request=None,
        db=rdb,
        session={},
    )

    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 2})

    assert _stock(rdb, "inv-flour") == pytest.approx(7.5)
    assert _stock(rdb, "inv-oil") == pytest.approx(4.8)
    sale_quantities = {
        movement.inventory_item_id: float(movement.quantity)
        for movement in rdb.query(StockMovement).filter(StockMovement.reason == "sale").all()
    }
    assert sale_quantities["inv-flour"] == pytest.approx(2.5)
    assert sale_quantities["inv-oil"] == pytest.approx(0.2)


def test_direct_item_shortage_blocks_but_recipe_may_go_negative(rdb):
    with pytest.raises(HTTPException) as exc:
        _order(rdb, {"inventory_item_id": "inv-soda", "quantity": 25})
    assert exc.value.status_code == 422

    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 120})
    assert _stock(rdb, "inv-flour") == pytest.approx(-2.0)


def test_block_on_low_ingredients_setting(rdb):
    rdb.get(Account, ACCOUNT).block_sale_on_low_ingredients = True
    rdb.commit()
    with pytest.raises(HTTPException) as exc:
        _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 120})
    assert "Flour" in str(exc.value.detail)
    assert _stock(rdb, "inv-flour") == pytest.approx(10.0)


def _cancel(db, order_id: str, *, waste: bool):
    return orders.transition_order(
        order_id,
        OrderTransition(to_status="cancelled", note="Customer left", waste_stock=waste),
        request=None,
        db=db,
        session={},
    )


def test_cancel_returns_stock_through_ledger(rdb):
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    _cancel(rdb, out.id, waste=False)
    assert _stock(rdb, "inv-flour") == pytest.approx(10.0)
    reversals = rdb.query(StockMovement).filter(StockMovement.reason == "sale_reversal").all()
    assert len(reversals) == 2 and all(m.order_id == out.id for m in reversals)


def test_cancel_as_wastage_keeps_stock_out_and_records_it(rdb):
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    _cancel(rdb, out.id, waste=True)
    assert _stock(rdb, "inv-flour") == pytest.approx(9.0)
    wasted = rdb.query(StockMovement).filter(StockMovement.reason == "wastage").all()
    assert {m.inventory_item_id for m in wasted} == {"inv-flour", "inv-oil"}


def test_retail_sale_is_unchanged(retail_db):
    out = _order(retail_db, {"inventory_item_id": "inv-chapati", "quantity": 10},
                 {"inventory_item_id": "inv-soda", "quantity": 2})
    assert _stock(retail_db, "inv-flour") == pytest.approx(9.0)
    assert _stock(retail_db, "inv-soda") == 22
    assert retail_db.query(StockMovement).count() == 0
    assert all(line.cost_total is None for line in retail_db.query(OrderItem).all())

    _cancel(retail_db, out.id, waste=True)
    assert _stock(retail_db, "inv-flour") == pytest.approx(10.0)
    assert retail_db.query(StockMovement).count() == 0


def test_retail_is_refused_restaurant_features(retail_db, rdb):
    with pytest.raises(HTTPException) as exc:
        require_restaurant_account(retail_db, ACCOUNT)
    assert exc.value.status_code == 403
    assert require_restaurant_account(rdb, ACCOUNT).store_type == "restaurant"


# --- Purchase orders -------------------------------------------------------------


def _set_bag_unit(db):
    item = db.get(InventoryItem, "inv-flour")
    item.attributes = {"buy_units": [{"name": "50kg bag", "factor": 50}, {"name": "500g pack", "factor": 0.5}]}
    db.commit()


def test_buy_units_include_fractional_packs_and_sell_packs(rdb):
    _set_bag_unit(rdb)
    soda = rdb.get(InventoryItem, "inv-soda")
    soda.attributes = {"sell_units": [{"name": "Crate", "factor": 24}]}
    rdb.commit()
    assert [(u["name"], u["factor"]) for u in buy_units_for_item(rdb.get(InventoryItem, "inv-flour"))] == [
        ("kg", 1), ("50kg bag", 50.0), ("500g pack", 0.5),
    ]
    assert ("Crate", 24) in [(u["name"], u["factor"]) for u in buy_units_for_item(soda)]


def test_weighted_average_cost():
    assert weighted_average_cost(Decimal("10"), 100, Decimal("50"), Decimal("88")) == Decimal("90.00")
    assert weighted_average_cost(Decimal("-2"), 100, Decimal("5"), Decimal("80")) == Decimal("80.00")
    assert weighted_average_cost(Decimal("0"), None, Decimal("5"), Decimal("80")) == Decimal("80.00")


def test_purchase_order_partial_receive_cost_and_payment(rdb):
    _set_bag_unit(rdb)
    service = PurchaseOrderService(rdb)
    po = service.create(
        ACCOUNT,
        user_id="u1",
        supplier_id="sup-1",
        status="ordered",
        lines=[
            LineInput("inv-flour", Decimal("2"), Decimal("4400"), "50kg bag"),
            LineInput("inv-soda", Decimal("24"), Decimal("45")),
        ],
    )
    rdb.commit()
    assert po.reference == "PO-00001"
    assert float(po.total) == 2 * 4400 + 24 * 45

    flour_line = next(line for line in po.lines if line.inventory_item_id == "inv-flour")
    soda_line = next(line for line in po.lines if line.inventory_item_id == "inv-soda")
    po, movements = service.receive(
        ACCOUNT, po.id, [ReceiveInput(flour_line.id, Decimal("1"))], user_id="u1",
    )
    rdb.commit()
    assert po.status == "partially_received"
    assert _stock(rdb, "inv-flour") == pytest.approx(60.0)
    # (10kg @100 + 50kg @88) / 60kg
    assert float(rdb.get(InventoryItem, "inv-flour").buying_price) == pytest.approx(90.0)
    receipt = movements[0]
    assert receipt.supplier_id == "sup-1" and receipt.purchase_order_id == po.id
    assert rdb.get(InventoryItem, "inv-flour").preferred_supplier_id == "sup-1"

    service.receive(
        ACCOUNT, po.id,
        [ReceiveInput(flour_line.id, Decimal("1")), ReceiveInput(soda_line.id, Decimal("24"))],
    )
    rdb.commit()
    assert rdb.get(PurchaseOrder, po.id).status == "received"
    assert _stock(rdb, "inv-soda") == 48

    service.record_payment(ACCOUNT, po.id, Decimal("5000"))
    assert rdb.get(PurchaseOrder, po.id).payment_status == "partial"
    with pytest.raises(PurchaseOrderError):
        service.record_payment(ACCOUNT, po.id, Decimal("999999"))
    summary = service.supplier_summary(ACCOUNT, "sup-1")
    assert summary["purchase_orders"] == 1 and summary["unpaid"] == pytest.approx(8800 + 1080 - 5000)


def test_void_receipt_reopens_line(rdb):
    service = PurchaseOrderService(rdb)
    po = service.create(
        ACCOUNT, user_id="u1", supplier_id="sup-1", status="ordered",
        lines=[LineInput("inv-oil", Decimal("5"), Decimal("280"))],
    )
    _, movements = service.receive(ACCOUNT, po.id, [ReceiveInput(po.lines[0].id, Decimal("5"))])
    rdb.commit()
    assert _stock(rdb, "inv-oil") == pytest.approx(10.0)

    po = service.void_receipt(ACCOUNT, movements[0].id, reason="Wrong brand")
    rdb.commit()
    assert _stock(rdb, "inv-oil") == pytest.approx(5.0)
    assert po.status == "ordered"
    assert float(po.lines[0].quantity_received) == 0


def test_purchase_orders_reject_menu_items(rdb):
    service = PurchaseOrderService(rdb)
    with pytest.raises(PurchaseOrderError):
        service.create(ACCOUNT, user_id=None, supplier_id=None,
                       lines=[LineInput("inv-chapati", Decimal("1"), Decimal("10"))])
    names = {item.product.name for item in service.supply_items(ACCOUNT)}
    assert names == {"Soda", "Flour", "Cooking oil", "Eggs"}


def test_supply_stock_list_can_exclude_inactive_inventory(rdb):
    rdb.add(Catalogue(
        id="archived-supply",
        name="Archived supply",
        slug="archived-supply",
        product_type="retail",
        unit="kg",
    ))
    rdb.add(InventoryItem(
        id="inv-archived-supply",
        account_id=ACCOUNT,
        product_id="archived-supply",
        stock_quantity=5,
        is_active=False,
    ))
    rdb.commit()

    all_supply_names = {item.product.name for item in PurchaseOrderService(rdb).supply_items(ACCOUNT)}
    active_supply_names = {
        item.product.name
        for item in PurchaseOrderService(rdb).supply_items(ACCOUNT, active_only=True)
    }
    assert "Archived supply" in all_supply_names
    assert "Archived supply" not in active_supply_names
    assert active_supply_names == {"Soda", "Flour", "Cooking oil", "Eggs"}


def test_cancel_needs_nothing_received(rdb):
    service = PurchaseOrderService(rdb)
    po = service.create(ACCOUNT, user_id=None, supplier_id=None, status="ordered",
                        lines=[LineInput("inv-eggs", Decimal("30"), Decimal("14"))])
    service.receive(ACCOUNT, po.id, [ReceiveInput(po.lines[0].id, Decimal("10"))])
    with pytest.raises(PurchaseOrderError):
        service.cancel(ACCOUNT, po.id, "changed mind")


# --- Stock take, costing and reports ----------------------------------------------


def test_stock_take_writes_count_variance(rdb):
    take = create_stock_take(rdb, ACCOUNT, user_id="u1")
    by_item = {line.inventory_item_id: line for line in take.lines}
    save_counts(rdb, ACCOUNT, take.id, {by_item["inv-flour"].id: Decimal("8.5")})
    take = complete_stock_take(rdb, ACCOUNT, take.id, user_id="u1")
    rdb.commit()
    assert take.status == "completed"
    assert _stock(rdb, "inv-flour") == pytest.approx(8.5)
    variance = rdb.query(StockMovement).filter(StockMovement.reason == "count_variance").one()
    assert variance.direction == "out" and float(variance.quantity) == pytest.approx(1.5)
    assert variance.stock_take_id == take.id


def test_menu_costing(rdb):
    rows = {row["name"]: row for row in menu_costing(rdb, ACCOUNT)}
    chapati = rows["Chapati"]
    assert chapati["has_recipe"] is True
    assert chapati["cost_per_portion"] == pytest.approx(13.0)
    assert chapati["food_cost_percent"] == pytest.approx(43.3)
    assert chapati["portions_available"] == 100
    assert chapati["limiting_ingredient"] == "Flour"


def test_food_category_retail_item_supports_recipe_and_menu_yield(rdb):
    rdb.add(
        Catalogue(
            id="tea",
            name="Masala tea",
            slug="masala-tea",
            product_type="retail",
            category="Food & Beverage",
            created_by_account_id=ACCOUNT,
        )
    )
    rdb.add(
        InventoryItem(
            id="inv-tea",
            account_id=ACCOUNT,
            product_id="tea",
            selling_price=50,
            stock_quantity=0,
            inventory_role="for_sale",
            is_active=True,
        )
    )
    rdb.commit()

    menu.replace_recipe(
        "tea",
        RecipeReplace(
            lines=[RecipeLineIn(product_id="flour", quantity=0.1)],
            serving_unit="cups",
        ),
        request=None,
        db=rdb,
        session={},
    )
    rdb.commit()

    costing = next(row for row in menu_costing(rdb, ACCOUNT) if row["product_id"] == "tea")
    assert costing["has_recipe"] is True
    assert costing["serving_unit"] == "cups"
    assert costing["portions_available"] == 100

    rdb.expire_all()
    product = _inventory_product_out(rdb.get(Catalogue, "tea"), ACCOUNT)
    assert product is not None
    assert product.recipe_serving_unit == "cups"
    assert len(product.recipe or []) == 1


def test_usage_report_balances(rdb):
    start = datetime.utcnow() - timedelta(minutes=1)
    service = PurchaseOrderService(rdb)
    po = service.create(ACCOUNT, user_id=None, supplier_id="sup-1", status="ordered",
                        lines=[LineInput("inv-flour", Decimal("5"), Decimal("100"))])
    service.receive(ACCOUNT, po.id, [ReceiveInput(po.lines[0].id, Decimal("5"))])
    rdb.commit()
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 20})
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    _cancel(rdb, out.id, waste=True)
    take = create_stock_take(rdb, ACCOUNT, user_id=None, inventory_item_ids=["inv-flour"])
    save_counts(rdb, ACCOUNT, take.id, {take.lines[0].id: Decimal("11")})
    complete_stock_take(rdb, ACCOUNT, take.id, user_id=None)
    rdb.commit()

    report = usage_report(rdb, ACCOUNT, start, datetime.utcnow() + timedelta(minutes=1))
    flour = next(row for row in report["items"] if row["name"] == "Flour")
    assert flour["opening"] == pytest.approx(10)
    assert flour["purchased"] == pytest.approx(5)
    assert flour["used_in_sales"] == pytest.approx(1.0)  # 3.0 sold, 2.0 reversed
    assert flour["wasted"] == pytest.approx(2.0)
    assert flour["count_variance"] == pytest.approx(-1.0)
    assert flour["closing"] == pytest.approx(11)
    assert flour["opening"] + flour["purchased"] - flour["used_in_sales"] - flour["wasted"] \
        + flour["adjusted"] + flour["count_variance"] == pytest.approx(flour["closing"])

    profit = profit_report(rdb, ACCOUNT, start, datetime.utcnow() + timedelta(minutes=1))
    assert profit["totals"]["revenue"] == pytest.approx(300.0)
    assert profit["totals"]["cost"] == pytest.approx(130.0)


def test_profit_report_days_are_local_calendar_days(rdb):
    out = _order(rdb, {"inventory_item_id": "inv-soda", "quantity": 1})
    order = rdb.get(Order, out.id)
    order.created_at = datetime(2026, 10, 15, 22, 30)  # 01:30 on the 16th in Nairobi
    rdb.commit()
    profit = profit_report(rdb, ACCOUNT, datetime(2026, 10, 15, 21), datetime(2026, 10, 16, 21), 180)
    assert [day["date"] for day in profit["days"]] == ["2026-10-16"]


# --- Cost precision ---------------------------------------------------------------


def test_cheap_pack_split_into_many_units_keeps_its_cost(rdb):
    eggs = rdb.get(InventoryItem, "inv-eggs")
    eggs.stock_quantity = 0
    eggs.attributes = {"buy_units": [{"name": "Box of 200", "factor": 200}]}
    rdb.commit()
    service = PurchaseOrderService(rdb)
    po = service.create(ACCOUNT, user_id=None, supplier_id=None, status="ordered",
                        lines=[LineInput("inv-eggs", Decimal("1"), Decimal("1"), "Box of 200")])
    _, movements = service.receive(ACCOUNT, po.id, [ReceiveInput(po.lines[0].id, Decimal("1"))])
    rdb.commit()
    rdb.expire_all()
    assert Decimal(str(rdb.get(StockMovement, movements[0].id).unit_cost)) == Decimal("0.005")
    assert Decimal(str(rdb.get(InventoryItem, "inv-eggs").buying_price)) == Decimal("0.005")


def test_purchase_order_reference_skips_past_a_taken_one(rdb):
    service = PurchaseOrderService(rdb)
    assert service._next_reference(ACCOUNT) == "PO-00001"
    assert service._next_reference(ACCOUNT, after="PO-00007") == "PO-00008"


# --- Credit sales ---------------------------------------------------------------------


@pytest.fixture()
def no_receipts(monkeypatch):
    monkeypatch.setattr(OrderNotificationService, "notify_customer_receipt_whatsapp", lambda *_a, **_k: None)


def _credit_order(db, **extra):
    payload = OrderCreate(
        source="walkin",
        fulfillment_type="dine_in",
        payment_method="credit",
        customer_name="Amina",
        customer_phone="0712345678",
        items=[{"inventory_item_id": "inv-chapati", "quantity": 10}],
        **extra,
    )
    return orders.create_order(payload, request=None, db=db, session={})["data"]


def _owed(db) -> Decimal:
    db.expire_all()
    return Decimal(str(db.query(ShopCustomer).one().outstanding_balance))


@pytest.mark.usefixtures("no_receipts")
def test_credit_sale_saves_date_to_pay(rdb):
    _credit_order(rdb, date_to_pay="2026-11-01")
    customer = rdb.query(ShopCustomer).one()
    assert customer.date_to_pay == date(2026, 11, 1)
    assert Decimal(str(customer.outstanding_balance)) == Decimal("300.00")

    with pytest.raises(HTTPException) as exc:
        _credit_order(rdb, date_to_pay="next week")
    assert exc.value.status_code == 422


@pytest.mark.usefixtures("no_receipts")
def test_editing_a_credit_order_moves_the_customer_balance(rdb):
    out = _credit_order(rdb)
    assert _owed(rdb) == Decimal("300.00")

    def edit(**fields):
        orders.update_order(out.id, OrderUpdate(**fields), request=None, db=rdb, session={})

    edit(discount=50)
    assert _owed(rdb) == Decimal("250.00")
    edit(delivery_fee=100)
    assert _owed(rdb) == Decimal("350.00")
    edit(payment_method="cash")
    assert _owed(rdb) == Decimal("0.00")
    edit(payment_method="credit")
    assert _owed(rdb) == Decimal("350.00")


@pytest.mark.usefixtures("no_receipts")
def test_releasing_a_cancelled_credit_order_returns_stock_and_credit(rdb):
    out = _credit_order(rdb)
    assert _stock(rdb, "inv-flour") == pytest.approx(9.0)
    order = rdb.get(Order, out.id)
    release_order_holds(rdb, order)
    rdb.commit()
    assert _stock(rdb, "inv-flour") == pytest.approx(10.0)
    assert _owed(rdb) == Decimal("0.00")
    assert rdb.get(Order, out.id).stock_deducted is False


def test_cancel_after_a_partial_line_reduction_returns_the_rest(rdb):
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    order = rdb.get(Order, out.id)
    adjust_line_quantity(rdb, order, order.items[0], -4)
    rdb.commit()
    assert _stock(rdb, "inv-flour") == pytest.approx(9.4)
    _cancel(rdb, out.id, waste=False)
    assert _stock(rdb, "inv-flour") == pytest.approx(10.0)
    assert _stock(rdb, "inv-oil") == pytest.approx(5.0)


def test_external_catalogue_line_never_keeps_another_shops_item(rdb):
    rdb.add(Account(id="acct-other", business_name="Other", business_location="Nairobi",
                    business_category="restaurant", store_type="restaurant"))
    rdb.add(InventoryItem(id="inv-foreign", account_id="acct-other", product_id="soda", stock_quantity=5))
    rdb.commit()
    foreign = CatalogItem(ref="external:sku-1", source="external", name="Soda", price=Decimal("80"),
                          platform_inventory_item_id="inv-foreign")
    order = build_catalog_order(rdb, account_id=ACCOUNT, conversation_id=None, line_items=[(foreign, 1)],
                                phone=None, note=None, enforce_store_open=False)
    rdb.commit()
    assert [line.inventory_item_id for line in order.items] == [None]
    assert _stock(rdb, "inv-foreign") == 5
