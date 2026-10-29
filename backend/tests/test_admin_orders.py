"""Tests for platform admin orders endpoints, pagination, accurate counts, and summary statistics."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock

from app.api.v1.admin import (
    AdminOrderSummary,
    AdminOrdersResponse,
    AdminOrdersStats,
    list_orders,
)
from app.models import Account, Order, OrderItem, User


def test_admin_orders_stats_schema():
    stats = AdminOrdersStats(
        total_orders=4115,
        total_revenue=2871819.59,
        average_order_value=704.05,
        today_orders=144,
        today_revenue=236875.0,
        active_orders=24,
        status_counts={"payment_received": 2671, "picked_up": 1408},
        period_label="Last 7 days",
    )
    assert stats.total_orders == 4115
    assert stats.total_revenue == 2871819.59
    assert stats.average_order_value == 704.05
    assert stats.today_orders == 144
    assert stats.today_revenue == 236875.0
    assert stats.active_orders == 24
    assert stats.status_counts["payment_received"] == 2671
    assert stats.period_label == "Last 7 days"


def test_admin_order_summary_and_response_schema():
    now = datetime.now(timezone.utc)
    summary = AdminOrderSummary(
        id="order-123",
        account_id="acct-456",
        merchant_name="Shiil Wholesale Limited",
        order_number="ORDSWL00105",
        source="walkin",
        fulfillment_type="pickup",
        status="picked_up",
        customer_name="Abdiker",
        customer_phone="0712345678",
        total=1600.0,
        currency="KES",
        payment_method="mpesa",
        items_count=3,
        lines_count=1,
        created_at=now,
        updated_at=now,
        placed_at=now,
        completed_at=now,
        cancelled_at=None,
    )
    assert summary.order_number == "ORDSWL00105"
    assert summary.items_count == 3
    assert summary.lines_count == 1

    stats = AdminOrdersStats(
        total_orders=1,
        total_revenue=1600.0,
        average_order_value=1600.0,
        today_orders=1,
        today_revenue=1600.0,
        active_orders=0,
        status_counts={"picked_up": 1},
        period_label="Today",
    )

    response = AdminOrdersResponse(
        data=[summary],
        total=1,
        page=1,
        per_page=50,
        total_pages=1,
        stats=stats,
    )
    assert response.total == 1
    assert len(response.data) == 1
    assert response.stats is not None
    assert response.stats.total_orders == 1
    assert response.stats.period_label == "Today"


def test_list_orders_accurate_pagination_and_item_units():
    db = MagicMock()
    super_admin = User(id="admin-1", username="netizen", user_role="super_admin")

    account = Account(id="acct-1", business_name="Shiil Wholesale Limited")
    order = Order(
        id="ord-1",
        account_id="acct-1",
        order_number="ORDSWL0001",
        source="walkin",
        fulfillment_type="pickup",
        status="payment_received",
        total=Decimal("480.00"),
        currency="KES",
        created_at=datetime(2026, 10, 28, 12, 0, 0),
    )
    order.account = account
    item = OrderItem(
        id="item-1",
        order_id="ord-1",
        product_name="Soko Ugali 2kg",
        quantity=3,
        unit_price=Decimal("160.00"),
        line_total=Decimal("480.00"),
    )
    order.items = [item]

    # Mock query chain
    mock_query = db.query.return_value
    mock_query.outerjoin.return_value = mock_query
    mock_query.options.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.order_by.return_value = mock_query
    mock_query.offset.return_value = mock_query
    mock_query.limit.return_value = mock_query
    mock_query.count.return_value = 1
    mock_query.all.return_value = [order]
    mock_query.scalar.return_value = 480.0

    res = list_orders(
        q="ORDSWL",
        date_range="today",
        page=1,
        per_page=50,
        db=db,
        _=super_admin,
    )

    assert res.total == 1
    assert len(res.data) == 1
    # Items count should accurately reflect 3 units, and lines_count 1
    assert res.data[0].items_count == 3
    assert res.data[0].lines_count == 1
    assert res.data[0].total == 480.0
    assert res.stats is not None
    assert res.stats.period_label == "Today"
