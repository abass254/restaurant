from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    MpesaTransaction,
    Order,
    OrderItem,
    OrderReturn,
    OrderReturnItem,
    PurchaseOrder,
    PurchaseOrderLine,
    ShopCustomer,
    ShopSupplier,
    ShopSupplierPayment,
    StockMovement,
    User,
)
from app.services.statement_service import (
    build_customer_statement,
    build_supplier_statement,
    build_statements_overview,
    export_statement_csv,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_customer_statement_flow(db):
    account = Account(
        id="acc-cstmt-1",
        business_name="Customer Stmt Shop",
        business_location="Nairobi",
        business_category="retail",
        store_type="retail",
    )
    customer = ShopCustomer(
        id="cust-1",
        account_id=account.id,
        name="Jane Wanjiku",
        phone="+254712345678",
        outstanding_balance=Decimal("1500.00"),
        credit_limit=Decimal("5000.00"),
    )
    db.add_all([account, customer])
    db.flush()

    # 1. Order 1 - Credit sale for 2,000 KES
    now = datetime(2026, 10, 15, 10, 0, 0)
    order1 = Order(
        id="ord-c1",
        account_id=account.id,
        order_number="ORD-001",
        source="pos",
        fulfillment_type="walkin",
        status="completed",
        customer_name=customer.name,
        customer_phone=customer.phone,
        total=Decimal("2000.00"),
        subtotal=Decimal("2000.00"),
        payment_method="credit",
        placed_at=now,
        created_at=now,
    )
    db.add(order1)
    db.flush()

    # 2. Payment of 1,000 KES via M-PESA
    pay_time = datetime(2026, 10, 16, 14, 0, 0)
    txn = MpesaTransaction(
        id="txn-c1",
        account_id=account.id,
        shop_customer_id=customer.id,
        phone_number=customer.phone,
        account_reference="TAB001",
        transaction_desc="Tab payment",
        amount=1000,
        credit_collect_amount=1000,
        status="success",
        mpesa_receipt_number="QGH123ABC",
        credit_collected_at=pay_time,
        created_at=pay_time,
    )
    db.add(txn)

    # 3. Order 2 - Cash sale for 500 KES
    cash_time = datetime(2026, 10, 17, 11, 0, 0)
    order2 = Order(
        id="ord-c2",
        account_id=account.id,
        order_number="ORD-002",
        source="pos",
        fulfillment_type="walkin",
        status="completed",
        customer_name=customer.name,
        customer_phone=customer.phone,
        total=Decimal("500.00"),
        subtotal=Decimal("500.00"),
        payment_method="cash",
        placed_at=cash_time,
        created_at=cash_time,
    )
    db.add(order2)
    db.commit()

    stmt = build_customer_statement(db, account.id, customer.id)
    assert stmt["party"]["name"] == "Jane Wanjiku"
    assert stmt["party"]["phone"] == "+254712345678"
    assert stmt["summary"]["total_billed"] == 2500.0
    assert stmt["summary"]["total_paid"] == 1500.0  # 1000 tab pay + 500 cash paid immediately
    assert stmt["summary"]["cash_inflow"] == 1500.0
    assert stmt["summary"]["paid_cash"] == 500.0
    assert stmt["summary"]["paid_mpesa"] == 1000.0
    assert stmt["summary"]["current_balance"] == 1500.0

    csv_bytes, filename = export_statement_csv(stmt)
    assert "jane_wanjiku" in filename
    csv_text = csv_bytes.decode("utf-8-sig")
    assert "CUSTOMER STATEMENT OF ACCOUNT & CASH FLOW" in csv_text
    assert "ORD-001" in csv_text
    assert "ORD-002" in csv_text
    assert "QGH123ABC" in csv_text


def test_supplier_statement_flow(db):
    account = Account(
        id="acc-sstmt-1",
        business_name="Supplier Stmt Shop",
        business_location="Nairobi",
        business_category="retail",
        store_type="retail",
    )
    supplier = ShopSupplier(
        id="sup-1",
        account_id=account.id,
        name="Pembe Flour Mills",
        phone="+254700112233",
        pin_number="P051234567Z",
        balance=Decimal("8000.00"),
        credit_limit=Decimal("20000.00"),
    )
    db.add_all([account, supplier])
    db.flush()

    # 1. Direct stock purchase via StockMovement with supplier note for 10,000 KES
    now = datetime(2026, 10, 10, 9, 30, 0)
    cat = Catalogue(id="cat-p1", name="Pembe Maize Flour 2kg", slug="pembe-maize-flour-2kg", unit="Bale")
    db.add(cat)
    db.flush()
    item = InventoryItem(id="inv-p1", account_id=account.id, product_id=cat.id, buying_price=1000.0, stock_quantity=10)
    db.add(item)
    db.flush()

    mv = StockMovement(
        id="mv-1",
        account_id=account.id,
        inventory_item_id=item.id,
        supplier_id=supplier.id,
        direction="in",
        reason="receive",
        quantity=Decimal("10"),
        unit_cost=Decimal("1000.00"),
        total_cost=Decimal("10000.00"),
        note="Pembe Flour Mills · Ref INV-882 · Pay 30 days",
        created_at=now,
    )
    db.add(mv)
    db.flush()

    # 2. Recorded Payment of 2,000 KES via M-PESA
    pay_time = datetime(2026, 10, 12, 10, 0, 0)
    pay = ShopSupplierPayment(
        id="spay-1",
        account_id=account.id,
        supplier_id=supplier.id,
        amount=Decimal("2000.00"),
        payment_method="mpesa",
        reference="MPESA-REF-1",
        paid_at=pay_time,
        created_at=pay_time,
    )
    db.add(pay)

    # 3. Recorded Payment via post-dated cheque for 3,000 KES
    cheque_pay = ShopSupplierPayment(
        id="spay-2",
        account_id=account.id,
        supplier_id=supplier.id,
        amount=Decimal("3000.00"),
        payment_method="cheque",
        reference="CHQ-9901",
        cheque_maturity_date=date(2026, 11, 20),
        paid_at=pay_time,
        created_at=pay_time,
    )
    db.add(cheque_pay)
    db.commit()

    stmt = build_supplier_statement(db, account.id, supplier.id)
    assert stmt["party"]["name"] == "Pembe Flour Mills"
    assert stmt["party"]["pin_number"] == "P051234567Z"
    assert stmt["summary"]["total_billed"] == 10000.0
    assert stmt["summary"]["paid_mpesa"] == 2000.0
    assert stmt["summary"]["paid_cheque"] == 3000.0
    assert stmt["summary"]["pending_cheques"] == 3000.0
    assert stmt["summary"]["pending_cheques_count"] == 1

    csv_bytes, filename = export_statement_csv(stmt)
    assert "pembe_flour_mills" in filename
    csv_text = csv_bytes.decode("utf-8-sig")
    assert "SUPPLIER STATEMENT OF ACCOUNT & CASH FLOW" in csv_text
    assert "INV-882" in csv_text
    assert "CHQ-9901" in csv_text

    # 4. Account-wide overview
    overview = build_statements_overview(db, account.id)
    assert len(overview["customers"]) == 0
    assert len(overview["suppliers"]) == 1
    assert overview["cash_flow_summary"]["supplier_total_billed"] == 10000.0
    assert overview["cash_flow_summary"]["supplier_total_paid"] == 5000.0
