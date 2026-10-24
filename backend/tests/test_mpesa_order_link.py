from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.support.mpesa_order_link import confirm_mpesa_receipt_for_order


def test_manual_mpesa_payment_can_be_confirmed_without_receipt_code() -> None:
    db = MagicMock()
    order = SimpleNamespace(
        id="order-1",
        account_id="account-1",
        order_number="POS-100",
        customer_phone=None,
        total=1400,
    )

    transaction = confirm_mpesa_receipt_for_order(
        db,  # type: ignore[arg-type]
        order,  # type: ignore[arg-type]
        "",
        confirmed_by_user_id="user-1",
    )

    assert transaction.status == "success"
    assert transaction.mpesa_receipt_number is None
    assert transaction.payout_status == "skipped"
    assert transaction.callback_payload["merchant_direct_confirm"] is True
    assert transaction.callback_payload["receipt_code_provided"] is False
    assert "without receipt code" in transaction.result_desc
    db.add.assert_called_once_with(transaction)
    db.flush.assert_called_once()


def test_order_create_send_mpesa_stk_push_schema() -> None:
    from app.api.v1.orders import OrderCreate

    payload_stk = OrderCreate(
        source="walkin",
        fulfillment_type="pickup",
        payment_method="mpesa",
        send_mpesa_stk_push=True,
        customer_phone="254712345678",
        items=[{"inventory_item_id": "item-1", "quantity": 1, "unit_price": 100}],
    )
    assert payload_stk.send_mpesa_stk_push is True

    payload_record = OrderCreate(
        source="walkin",
        fulfillment_type="pickup",
        payment_method="mpesa",
        send_mpesa_stk_push=False,
        mpesa_receipt_number="NLX123456",
        items=[{"inventory_item_id": "item-1", "quantity": 1, "unit_price": 100}],
    )
    assert payload_record.send_mpesa_stk_push is False
    assert payload_record.mpesa_receipt_number == "NLX123456"

