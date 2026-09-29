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
