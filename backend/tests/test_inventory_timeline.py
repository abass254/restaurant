"""Unit and integration tests for inventory item timeline activities (bought, sold, adjustments)."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.core.session import require_user
from app.dependencies import get_request_session
from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    Order,
    OrderItem,
    PurchaseOrder,
    ShopSupplier,
    StockMovement,
    User,
    UserMembership,
)


def test_inventory_timeline_bought_and_sold_activities():
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    db = TestingSessionLocal()

    # 1. Setup account and user
    account = Account(
        id="acc_shop_1",
        business_name="Mama Mboga Shop",
        business_location="Nairobi",
        business_category="groceries",
        store_type="retail",
    )
    db.add(account)

    user = User(
        id="user_owner_1",
        account_id="acc_shop_1",
        name="Jane Merchant",
        email="jane@example.com",
        user_role="merchant_owner",
        is_activated=True,
    )
    user.memberships.append(
        UserMembership(
            id="mem_1",
            user_id="user_owner_1",
            account_id="acc_shop_1",
            role="system_admin",
            is_active=True,
        )
    )
    db.add(user)

    # 2. Setup product & inventory item
    product = Catalogue(
        id="prod_rice_1",
        name="Basmati Rice 1kg",
        slug="basmati-rice-1kg",
        product_type="retail",
        unit="kg",
    )
    db.add(product)

    inv_item = InventoryItem(
        id="item_rice_1",
        account_id="acc_shop_1",
        product_id="prod_rice_1",
        stock_quantity=Decimal("15"),
        buying_price=Decimal("180.00"),
        selling_price=Decimal("250.00"),
    )
    db.add(inv_item)

    # 3. Setup supplier and purchase order
    supplier = ShopSupplier(
        id="supp_1",
        account_id="acc_shop_1",
        name="Nairobi Grain Mills",
    )
    db.add(supplier)

    po = PurchaseOrder(
        id="po_1",
        account_id="acc_shop_1",
        supplier_id="supp_1",
        reference="PO-2026-001",
        status="received",
    )
    db.add(po)

    # Movement 1: Bought (stock in)
    mov_receive = StockMovement(
        id="mov_rec_1",
        account_id="acc_shop_1",
        inventory_item_id="item_rice_1",
        direction="in",
        quantity=Decimal("30"),
        quantity_before=Decimal("0"),
        quantity_after=Decimal("30"),
        reason="receive",
        unit_cost=Decimal("180.00"),
        total_cost=Decimal("5400.00"),
        supplier_id="supp_1",
        purchase_order_id="po_1",
        created_by="user_owner_1",
        note="Fresh stock delivery",
        created_at=datetime(2026, 10, 10, 10, 0, 0),
    )
    db.add(mov_receive)

    # Movement 2: Adjustment (damage)
    mov_damage = StockMovement(
        id="mov_dam_1",
        account_id="acc_shop_1",
        inventory_item_id="item_rice_1",
        direction="out",
        quantity=Decimal("2"),
        quantity_before=Decimal("30"),
        quantity_after=Decimal("28"),
        reason="damage",
        note="Water spill on bag",
        created_by="user_owner_1",
        created_at=datetime(2026, 10, 12, 14, 0, 0),
    )
    db.add(mov_damage)

    # 4. Setup order & order item (sold)
    order = Order(
        id="ord_1",
        account_id="acc_shop_1",
        order_number="1001",
        source="pos",
        fulfillment_type="takeaway",
        customer_name="Alice Mwangi",
        status="completed",
        created_at=datetime(2026, 10, 15, 11, 30, 0),
    )
    db.add(order)

    order_item = OrderItem(
        id="oi_1",
        order_id="ord_1",
        inventory_item_id="item_rice_1",
        product_name="Basmati Rice 1kg",
        quantity=13,
        unit_price=Decimal("250.00"),
        line_total=Decimal("3250.00"),
        created_at=datetime(2026, 10, 15, 11, 30, 0),
    )
    db.add(order_item)

    db.commit()

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_request_session] = lambda: {"user_id": "user_owner_1", "active_account_id": "acc_shop_1"}
    app.dependency_overrides[require_user] = lambda: user

    try:
        client = TestClient(app)

        # GET /api/v1/inventory/item_rice_1/timeline
        resp = client.get("/api/v1/inventory/item_rice_1/timeline")
        assert resp.status_code == 200, resp.text
        data = resp.json()

        # Check summary
        summary = data["summary"]
        assert summary["total_bought"] == 30.0
        assert summary["total_bought_cost"] == 5400.0
        assert summary["total_sold"] == 13.0
        assert summary["total_sold_revenue"] == 3250.0
        assert summary["total_adjusted"] == -2.0
        assert summary["current_stock"] == 15.0
        assert summary["unit"] == "kg"

        # Check activities
        activities = data["activities"]
        assert len(activities) == 3

        # Most recent first:
        # 1. Order sale (2026-10-15)
        act_sold = activities[0]
        assert act_sold["activity_type"] == "sold"
        assert act_sold["direction"] == "out"
        assert act_sold["quantity"] == 13.0
        assert act_sold["party_name"] == "Alice Mwangi"
        assert act_sold["reference_code"] == "#1001"

        # 2. Damage adjustment (2026-10-12)
        act_dam = activities[1]
        assert act_dam["activity_type"] == "damage"
        assert act_dam["direction"] == "out"
        assert act_dam["quantity"] == 2.0
        assert act_dam["note"] == "Water spill on bag"

        # 3. Stock received (2026-10-10)
        act_bought = activities[2]
        assert act_bought["activity_type"] == "bought"
        assert act_bought["direction"] == "in"
        assert act_bought["quantity"] == 30.0
        assert act_bought["unit_cost"] == 180.0
        assert act_bought["total_amount"] == 5400.0
        assert act_bought["party_name"] == "Nairobi Grain Mills"
        assert act_bought["reference_code"] == "PO-2026-001"

        # Test filtering by activity_type=bought
        resp_bought = client.get("/api/v1/inventory/item_rice_1/timeline?activity_type=bought")
        assert resp_bought.status_code == 200
        bought_acts = resp_bought.json()["activities"]
        assert len(bought_acts) == 1
        assert bought_acts[0]["activity_type"] == "bought"

        # Test filtering by activity_type=sold
        resp_sold = client.get("/api/v1/inventory/item_rice_1/timeline?activity_type=sold")
        assert resp_sold.status_code == 200
        sold_acts = resp_sold.json()["activities"]
        assert len(sold_acts) == 1
        assert sold_acts[0]["activity_type"] == "sold"

    finally:
        app.dependency_overrides.clear()
        db.close()
