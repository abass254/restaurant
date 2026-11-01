"""Platform openWA client and customer order WhatsApp notify policy."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx

from app.services.openwa_service import OpenWaAgentService, OpenWaSendResult
from app.services.order_notification_service import (
    OrderNotificationService,
    should_send_customer_whatsapp,
)
from app.support.order_status import PAYMENT_CASH, PAYMENT_CREDIT, PAYMENT_RECEIVED, PLACED


def _settings(**overrides) -> MagicMock:
    settings = MagicMock()
    settings.openwa_enabled = True
    settings.openwa_agent_token = "test-token"
    settings.openwa_agent_url = "http://127.0.0.1:7010"
    settings.openwa_timeout_seconds = 30.0
    for key, value in overrides.items():
        setattr(settings, key, value)
    return settings


def _response(*, status_code: int = 200, json_data: dict | None = None) -> httpx.Response:
    request = httpx.Request("POST", "http://127.0.0.1:7010/send")
    return httpx.Response(
        status_code,
        request=request,
        content=json.dumps(json_data or {}).encode(),
    )


def _httpx_client(response: httpx.Response) -> MagicMock:
    client = MagicMock()
    client.post.return_value = response
    client.get.return_value = response
    client.request.return_value = response
    return MagicMock(
        __enter__=lambda self: client,
        __exit__=lambda *args: None,
        _inner=client,
    )


def test_send_text_posts_e164_payload():
    settings = _settings()
    wrapper = _httpx_client(
        _response(json_data={"ok": True, "message_id": "99"}),
    )
    with patch("app.services.openwa_service.httpx.Client", return_value=wrapper):
        result = OpenWaAgentService(settings).send_text(
            to="0712345678",
            text="Hello from TransChap",
        )
    assert result.ok is True
    assert result.message_id == "99"
    posted = wrapper._inner.request.call_args
    assert posted.args[0] == "POST"
    assert posted.args[1] == "http://127.0.0.1:7010/send"
    assert posted.kwargs["json"] == {"to": "+254712345678", "text": "Hello from TransChap"}


def test_send_text_skips_when_unconfigured():
    result = OpenWaAgentService(_settings(openwa_agent_token="")).send_text(
        to="+254700000001",
        text="Hi",
    )
    assert result.ok is False
    assert "OPENWA_AGENT_TOKEN" in (result.error or "")


def test_send_text_rejects_empty_phone():
    result = OpenWaAgentService(_settings()).send_text(to=" ", text="Hi")
    assert result.ok is False


def test_send_text_http_error():
    wrapper = _httpx_client(
        _response(status_code=401, json_data={"error": "Unauthorized."}),
    )
    with patch("app.services.openwa_service.httpx.Client", return_value=wrapper):
        result = OpenWaAgentService(_settings()).send_text(
            to="+254700000001",
            text="Hi",
        )
    assert result.ok is False
    assert result.error == "Unauthorized."


def test_should_send_whatsapp_for_paid_and_till_cash():
    cash = MagicMock(payment_method=PAYMENT_CASH)
    credit = MagicMock(payment_method=PAYMENT_CREDIT)
    mpesa = MagicMock(payment_method="mpesa")
    assert should_send_customer_whatsapp(cash, PLACED) is True
    assert should_send_customer_whatsapp(credit, PLACED) is False
    assert should_send_customer_whatsapp(mpesa, PLACED) is False
    assert should_send_customer_whatsapp(mpesa, PAYMENT_RECEIVED) is True


def test_notify_customer_whatsapp_requires_enabled_and_phone():
    db = MagicMock()
    settings = _settings(openwa_enabled=False)
    service = OrderNotificationService(db, settings)
    service.whatsapp = OpenWaAgentService(settings)
    order = MagicMock(
        id="ord-1",
        customer_phone="+254700000001",
        payment_method=PAYMENT_CASH,
        last_customer_whatsapp_notified=None,
        order_number="A1",
        total=100,
        fulfillment_type="pickup",
    )
    assert service.notify_customer_whatsapp(order, PLACED) is False

    settings.openwa_enabled = True
    service.whatsapp = OpenWaAgentService(settings)
    order.customer_phone = None
    assert service.notify_customer_whatsapp(order, PLACED) is False


def test_notify_customer_whatsapp_sends_and_dedupes():
    db = MagicMock()
    settings = _settings()
    service = OrderNotificationService(db, settings)
    service.whatsapp.send_text = MagicMock(
        return_value=OpenWaSendResult(ok=True, message_id="1"),
    )
    order = MagicMock(
        id="ord-1",
        customer_phone="+254700000001",
        payment_method=PAYMENT_CASH,
        last_customer_whatsapp_notified=None,
        order_number="A1",
        total=250,
        fulfillment_type="pickup",
        assigned_rider=None,
        assigned_rider_id=None,
        status_history=[],
    )
    assert service.notify_customer_whatsapp(order, PLACED) is True
    service.whatsapp.send_text.assert_called_once()
    assert order.last_customer_whatsapp_notified == PLACED
    db.commit.assert_called()

    service.whatsapp.send_text.reset_mock()
    assert service.notify_customer_whatsapp(order, PLACED) is False
    service.whatsapp.send_text.assert_not_called()


def test_notify_status_change_sends_whatsapp_without_instagram():
    db = MagicMock()
    settings = _settings()
    service = OrderNotificationService(db, settings)
    service.notify_customer_whatsapp = MagicMock(return_value=True)
    order = MagicMock(
        source_conversation_id=None,
        last_customer_status_notified=None,
    )
    assert service.notify_status_change(order, PAYMENT_RECEIVED) is False
    service.notify_customer_whatsapp.assert_called_once()
