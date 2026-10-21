from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import reports as reports_api
from app.database import Base
from app.models import (
    Account,
    InventoryItem,
    Order,
    OrderItem,
    Product,
    ShopCustomer,
    StockMovement,
)
from app.services.reports_service import reports_summary

ACCOUNT_ID = "test-acct-rep"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()

    account = Account(
        id=ACCOUNT_ID,
        business_name="Reports Cafe",
        business_location="Nairobi",
        business_category="restaurant",
    )
    session.add(account)

    prod1 = Product(id="prod-1", name="Burger", slug="burger")
    prod2 = Product(id="prod-2", name="Fries", slug="fries")
    session.add_all([prod1, prod2])

    inv1 = InventoryItem(
        id="inv-1",
        account_id=ACCOUNT_ID,
        product_id="prod-1",
        buying_price=300.0,
        selling_price=500.0,
        stock_quantity=20.0,
    )
    inv2 = InventoryItem(
        id="inv-2",
        account_id=ACCOUNT_ID,
        product_id="prod-2",
        buying_price=100.0,
        selling_price=200.0,
        stock_quantity=50.0,
    )
    session.add_all([inv1, inv2])

    order1 = Order(
        id="ord-1",
        order_number="ORD-001",
        account_id=ACCOUNT_ID,
        source="walkin",
        status="delivered",
        fulfillment_type="pickup",
        total=500.0,
        payment_method="cash",
        created_at=datetime(2026, 10, 15, 7, 0, 0),
        paid_at=datetime(2026, 10, 15, 7, 0, 0),
    )
    item1 = OrderItem(
        id="item-1",
        order_id="ord-1",
        product_name="Burger",
        product_id="prod-1",
        inventory_item_id="inv-1",
        quantity=1,
        unit_price=500.0,
        line_total=500.0,
        cost_total=300.0,
    )

    order2 = Order(
        id="ord-2",
        order_number="ORD-002",
        account_id=ACCOUNT_ID,
        source="walkin",
        status="delivered",
        fulfillment_type="pickup",
        total=500.0,
        payment_method="split",
        payment_splits=[
            {"method": "mpesa", "amount": 400.0},
            {"method": "credit", "amount": 100.0},
        ],
        created_at=datetime(2026, 10, 15, 9, 30, 0),
        paid_at=datetime(2026, 10, 15, 9, 30, 0),
    )
    item2a = OrderItem(
        id="item-2a",
        order_id="ord-2",
        product_name="Burger",
        product_id="prod-1",
        inventory_item_id="inv-1",
        quantity=1,
        unit_price=500.0,
        line_total=500.0,
        cost_total=300.0,
    )

    order_cancelled = Order(
        id="ord-canc",
        order_number="ORD-003",
        account_id=ACCOUNT_ID,
        source="walkin",
        status="cancelled",
        fulfillment_type="pickup",
        total=1000.0,
        payment_method="cash",
        created_at=datetime(2026, 10, 15, 8, 0, 0),
    )

    mov1 = StockMovement(
        id="mov-1",
        account_id=ACCOUNT_ID,
        inventory_item_id="inv-2",
        direction="in",
        reason="receive",
        quantity=5.0,
        unit_cost=200.0,
        created_at=datetime(2026, 10, 15, 8, 0, 0),
    )

    cust1 = ShopCustomer(
        id="cust-1",
        account_id=ACCOUNT_ID,
        name="John Doe",
        phone="254712345678",
        outstanding_balance=350.0,
    )

    session.add_all([order1, item1, order2, item2a, order_cancelled, mov1, cust1])
    session.commit()

    yield session
    session.close()


def test_reports_summary_single_day(db):
    target_day = date(2026, 10, 15)
    summary = reports_summary(db, ACCOUNT_ID, target_day, target_day, tz_offset_minutes=180)

    assert summary["sales_total"] == 1000.0  # 500 + 500, cancelled excluded
    assert summary["sales_count"] == 2
    assert summary["units"] == 2
    assert summary["purchase_total"] == 1000.0  # 5 * 200
    assert summary["purchase_count"] == 1
    assert summary["net_profit"] == 0.0  # 1000 - 1000
    assert summary["cogs"] == 600.0  # 300 + 300
    assert summary["gross_profit"] == 400.0  # 1000 - 600

    # Payment methods breakdown
    assert summary["payment_methods"]["cash"] == 500.0
    assert summary["payment_methods"]["mpesa"] == 400.0
    assert summary["payment_methods"]["credit"] == 100.0

    # Owing balance
    assert summary["owing_total"] == 350.0
    assert summary["owing_count"] == 1

    # Hourly buckets
    assert len(summary["buckets"]) > 0
    total_bucket_sales = sum(b["sales"] for b in summary["buckets"])
    total_bucket_purchases = sum(b["purchases"] for b in summary["buckets"])
    assert total_bucket_sales == 1000.0
    assert total_bucket_purchases == 1000.0

    # Products sold with mark up
    assert "products_sold" in summary
    assert len(summary["products_sold"]) == 1
    burger = summary["products_sold"][0]
    assert burger["name"] == "Burger"
    assert burger["qty"] == 2
    assert burger["selling_amount"] == 1000.0
    assert burger["buying_amount"] == 600.0
    assert burger["markup"] == 400.0
    assert burger["selling_price"] == 500.0
    assert burger["buying_price"] == 300.0


def test_daily_buckets_use_creation_time_like_the_range_filter(db):
    order = db.get(Order, "ord-1")
    order.paid_at = datetime(2026, 10, 16, 22, 0, 0)  # paid days later, after midnight EAT
    db.commit()
    summary = reports_summary(db, ACCOUNT_ID, date(2026, 10, 15), date(2026, 10, 16), tz_offset_minutes=180)
    by_day = {b["key"]: b["sales"] for b in summary["buckets"]}
    assert by_day == {"2026-10-15": 1000.0, "2026-10-16": 0.0}


def test_reports_range_is_capped_at_a_year(monkeypatch):
    monkeypatch.setattr(reports_api, "require_user", lambda *_a, **_k: SimpleNamespace(id="u1"))
    monkeypatch.setattr(reports_api, "assert_merchant_section_any_access", lambda *_a, **_k: None)
    monkeypatch.setattr(reports_api, "active_account_id", lambda _u: ACCOUNT_ID)
    with pytest.raises(HTTPException) as exc:
        reports_api.get_reports_summary(
            start=date(2025, 1, 1), end=date(2026, 6, 1), tz_offset_minutes=180, source=None, db=None, session={},
        )
    assert exc.value.status_code == 422


def test_reports_summary_bulk_sale_multiplies_cost_by_bulk_qty(db):
    # inv-2 has buying_price = 100.0 (per piece).
    # Customer buys 2 crates of soda; each crate has unit_factor = 24 pieces.
    # Total pieces = 2 * 24 = 48 pcs.
    # Total buying cost = 48 * 100.0 = 4800.0.
    # Total selling price = 3000.0 per crate = 6000.0.
    # Expected mark up = 6000.0 - 4800.0 = 1200.0.
    bulk_order = Order(
        id="ord-bulk",
        order_number="ORD-BULK",
        account_id=ACCOUNT_ID,
        source="walkin",
        status="completed",
        fulfillment_type="pickup",
        total=6000.0,
        payment_method="cash",
        created_at=datetime(2026, 10, 18, 10, 0, 0),
        paid_at=datetime(2026, 10, 18, 10, 0, 0),
    )
    bulk_item = OrderItem(
        id="item-bulk",
        order_id="ord-bulk",
        product_name="Soda Crate",
        product_id="prod-2",
        inventory_item_id="inv-2",
        quantity=2,
        unit_price=3000.0,
        line_total=6000.0,
        unit_factor=24,
        sell_unit="Crate (24 pcs)",
    )
    db.add_all([bulk_order, bulk_item])
    db.commit()

    summary = reports_summary(db, ACCOUNT_ID, date(2026, 10, 18), date(2026, 10, 18), tz_offset_minutes=180)
    assert summary["sales_total"] == 6000.0
    assert summary["cogs"] == 4800.0  # 100 per pc * 2 crates * 24 pcs/crate
    assert summary["gross_profit"] == 1200.0  # 6000 - 4800

    assert len(summary["products_sold"]) == 1
    p = summary["products_sold"][0]
    assert p["name"] == "Soda Crate"
    assert p["qty"] == 2
    assert p["total_pcs"] == 48.0
    assert p["unit_factor"] == 24.0
    assert p["selling_amount"] == 6000.0
    assert p["buying_amount"] == 4800.0
    assert p["markup"] == 1200.0
    assert p["buying_price"] == 100.0  # cost per piece
    assert p["selling_price"] == 3000.0  # selling price per crate


def test_reports_summary_infers_pack_factor_from_item_attributes(db):
    # inv-rice has buying_price = 120.80 (per kg).
    # Pack: 25KG BAG, factor = 25, buying_price = 3020.0, selling_price = 3600.0.
    # Customer buys 40 bags at 3400.0 with unit_factor=1 (legacy/unselected dropdown).
    # Reports should infer pack factor = 25 and pack cost = 3020.0 per bag.
    prod_rice = Product(id="prod-rice", name="KANGORE BASMATI 25KG", slug="kangore-basmati-25kg", unit="Kg")
    inv_rice = InventoryItem(
        id="inv-rice",
        account_id=ACCOUNT_ID,
        product_id="prod-rice",
        buying_price=120.80,
        selling_price=3600.0,
        attributes={"sell_units": [{"name": "25KG BAG", "factor": 25, "buying_price": 3020.0, "selling_price": 3600.0}]},
        stock_quantity=1000.0,
    )
    order_rice = Order(
        id="ord-rice",
        order_number="ORD-RICE",
        account_id=ACCOUNT_ID,
        source="walkin",
        status="completed",
        fulfillment_type="pickup",
        total=136000.0,
        payment_method="cash",
        created_at=datetime(2026, 10, 19, 10, 0, 0),
        paid_at=datetime(2026, 10, 19, 10, 0, 0),
    )
    item_rice = OrderItem(
        id="item-rice",
        order_id="ord-rice",
        product_name="KANGORE BASMATI 25KG",
        product_id="prod-rice",
        inventory_item_id="inv-rice",
        quantity=40,
        unit_price=3400.0,
        line_total=136000.0,
        unit_factor=1.0,
        sell_unit=None,
    )
    db.add_all([prod_rice, inv_rice, order_rice, item_rice])
    db.commit()

    summary = reports_summary(db, ACCOUNT_ID, date(2026, 10, 19), date(2026, 10, 19), tz_offset_minutes=180)
    assert summary["sales_total"] == 136000.0
    assert summary["cogs"] == 120800.0  # 40 * 3020.0
    assert summary["gross_profit"] == 15200.0  # 136000 - 120800

    p = summary["products_sold"][0]
    assert p["name"] == "KANGORE BASMATI 25KG"
    assert p["qty"] == 40
    assert p["total_pcs"] == 1000.0
    assert p["unit_factor"] == 25.0
    assert p["sell_unit"] == "25KG BAG"
    assert p["selling_amount"] == 136000.0
    assert p["buying_amount"] == 120800.0
    assert p["markup"] == 15200.0
    assert p["buying_price"] == 120.8  # per kg
    assert p["unit_buying_price"] == 3020.0  # per bag
    assert p["selling_price"] == 3400.0  # per bag
    assert p["markup_percent"] == 12.6

