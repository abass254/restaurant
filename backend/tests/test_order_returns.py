from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas import OrderOut, OrderReturnCreate, OrderReturnLineIn, OrderReturnOut


def test_order_return_create_validation():
    # Valid return
    payload = OrderReturnCreate(
        items=[OrderReturnLineIn(order_item_id="item-1", quantity=2, condition="restock")],
        reason="Wrong item",
        refund_payment_method="cash",
    )
    assert len(payload.items) == 1
    assert payload.items[0].quantity == 2
    assert payload.items[0].condition == "restock"
    assert payload.reason == "Wrong item"
    assert payload.refund_payment_method == "cash"

    # Empty items fails
    with pytest.raises(ValidationError):
        OrderReturnCreate(items=[], reason="Empty")

    # Quantity <= 0 fails
    with pytest.raises(ValidationError):
        OrderReturnLineIn(order_item_id="item-1", quantity=0)


def test_order_out_serializes_returns_and_returned_quantity():
    order = SimpleNamespace(
        id="order-ret-1",
        account_id="account-1",
        order_number="WALK-1001",
        source="walkin",
        fulfillment_type="pickup",
        status="paid",
        table_number=None,
        placed_by=None,
        customer_name="Jane Doe",
        customer_phone="+254712345678",
        customer_email=None,
        delivery_address=None,
        delivery_notes=None,
        pickup_address=None,
        pickup_lat=None,
        pickup_lng=None,
        subtotal=Decimal("1500.00"),
        delivery_fee=Decimal("0.00"),
        tax=Decimal("0.00"),
        discount=Decimal("0.00"),
        total=Decimal("1500.00"),
        returned_total=Decimal("500.00"),
        currency="KES",
        payment_method="cash",
        payment_splits=None,
        mpesa_transaction_id=None,
        placed_by_user_id=None,
        placed_at=None,
        paid_at=None,
        prepared_at=None,
        ready_at=None,
        dispatched_at=None,
        completed_at=None,
        cancelled_at=None,
        merchant_delivery_confirmed_at=None,
        customer_delivery_confirmed_at=None,
        delivery_disputed_at=None,
        notes=None,
        prep_minutes=None,
        created_at=None,
        updated_at=None,
        assigned_rider_id=None,
        assigned_rider=None,
        rider_assigned_at=None,
        rider_dispatched_at=None,
        rider_trip_phase=None,
        rider_search_expires_at=None,
        items=[
            SimpleNamespace(
                id="item-1",
                inventory_item_id="inv-1",
                product_id=None,
                product_name="Milk 500ml",
                product_sku="MILK-500",
                quantity=3,
                returned_quantity=1,
                unit_price=Decimal("100.00"),
                line_total=Decimal("300.00"),
                sell_unit="pack",
                unit_factor=Decimal("1.0"),
                notes=None,
                modifiers=None,
                inventory_item=None,
                cost_total=None,
            )
        ],
        returns=[
            SimpleNamespace(
                id="ret-1",
                order_id="order-ret-1",
                return_number="RET-WALK-1001-1",
                total_refunded=Decimal("100.00"),
                refund_payment_method="cash",
                reason="Customer changed mind",
                notes=None,
                created_by_user_id="user-1",
                created_at=None,
                items=[
                    SimpleNamespace(
                        id="ret-item-1",
                        order_item_id="item-1",
                        inventory_item_id="inv-1",
                        product_name="Milk 500ml",
                        quantity=1,
                        unit_price=Decimal("100.00"),
                        refund_amount=Decimal("100.00"),
                        restock=True,
                        condition_name="good",
                        created_at=None,
                    )
                ],
            )
        ],
        status_history=[],
        mpesa_transaction=None,
        mpesa_transactions=[],
    )

    out = OrderOut.from_model(order, include_workflow=False)
    assert out.returned_total == 500.00
    assert out.items[0].returned_quantity == 1
    assert len(out.returns) == 1
    assert out.returns[0].return_number == "RET-WALK-1001-1"
    assert out.returns[0].items[0].quantity == 1
