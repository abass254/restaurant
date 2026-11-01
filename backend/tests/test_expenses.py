from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Order, OrderItem, Product, ShopExpense
from app.schemas import ExpenseCreate
from app.services.expense_service import create_expense, delete_expense, list_expenses
from app.services.reports_service import reports_summary

ACCOUNT_ID = "test-acct-exp"


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
        business_name="Expenses TransChap",
        business_location="Nairobi",
        business_category="retail",
    )
    session.add(account)

    prod = Product(id="prod-1", name="Shirt", slug="shirt")
    session.add(prod)

    order = Order(
        id="ord-1",
        order_number="ORD-100",
        account_id=ACCOUNT_ID,
        source="walkin",
        status="delivered",
        fulfillment_type="pickup",
        total=1500.0,
        payment_method="cash",
        created_at=datetime(2026, 10, 21, 10, 0, 0),
        paid_at=datetime(2026, 10, 21, 10, 0, 0),
    )
    item = OrderItem(
        id="item-1",
        order_id="ord-1",
        product_name="Shirt",
        product_id="prod-1",
        quantity=1,
        unit_price=1500.0,
        line_total=1500.0,
    )
    session.add_all([order, item])
    session.commit()

    yield session
    session.close()


def test_create_and_list_expenses(db):
    exp = create_expense(
        db=db,
        account_id=ACCOUNT_ID,
        user_id=None,
        data=ExpenseCreate(
            title="Boda boda errand to market",
            amount=250.0,
            category="errand",
            payment_method="cash",
            spent_at=datetime(2026, 10, 21, 11, 0, 0),
        ),
    )
    assert exp.id is not None
    assert exp.title == "Boda boda errand to market"
    assert float(exp.amount) == 250.0

    items = list_expenses(db, ACCOUNT_ID)
    assert len(items) == 1
    assert items[0].title == "Boda boda errand to market"


def test_reports_summary_with_expenses(db):
    create_expense(
        db=db,
        account_id=ACCOUNT_ID,
        user_id=None,
        data=ExpenseCreate(
            title="Shop lunch & tea",
            amount=300.0,
            category="errand",
            payment_method="mpesa",
            spent_at=datetime(2026, 10, 21, 12, 0, 0),
        ),
    )
    create_expense(
        db=db,
        account_id=ACCOUNT_ID,
        user_id=None,
        data=ExpenseCreate(
            title="Packaging polythene bags",
            amount=200.0,
            category="errand",
            payment_method="cash",
            spent_at=datetime(2026, 10, 21, 13, 0, 0),
        ),
    )

    summary = reports_summary(
        db=db,
        account_id=ACCOUNT_ID,
        start=date(2026, 10, 21),
        end=date(2026, 10, 21),
        tz_offset_minutes=180,
    )

    assert summary["sales_total"] == 1500.0
    assert summary["expense_total"] == 500.0
    assert summary["expense_count"] == 2
    assert summary["net_profit_after_expenses"] == 1000.0

    # Buckets contain expenses
    bucket_expenses = sum(b.get("expenses", 0) for b in summary["buckets"])
    assert bucket_expenses == 500.0


def test_delete_expense(db):
    exp = create_expense(
        db=db,
        account_id=ACCOUNT_ID,
        user_id=None,
        data=ExpenseCreate(
            title="Cancelled errand",
            amount=100.0,
            category="errand",
            payment_method="cash",
        ),
    )
    assert delete_expense(db, ACCOUNT_ID, exp.id) is True
    assert len(list_expenses(db, ACCOUNT_ID)) == 0
