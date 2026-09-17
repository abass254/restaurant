from decimal import Decimal
import pytest
from app.models import Order, OrderItem
from app.schemas import OrderOut, OrderItemOut
from app.support.order_status import FULFILLMENT_DINE_IN, forward_flow, awaiting_confirmation_status, completion_status

def test_dine_in_fulfillment_lifecycle():
    assert FULFILLMENT_DINE_IN == "dine_in"
    flow = forward_flow("dine_in")
    assert "ready" in flow
    assert awaiting_confirmation_status("dine_in") == "awaiting_pickup_confirmation"
    assert completion_status("dine_in") == "picked_up"

def test_order_and_item_schema_serialization():
    item = OrderItem(
        id="test-item-1",
        order_id="test-order-1",
        product_name="Tingishaki",
        quantity=1,
        unit_price=Decimal("1100.00"),
        line_total=Decimal("1100.00"),
        modifiers=[
            {"name": "Beef", "price": 100.0, "group": "Proteins & Meats"},
            {"name": "Extra Chicken", "price": 150.0, "group": "Proteins & Meats"},
            {"name": "Poussin Chips", "price": 200.0, "group": "Sides & Accompaniments"},
            {"name": "Very Spicy", "price": 0.0, "group": "Cooking & Spice Notes"},
        ],
        notes="Very hot please",
    )
    item_out = OrderItemOut.from_model(item)
    assert item_out.product_name == "Tingishaki"
    assert item_out.unit_price == 1100.0
    assert len(item_out.modifiers) == 4
    assert item_out.modifiers[0]["name"] == "Beef"
    assert item_out.modifiers[0]["price"] == 100.0

    order = Order(
        id="test-order-1",
        account_id="acc-1",
        order_number="ORD-1001",
        source="walkin",
        fulfillment_type="dine_in",
        table_number="Table 1",
        status="placed",
        subtotal=Decimal("1100.00"),
        delivery_fee=Decimal("0.00"),
        discount=Decimal("0.00"),
        total=Decimal("1100.00"),
        currency="KES",
        items=[item],
    )
    order_out = OrderOut.from_model(order)
    assert order_out.order_number == "ORD-1001"
    assert order_out.fulfillment_type == "dine_in"
    assert order_out.table_number == "Table 1"
    assert len(order_out.items) == 1
    assert order_out.items[0].modifiers[1]["name"] == "Extra Chicken"
