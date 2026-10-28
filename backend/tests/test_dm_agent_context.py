"""Tests for proactive DM agent context (Phase 1 + sales closer)."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.catalog.catalog_types import CatalogItem, platform_ref
from app.services.dm_agent_context import (
    build_conversation_context,
    build_inventory_summary_dict,
    build_session_context_dict,
    build_shop_info_dict,
    order_to_agent_dict,
)


def _catalog_item(
    name: str,
    *,
    item_id: str = "item-1",
    stock: int = 10,
    category: str = "perfume",
    product_type: str = "product",
) -> CatalogItem:
    return CatalogItem(
        ref=platform_ref(item_id),
        source="platform",
        name=name,
        price=Decimal("1500"),
        stock=stock,
        category=category,
        description=f"Description for {name}",
        image_urls=("https://example.com/a.jpg",),
        is_active=True,
        product_type=product_type,
        platform_inventory_item_id=item_id,
    )


def _mock_db_for_inventory(*, total: int = 12, type_rows=None):
    db = MagicMock()
    count_q = MagicMock()
    count_q.filter.return_value.count.return_value = total

    type_q = MagicMock()
    type_q.join.return_value.filter.return_value.group_by.return_value.all.return_value = (
        type_rows if type_rows is not None else [("product", 10), ("service", 2)]
    )

    def query_side_effect(*args, **_kwargs):
        # InventoryItem count query vs Product.product_type group query
        if args and getattr(args[0], "key", None) == "product_type":
            return type_q
        if len(args) > 1:
            return type_q
        return count_q

    db.query.side_effect = query_side_effect
    return db


def test_order_to_agent_dict_includes_line_summary():
    order = SimpleNamespace(
        id="ord-1",
        order_number="ORD-000042",
        status="awaiting_payment",
        total=2500,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        items=[
            SimpleNamespace(quantity=2, product_name="Blue Spray"),
        ],
        status_history=[],
    )
    payload = order_to_agent_dict(order)
    assert payload["order_number"] == "ORD-000042"
    assert payload["status_label"] == "Payment requested"
    assert payload["items_summary"] == "2× Blue Spray"
    assert payload["is_active"] is True


def test_build_session_context_dict_resolves_pending_product():
    catalog = MagicMock()
    catalog.get_catalog_item.return_value = _catalog_item("Cairo", item_id="cairo-id")
    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        sales_session={
            "step": "awaiting_order_confirm",
            "catalog_pending_item_id": "cairo-id",
            "catalog_pending_quantity": 2,
        },
    )
    result = build_session_context_dict(conversation, catalog, account, "merchant-1")
    assert result["step_label"] == "awaiting order confirmation"
    assert result["pending_product"] == "Cairo"
    assert result["pending_quantity"] == 2


def test_build_inventory_summary_dict_counts_categories_and_low_stock():
    db = _mock_db_for_inventory(total=12)
    catalog = MagicMock()
    catalog.list_catalog_items.return_value = [
        _catalog_item("Cairo", stock=2),
        _catalog_item("Florence", stock=0, item_id="item-2"),
        _catalog_item("Rome", stock=20, item_id="item-3", category="gift"),
    ]
    account = SimpleNamespace(account_id="merchant-1")

    provider = MagicMock()
    provider.item_by_id.return_value = SimpleNamespace(
        stock_quantity=2,
        low_stock_threshold=5,
        is_low_stock=lambda: True,
    )
    catalog.provider_for_account.return_value = provider

    summary = build_inventory_summary_dict(
        db,
        "merchant-1",
        catalog,
        account,
    )
    assert summary["total_active_products"] == 12
    assert summary["product_count"] == 10
    assert summary["service_count"] == 2
    assert summary["low_stock"][0]["name"] == "Cairo"
    assert summary["out_of_stock_count"] == 1


def test_build_shop_info_dict_includes_location_and_pause():
    merchant = SimpleNamespace(
        business_name="Spice House",
        business_location="Westlands, Nairobi",
        business_category="beauty",
        orders_paused=True,
        orders_paused_until=None,
        orders_paused_reason="manual",
        busy_extra_prep_minutes=0,
        default_prep_minutes=25,
        station_last_heartbeat_at=None,
        station_heartbeat_required=False,
    )
    maps = SimpleNamespace(delivery_fee_per_km=50, id="maps-1")
    db = MagicMock()
    db.get.return_value = merchant
    db.query.return_value.filter.return_value.order_by.return_value.first.return_value = maps

    info = build_shop_info_dict(db, "merchant-1")
    assert info["business_name"] == "Spice House"
    assert info["business_location"] == "Westlands, Nairobi"
    assert info["accepting_orders"] is False
    assert info["store_status"] == "paused"
    assert info["delivery_fee_per_km"] == 50.0
    assert info["default_prep_minutes"] == 25


def test_build_conversation_context_includes_shop_profile_and_active_order():
    merchant = SimpleNamespace(
        business_name="Spice House",
        business_location="Westlands, Nairobi",
        business_category="beauty",
        orders_paused=False,
        orders_paused_until=None,
        orders_paused_reason=None,
        busy_extra_prep_minutes=0,
        default_prep_minutes=20,
        station_last_heartbeat_at=None,
        station_heartbeat_required=False,
    )
    db = _mock_db_for_inventory(total=5, type_rows=[("product", 4), ("service", 1)])
    db.get.return_value = merchant
    maps_q = MagicMock()
    maps_q.filter.return_value.order_by.return_value.first.return_value = SimpleNamespace(
        delivery_fee_per_km=40,
        id="maps-1",
    )

    original_side_effect = db.query.side_effect

    def query_side_effect(*args, **kwargs):
        # GoogleMapsConfiguration lookups are class-based with no product_type
        from app.models import GoogleMapsConfiguration

        if args and args[0] is GoogleMapsConfiguration:
            return maps_q
        return original_side_effect(*args, **kwargs)

    db.query.side_effect = query_side_effect

    catalog = MagicMock()
    catalog.list_catalog_items.return_value = [_catalog_item("Cairo", stock=8)]
    catalog.get_catalog_item.return_value = None
    catalog.provider_for_account.return_value = MagicMock(item_by_id=lambda *_a, **_k: None)

    active_order = SimpleNamespace(
        id="ord-1",
        order_number="ORD-000099",
        status="awaiting_payment",
        total=3000,
        created_at=None,
        items=[SimpleNamespace(quantity=1, product_name="Cairo")],
        status_history=[],
    )
    orders = MagicMock()
    orders.order_for_session.return_value = active_order
    orders.latest_order_for_conversation.return_value = active_order

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        id="conv-1",
        sales_session={"step": "idle"},
    )

    context = build_conversation_context(
        db,
        account,
        conversation,
        orders=orders,
        catalog=catalog,
    )
    assert "Live context" in context
    assert "Spice House" in context
    assert "Westlands, Nairobi" in context
    assert "accepting orders" in context
    assert "5 active listing(s)" in context
    assert "4 product(s)" in context
    assert "1 service(s)" in context
    assert "KES 40/km" in context
    assert "ORD-000099" in context
    assert "Payment requested" in context
    assert "get_shop_info" in context
    assert "recommend_products" in context
