"""Restaurant supplies → menu → POS: ledger, purchase orders, stock takes, reports.

Retail shops must keep their original behaviour (no ledger rows on sales).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import menu, orders
from app.api.v1.menu import RecipeLineIn, RecipeReplace
from app.api.v1.orders import OrderCreate, OrderTransition
from app.database import Base
from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    Order,
    OrderItem,
    PurchaseOrder,
    ShopSupplier,
    StockMovement,
)
from app.services.inventory_stock_service import weighted_average_cost
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
