from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api.v1.orders import OrderCreate
from app.services.order_notification_service import (
    build_customer_receipt_whatsapp,
    should_send_customer_whatsapp,
)
from app.support.mpesa_order_link import (
    _expected_order_amount,
    order_requires_mpesa_receipt_confirmation,
)
from app.support.order_payments import (
    normalize_payment_splits,
    order_uses_payment,
    payment_portion,
    payment_portions,
    payment_summary,
)


def _order(**overrides):
    base = dict(
        id="order-1",
        account_id="account-1",
        order_number="POS-1",
        payment_method="split",
        payment_splits=[
            {"method": "cash", "amount": 500},
            {"method": "mpesa", "amount": 300},
        ],
        source="walkin",
        fulfillment_type="pickup",
        status="placed",
        customer_phone=None,
        customer_email=None,
        delivery_address=None,
        delivery_notes=None,
        subtotal=Decimal("800.00"),
        delivery_fee=Decimal("0.00"),
        discount=Decimal("0.00"),
        tax=Decimal("0.00"),
        placed_by_user_id=None,
        placed_at=None,
        prepared_at=None,
        ready_at=None,
        dispatched_at=None,
        completed_at=None,
        cancelled_at=None,
        merchant_delivery_confirmed_at=None,
        customer_delivery_confirmed_at=None,
        delivery_disputed_at=None,
        notes=None,
        created_at=None,
        updated_at=None,
        total=Decimal("800.00"),
        currency="KES",
        paid_at=None,
        mpesa_transaction_id=None,
        mpesa_transactions=[],
        customer_name=None,
        items=[],
        mpesa_transaction=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_normalize_merges_repeated_methods_and_drops_zero() -> None:
    rows = normalize_payment_splits(
        [
            {"method": "cash", "amount": 200},
            {"method": "mpesa", "amount": 0},
            {"method": "cash", "amount": 100.5},
        ],
    )
    assert rows == [{"method": "cash", "amount": 300.5}]


def test_split_order_portions() -> None:
    order = _order()
    assert payment_portions(order) == {
        "cash": Decimal("500.00"),
        "mpesa": Decimal("300.00"),
    }
    assert payment_portion(order, "credit") == Decimal("0.00")
    assert order_uses_payment(order, "mpesa")
    assert not order_uses_payment(order, "credit")
    assert payment_summary(order) == "Cash KES 500.00 + M-PESA KES 300.00"


def test_single_method_order_owes_full_total() -> None:
    order = _order(payment_method="credit", payment_splits=None)
    assert payment_portions(order) == {"credit": Decimal("800.00")}
    assert payment_summary(order) == "Credit"


def test_mpesa_receipt_matches_only_the_mpesa_share() -> None:
    order = _order()
    assert _expected_order_amount(order) == 300
    assert order_requires_mpesa_receipt_confirmation(order)
    assert not order_requires_mpesa_receipt_confirmation(
        _order(payment_splits=[
            {"method": "cash", "amount": 500},
            {"method": "credit", "amount": 300},
        ]),
    )


def test_till_whatsapp_only_when_split_is_cash_or_card() -> None:
    cash_card = _order(payment_splits=[
        {"method": "cash", "amount": 500},
        {"method": "card", "amount": 300},
    ])
    assert should_send_customer_whatsapp(cash_card, "placed")
    assert not should_send_customer_whatsapp(_order(), "placed")


def test_split_whatsapp_receipt_lists_each_method() -> None:
    order = _order(payment_splits=[
        {"method": "cash", "amount": 500},
        {"method": "credit", "amount": 300},
    ])
    text = build_customer_receipt_whatsapp(
        order,
        shop_name="Shop",
        credit_outstanding=300,
    )
    assert "Paid with Cash KES 500.00 + Credit KES 300.00." in text
    assert "Your tab is now" in text


def test_order_create_accepts_split_payments() -> None:
    payload = OrderCreate(
        source="walkin",
        fulfillment_type="pickup",
        payment_method="split",
        payments=[
            {"method": "cash", "amount": 500},
            {"method": "mpesa", "amount": 300},
        ],
        items=[{"product_name": "Item", "unit_price": 800, "quantity": 1}],
    )
    assert [p.method for p in payload.payments or []] == ["cash", "mpesa"]

    with pytest.raises(ValidationError):
        OrderCreate(
            source="walkin",
            fulfillment_type="pickup",
            payment_method="split",
            payments=[{"method": "cash", "amount": 0}],
            items=[{"product_name": "Item", "unit_price": 800, "quantity": 1}],
        )


def test_order_create_accepts_tax() -> None:
    payload = OrderCreate(
        source="walkin",
        fulfillment_type="pickup",
        payment_method="cash",
        tax=128.00,
        items=[{"product_name": "Item", "unit_price": 800, "quantity": 1}],
    )
    assert payload.tax == 128.00


def test_order_out_serializes_tax() -> None:
    from app.schemas import OrderOut

    order = _order(tax=Decimal("128.00"))
    out = OrderOut.from_model(order, include_history=False, include_workflow=False)
    assert out.tax == 128.00


def test_order_create_credit_without_phone() -> None:
    payload = OrderCreate(
        source="walkin",
        fulfillment_type="pickup",
        payment_method="credit",
        customer_id="cust-123",
        customer_name="AERA KITCHENS TERRY",
        customer_phone=None,
        items=[{"product_name": "Item", "unit_price": 800, "quantity": 1}],
    )
    assert payload.customer_id == "cust-123"
    assert payload.customer_name == "AERA KITCHENS TERRY"
    assert payload.customer_phone is None

