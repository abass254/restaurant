from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api.v1 import settings as settings_api
from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    MerchantOperationsResetArchive,
    ModifierGroup,
    Order,
    OrderItem,
    RecipeLine,
    ShopCustomer,
    ShopExpense,
    ShopSupplier,
)
from app.services.merchant_operations_reset_service import (
    MerchantOperationsResetService,
    _deserialize_model,
    _serialize_model,
)


def test_serialize_and_deserialize_model() -> None:
    order = Order(
        id="order-123",
        account_id="acct-abc",
        order_number="ORD-001",
        source="pos",
        fulfillment_type="takeaway",
        total=Decimal("1500.50"),
        created_at=datetime(2026, 10, 28, 12, 0, 0),
    )
    serialized = _serialize_model(order)
    assert serialized["id"] == "order-123"
    assert serialized["total"] == "1500.50"
    assert serialized["created_at"] == "2026-10-28T12:00:00"

    deserialized = _deserialize_model(Order, serialized)
    assert deserialized.id == "order-123"
    assert deserialized.total == Decimal("1500.50")
    assert deserialized.created_at == datetime(2026, 10, 28, 12, 0, 0)


def test_operations_status_reporting() -> None:
    db = MagicMock()
    # Mocking query scalar for counts
    db.query.return_value.filter.return_value.scalar.return_value = 5
    db.query.return_value.filter.return_value.all.return_value = []
    db.query.return_value.filter.return_value.order_by.return_value.first.return_value = None

    service = MerchantOperationsResetService(db)
    status = service.get_operations_status("acct-1")

    assert status["can_reset"] is True
    assert status["has_active_archive"] is False
    assert status["active_archive"] is None
    assert status["current_counts"]["orders"] == 5


def test_active_archive_days_remaining() -> None:
    db = MagicMock()
    now = datetime.utcnow()
    archive = MerchantOperationsResetArchive(
        id="arch-1",
        account_id="acct-1",
        status="active",
        created_at=now - timedelta(days=2),
        expires_at=now + timedelta(days=28),
        summary_json={"orders": 10},
        snapshot_json={"orders": []},
    )
    db.query.return_value.filter.return_value.all.return_value = []
    db.query.return_value.filter.return_value.order_by.return_value.first.return_value = archive
    db.query.return_value.filter.return_value.scalar.return_value = 0

    service = MerchantOperationsResetService(db)
    status = service.get_operations_status("acct-1")

    assert status["has_active_archive"] is True
    assert status["active_archive"]["id"] == "arch-1"
    assert status["active_archive"]["days_remaining"] == 27 or status["active_archive"]["days_remaining"] == 28
    assert status["active_archive"]["summary"]["orders"] == 10


def test_purge_expired_archives() -> None:
    db = MagicMock()
    now = datetime.utcnow()
    expired_archive = MerchantOperationsResetArchive(
        id="arch-expired",
        account_id="acct-1",
        status="active",
        expires_at=now - timedelta(hours=1),
        snapshot_json={"orders": [{"id": "ord-1"}]},
    )
    db.query.return_value.filter.return_value.filter.return_value.all.return_value = [expired_archive]

    service = MerchantOperationsResetService(db)
    purged_count = service.purge_expired_archives("acct-1")

    assert purged_count == 1
    assert expired_archive.status == "expired"
    assert expired_archive.snapshot_json is None
    assert expired_archive.purged_at is not None


def test_reset_operations_data_flow() -> None:
    db = MagicMock()
    # Mocking query calls to return empty lists or mock items
    inv_item = InventoryItem(
        id="inv-1",
        account_id="acct-1",
        product_id="prod-1",
        stock_quantity=Decimal("10.0"),
        kitchen_quantity=Decimal("5.0"),
        prepared_quantity=Decimal("2.0"),
    )
    customer = ShopCustomer(
        id="cust-1",
        account_id="acct-1",
        name="Test Cust",
        outstanding_balance=Decimal("200.00"),
    )
    supplier = ShopSupplier(
        id="supp-1",
        account_id="acct-1",
        name="Test Supp",
        balance=Decimal("500.00"),
    )

    def mock_query(model):
        q = MagicMock()
        if model == InventoryItem:
            q.filter.return_value.all.return_value = [inv_item]
        elif model == ShopCustomer:
            q.filter.return_value.all.return_value = [customer]
        elif model == ShopSupplier:
            q.filter.return_value.all.return_value = [supplier]
        else:
            q.filter.return_value.all.return_value = []
        return q

    db.query.side_effect = mock_query
    db.get.return_value = None

    service = MerchantOperationsResetService(db)
    result = service.reset_operations_data("acct-1", user_id="usr-1")

    assert result["success"] is True
    assert "archive_id" in result
    db.commit.assert_called_once()


def test_reset_erases_menu_and_recipes_and_reclaims() -> None:
    db = MagicMock()
    now = datetime.utcnow()

    catalogue_meal = Catalogue(
        id="cat-meal-1",
        created_by_account_id="acct-1",
        name="Grilled Chicken",
        slug="grilled-chicken",
        product_type="meal",
        category="food_beverage",
    )
    menu_item = InventoryItem(
        id="item-meal-1",
        account_id="acct-1",
        product_id="cat-meal-1",
        stock_quantity=Decimal("5.0"),
        kitchen_quantity=Decimal("2.0"),
        prepared_quantity=Decimal("1.0"),
    )
    recipe_line = RecipeLine(
        id="rec-1",
        account_id="acct-1",
        product_id="cat-meal-1",
        ingredient_product_id="raw-1",
        quantity=Decimal("0.25"),
        serving_unit="servings",
    )
    mod_group = ModifierGroup(
        id="mod-grp-1",
        account_id="acct-1",
        name="Spice Level",
    )

    added_archives: list[MerchantOperationsResetArchive] = []

    def mock_add(inst):
        if isinstance(inst, MerchantOperationsResetArchive):
            added_archives.append(inst)

    db.add.side_effect = mock_add

    def mock_query(model):
        q = MagicMock()
        if model == InventoryItem:
            q.join.return_value.filter.return_value.all.return_value = [menu_item]
            q.filter.return_value.all.return_value = [menu_item]
        elif model == Catalogue:
            q.filter.return_value.all.return_value = [catalogue_meal]
        elif model == RecipeLine:
            q.filter.return_value.all.return_value = [recipe_line]
        elif model == ModifierGroup:
            q.filter.return_value.all.return_value = [mod_group]
        else:
            q.filter.return_value.all.return_value = []
        return q

    db.query.side_effect = mock_query
    db.get.return_value = None

    service = MerchantOperationsResetService(db)
    result = service.reset_operations_data("acct-1", user_id="usr-1")

    assert result["success"] is True
    assert len(added_archives) == 1
    archive = added_archives[0]

    # Verify summary has erased menu and recipe counts
    assert archive.summary_json["menu_items_erased"] == 1
    assert archive.summary_json["recipes_erased"] == 1
    assert archive.summary_json["modifier_groups_erased"] == 1

    # Verify snapshot preserved menu and recipes
    assert len(archive.snapshot_json["menu_inventory_items"]) == 1
    assert archive.snapshot_json["menu_inventory_items"][0]["id"] == "item-meal-1"
    assert len(archive.snapshot_json["menu_catalogues"]) == 1
    assert archive.snapshot_json["menu_catalogues"][0]["id"] == "cat-meal-1"
    assert len(archive.snapshot_json["recipe_lines"]) == 1
    assert archive.snapshot_json["recipe_lines"][0]["id"] == "rec-1"
    assert len(archive.snapshot_json["modifier_groups"]) == 1
    assert archive.snapshot_json["modifier_groups"][0]["id"] == "mod-grp-1"

    # Now test reclaim flow
    archive.status = "active"
    archive.expires_at = now + timedelta(days=29)

    db.query.side_effect = None
    db.query.return_value.filter.return_value.all.return_value = []
    db.query.return_value.filter.return_value.order_by.return_value.first.return_value = archive

    reclaim_result = service.reclaim_operations_data("acct-1", user_id="usr-1")
    assert reclaim_result["success"] is True
    assert archive.status == "reclaimed"
    assert db.merge.called


