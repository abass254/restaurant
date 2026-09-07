"""Africa's Talking SMS client and phone-OTP policy."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx

from app.services.africastalking_service import (
    LIVE_API_URL,
    SANDBOX_API_URL,
    AfricasTalkingSmsService,
)
from app.services.login_otp_sms import format_login_otp_sms
from app.support.otp_delivery import phone_otp_allowed, sms_configured


def _settings(**overrides) -> MagicMock:
    settings = MagicMock()
    settings.africastalking_username = "dukai"
    settings.africastalking_api_key = "test-key"
    settings.africastalking_sender_id = ""
    settings.africastalking_sandbox = True
    settings.africastalking_timeout_seconds = 15.0
    for key, value in overrides.items():
        setattr(settings, key, value)
    return settings


def _response(*, status_code: int = 201, json_data: dict | None = None) -> httpx.Response:
    request = httpx.Request("POST", SANDBOX_API_URL)
    return httpx.Response(
        status_code,
        request=request,
        content=json.dumps(json_data or {}).encode(),
    )


def _accepted_payload(message_id: str = "ATXid_1") -> dict:
    return {
        "SMSMessageData": {
            "Message": "Sent to 1/1 Total Cost: KES 0.8000",
            "Recipients": [
                {
                    "statusCode": 101,
                    "number": "+254712345678",
                    "status": "Success",
                    "cost": "KES 0.8000",
                    "messageId": message_id,
                }
            ],
        }
    }


def _httpx_client(response: httpx.Response) -> MagicMock:
    client = MagicMock()
    client.post.return_value = response
    return MagicMock(
        __enter__=lambda self: client,
        __exit__=lambda *args: None,
        _inner=client,
    )


def test_send_text_posts_form_urlencoded_e164():
    settings = _settings()
    wrapper = _httpx_client(_response(json_data=_accepted_payload("ATXid_99")))
    with patch("app.services.africastalking_service.httpx.Client", return_value=wrapper):
        result = AfricasTalkingSmsService(settings).send_text(
            to="0712345678",
            text="DukAI login code: 123456",
        )
    assert result.ok is True
    assert result.message_id == "ATXid_99"
    posted = wrapper._inner.post.call_args
    assert posted.args[0] == SANDBOX_API_URL
    assert posted.kwargs["data"]["to"] == "+254712345678"
    assert posted.kwargs["data"]["username"] == "dukai"
    assert posted.kwargs["data"]["message"] == "DukAI login code: 123456"
    assert "from" not in posted.kwargs["data"]
    assert posted.kwargs["headers"]["apiKey"] == "test-key"


def test_send_text_includes_sender_id():
    settings = _settings(africastalking_sender_id="DUKAI")
    wrapper = _httpx_client(_response(json_data=_accepted_payload()))
    with patch("app.services.africastalking_service.httpx.Client", return_value=wrapper):
        AfricasTalkingSmsService(settings).send_text(to="+254700000001", text="Hi")
    assert wrapper._inner.post.call_args.kwargs["data"]["from"] == "DUKAI"


def test_live_url_when_not_sandbox():
    settings = _settings(africastalking_sandbox=False)
    wrapper = _httpx_client(_response(json_data=_accepted_payload()))
    with patch("app.services.africastalking_service.httpx.Client", return_value=wrapper):
        AfricasTalkingSmsService(settings).send_text(to="+254700000001", text="Hi")
    assert wrapper._inner.post.call_args.args[0] == LIVE_API_URL


def test_sandbox_username_forces_sandbox_url():
    settings = _settings(
        africastalking_username="sandbox",
        africastalking_sandbox=False,
    )
    wrapper = _httpx_client(_response(json_data=_accepted_payload()))
    with patch("app.services.africastalking_service.httpx.Client", return_value=wrapper):
        AfricasTalkingSmsService(settings).send_text(to="+254700000001", text="Hi")
    assert wrapper._inner.post.call_args.args[0] == SANDBOX_API_URL


def test_send_text_skips_when_unconfigured():
    result = AfricasTalkingSmsService(_settings(africastalking_api_key="")).send_text(
        to="+254700000001",
        text="Hi",
    )
    assert result.ok is False
    assert "AFRICASTALKING" in (result.error or "")


def test_send_text_rejects_empty_phone():
    result = AfricasTalkingSmsService(_settings()).send_text(to=" ", text="Hi")
    assert result.ok is False


def test_recipient_failure_is_not_ok():
    payload = {
        "SMSMessageData": {
            "Message": "Sent to 0/1 Total Cost: KES 0.0000",
            "Recipients": [
                {
                    "statusCode": 403,
                    "number": "+254700000001",
                    "status": "InvalidPhoneNumber",
                    "messageId": "None",
                }
            ],
        }
    }
    wrapper = _httpx_client(_response(json_data=payload))
    with patch("app.services.africastalking_service.httpx.Client", return_value=wrapper):
        result = AfricasTalkingSmsService(_settings()).send_text(
            to="+254700000001",
            text="Hi",
        )
    assert result.ok is False
    assert result.error == "InvalidPhoneNumber"


def test_http_error():
    wrapper = _httpx_client(
        _response(status_code=401, json_data={"message": "Invalid API key"}),
    )
    with patch("app.services.africastalking_service.httpx.Client", return_value=wrapper):
        result = AfricasTalkingSmsService(_settings()).send_text(
            to="+254700000001",
            text="Hi",
        )
    assert result.ok is False
    assert result.error == "Invalid API key"


def test_otp_sms_copy_stays_short():
    text = format_login_otp_sms(code="123456", expires_in_seconds=600, kind="login")
    assert "123456" in text
    assert len(text) <= 160


@patch("app.support.otp_delivery.get_settings")
def test_phone_otp_allowed_when_sms_configured(mock_settings):
    mock_settings.return_value = _settings(app_debug=False)
    assert sms_configured() is True
    assert phone_otp_allowed() is True


@patch("app.support.otp_delivery.get_settings")
def test_phone_otp_blocked_without_sms_or_debug(mock_settings):
    mock_settings.return_value = _settings(
        africastalking_username="",
        africastalking_api_key="",
        app_debug=False,
    )
    assert sms_configured() is False
    assert phone_otp_allowed() is False
