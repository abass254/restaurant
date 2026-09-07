"""Customer receipt emails include shop, lines, and M-PESA details."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

from app.config import Settings
from app.services.order_notification_service import (
    OrderNotificationService,
    build_customer_receipt_email,
)


def _item(**overrides) -> MagicMock:
    item = MagicMock()
    item.product_name = "Coffee"
    item.quantity = 2
    item.line_total = 400
    item.unit_price = 200
    for key, value in overrides.items():
        setattr(item, key, value)
    return item


def _order(**overrides) -> MagicMock:
    order = MagicMock()
    order.id = "ord-1"
    order.order_number = "ORD-000001"
    order.status = "picked_up"
    order.payment_method = "cash"
    order.currency = "KES"
    order.total = 400
    order.delivery_fee = 0
    order.discount = 0
    order.customer_name = "Amina"
    order.customer_phone = "0712345678"
    order.customer_email = None
    order.paid_at = datetime(2026, 9, 7, 9, 30)
    order.placed_at = datetime(2026, 9, 7, 9, 25)
    order.created_at = datetime(2026, 9, 7, 9, 25)
    order.items = [_item()]
    order.mpesa_transaction = None
    order.mpesa_transactions = []
    order.account = MagicMock(business_name="Mama Mboga")
    order.account_id = "acct-1"
    for key, value in overrides.items():
        setattr(order, key, value)
    return order


@patch(
    "app.services.order_notification_service.OrderTrackingService.tracking_url",
    return_value="https://dukai.app/track/abc",
)
def test_receipt_email_includes_items_and_shop(_track) -> None:
    subject, text, html = build_customer_receipt_email(
        _order(),
        shop_name="Mama Mboga",
    )
    assert subject == "Receipt from Mama Mboga — ORD-000001"
    assert "Mama Mboga" in text
    assert "2 × Coffee: KES 400.00" in text
    assert "Total: KES 400.00" in text
    assert "Asante" in text
    assert "https://dukai.app/track/abc" in text
    assert "2 × Coffee" in html
    assert "KES 400.00" in html
    assert "Track order" in html


@patch(
    "app.services.order_notification_service.OrderTrackingService.tracking_url",
    return_value=None,
)
def test_receipt_email_includes_mpesa_code(_track) -> None:
    txn = MagicMock()
    txn.mpesa_receipt_number = "QJK7ABC123"
    subject, text, html = build_customer_receipt_email(
        _order(payment_method="mpesa", mpesa_transaction=txn),
        shop_name="Mama Mboga",
    )
    assert "M-PESA" in subject or "M-PESA" in text
    assert "QJK7ABC123" in text
    assert "QJK7ABC123" in html


def test_receipt_email_skipped_without_recipient() -> None:
    service = OrderNotificationService(MagicMock(), Settings())
    service.email = MagicMock()
    assert service.notify_customer_receipt_email(_order(), "  ") is False
    service.email.send_email.assert_not_called()


@patch(
    "app.services.order_notification_service.OrderTrackingService.tracking_url",
    return_value=None,
)
def test_receipt_email_sends_via_mailer(_track) -> None:
    service = OrderNotificationService(MagicMock(), Settings())
    service.email = MagicMock()
    service.email.send_email.return_value = True
    order = _order()
    assert service.notify_customer_receipt_email(order, "amina@example.com") is True
    kwargs = service.email.send_email.call_args.kwargs
    assert kwargs["to"] == "amina@example.com"
    assert kwargs["to_name"] == "Amina"
    assert kwargs["category"] == "customer-receipt"
    assert "ORD-000001" in kwargs["subject"]
