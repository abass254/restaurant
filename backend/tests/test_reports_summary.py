from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

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
