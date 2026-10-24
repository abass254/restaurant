"""Customer receipt emails include shop, lines, and M-PESA details."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

from app.config import Settings
from app.services.order_notification_service import (
    OrderNotificationService,
    build_customer_receipt_email,
    build_customer_receipt_whatsapp,
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


def test_receipt_whatsapp_includes_shop_and_payment() -> None:
    text = build_customer_receipt_whatsapp(_order(), shop_name="Mama Mboga")
    assert "ORD-000001 Confirmed." in text
    assert "Mama Mboga" in text
    assert "Coffee" in text
    assert "2pc" in text
    assert "Paid in cash." in text
    assert "Thank you for shopping with us." in text


def test_receipt_whatsapp_includes_pdf_and_credit_tab() -> None:
    text = build_customer_receipt_whatsapp(
        _order(payment_method="credit"),
        shop_name="Mama Mboga",
        receipt_pdf_url="https://example.com/uploads/receipts/a/o.pdf",
        credit_outstanding=1200,
        pay_bill_url="https://example.com/pay-bill/tok",
    )
    assert "On credit." in text
    assert "Your tab is now KES 1,200.00." in text
    assert "Pay your bill: https://example.com/pay-bill/tok" in text
    assert "[View Receipt](https://example.com/uploads/receipts/a/o.pdf)" in text


def test_receipt_whatsapp_includes_mpesa_code() -> None:
    txn = MagicMock()
    txn.mpesa_receipt_number = "QJK7ABC123"
    text = build_customer_receipt_whatsapp(
        _order(payment_method="mpesa", mpesa_transaction=txn),
        shop_name="Mama Mboga",
    )
    assert "Paid via M-PESA. Receipt QJK7ABC123." in text


def test_receipt_whatsapp_send_uses_openwa() -> None:
    from app.services.openwa_service import OpenWaSendResult

    service = OrderNotificationService(MagicMock(), Settings())
    service.whatsapp = MagicMock()
    service.whatsapp.configured = True
    service.whatsapp.send_text.return_value = OpenWaSendResult(ok=True, message_id="1")
    with patch(
        "app.services.receipt_pdf_service.ensure_order_receipt_pdf_url",
        return_value="https://example.com/r.pdf",
    ):
        result = service.notify_customer_receipt_whatsapp(_order(), "+254712345678")
    assert result.ok is True
    kwargs = service.whatsapp.send_text.call_args.kwargs
    assert kwargs["to"] == "+254712345678"
    assert "ORD-000001 Confirmed." in kwargs["text"]
    assert "[View Receipt](https://example.com/r.pdf)" in kwargs["text"]


def test_receipt_whatsapp_skipped_without_phone() -> None:
    service = OrderNotificationService(MagicMock(), Settings())
    service.whatsapp = MagicMock()
    result = service.notify_customer_receipt_whatsapp(_order(), "  ")
    assert result.ok is False
    service.whatsapp.send_text.assert_not_called()


def test_build_whatsapp_receipt_items_table_exact_format() -> None:
    from app.services.order_notification_service import build_whatsapp_receipt_items_table

    items = [
        _item(product_name="Mangos", quantity=1, unit_price=0, line_total=0),
        _item(product_name="Ajab Unga 12×2kg", quantity=1, unit_price=200, line_total=200),
        _item(product_name="Cocacola 1.5 Ltrs", quantity=1, unit_price=250, line_total=250),
        _item(product_name="Fanta Orange 2L", quantity=1, unit_price=250, line_total=250),
        _item(product_name="Mineral Water 5 ltr", quantity=1, unit_price=0, line_total=0),
        _item(product_name="Test Product", quantity=6, unit_price=10, line_total=60),
    ]
    order = _order(items=items, subtotal=760, total=760)
    lines = build_whatsapp_receipt_items_table(order, currency="KES")
    rendered = "\n".join(lines)

    expected = (
        "```\n"
        "ITEMS (KES):\n"
        "\n"
        "ITEM               QTY   PRICE   TOTAL\n"
        "──────────────────────────────────────\n"
        "Mangos             1pc       0       0\n"
        "Ajab Unga 12×2kg\n"
        "                   1pc     200     200\n"
        "Cocacola 1.5 Ltrs\n"
        "                   1pc     250     250\n"
        "Fanta Orange 2L\n"
        "                   1pc     250     250\n"
        "Mineral Water 5 ltr\n"
        "                   1pc       0       0\n"
        "Test Product\n"
        "                   6pc      10      60\n"
        "──────────────────────────────────────\n"
        "              Subtotal:            760\n"
        "              TOTAL:           KES 760\n"
        "──────────────────────────────────────\n"
        "```"
    )
    assert rendered == expected

