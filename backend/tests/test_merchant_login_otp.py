"""Merchant OTP delivery must not leak codes outside debug."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.merchant_login_otp import MerchantLoginOtpService, MerchantOtpError
from app.support.otp_delivery import MAIL_SEND_FAILED, PHONE_OTP_UNAVAILABLE


def _user(**overrides) -> MagicMock:
    user = MagicMock()
    user.id = "user-1"
    user.email = "shop@example.com"
    user.phone = "+254700000001"
    user.name = "Amina"
    user.is_activated = True
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


def test_phone_otp_rejected_when_not_debug() -> None:
    service = MerchantLoginOtpService(MagicMock())
    with patch(
        "app.services.merchant_login_otp.phone_otp_allowed",
        return_value=False,
    ):
        with pytest.raises(MerchantOtpError, match=PHONE_OTP_UNAVAILABLE):
            service.request_login_code(identifier="0700000001")


@patch("app.services.merchant_login_otp.allow_otp_echo", return_value=False)
@patch(
    "app.services.merchant_login_otp_email.send_merchant_login_otp_email",
    return_value=False,
)
def test_email_send_failure_raises_when_not_debug(_send, _echo) -> None:
    db = MagicMock()
    service = MerchantLoginOtpService(db)
    service._find_user = MagicMock(return_value=_user())  # type: ignore[method-assign]
    service._issue_code = MagicMock(return_value=("123456", MagicMock()))  # type: ignore[method-assign]
    with pytest.raises(MerchantOtpError, match=MAIL_SEND_FAILED):
        service.request_login_code(identifier="shop@example.com")


@patch("app.services.merchant_login_otp.allow_otp_echo", return_value=True)
@patch(
    "app.services.merchant_login_otp_email.send_merchant_login_otp_email",
    return_value=False,
)
def test_email_send_failure_echoes_code_in_debug(_send, _echo) -> None:
    db = MagicMock()
    service = MerchantLoginOtpService(db)
    service._find_user = MagicMock(return_value=_user())  # type: ignore[method-assign]
    service._issue_code = MagicMock(return_value=("123456", MagicMock()))  # type: ignore[method-assign]
    result = service.request_login_code(identifier="shop@example.com")
    assert result["login_code"] == "123456"


@patch("app.services.merchant_login_otp.sms_configured", return_value=False)
@patch("app.services.merchant_login_otp.phone_otp_allowed", return_value=True)
def test_phone_otp_echoes_code_in_debug(_phone_ok, _sms) -> None:
    db = MagicMock()
    service = MerchantLoginOtpService(db)
    service._find_user = MagicMock(return_value=_user())  # type: ignore[method-assign]
    service._issue_code = MagicMock(return_value=("654321", MagicMock()))  # type: ignore[method-assign]
    result = service.request_login_code(identifier="0700000001")
    assert result["login_code"] == "654321"
    assert result["code_sent"] is False


@patch("app.services.merchant_login_otp.sms_configured", return_value=True)
@patch("app.services.merchant_login_otp.phone_otp_allowed", return_value=True)
@patch("app.services.login_otp_sms.send_login_otp_sms", return_value=True)
def test_phone_otp_sends_sms_without_echoing_code(_send, _phone_ok, _sms) -> None:
    db = MagicMock()
    service = MerchantLoginOtpService(db)
    service._find_user = MagicMock(return_value=_user())  # type: ignore[method-assign]
    row = MagicMock()
    service._issue_code = MagicMock(return_value=("654321", row))  # type: ignore[method-assign]
    with patch("app.services.merchant_login_otp.allow_otp_echo", return_value=False):
        result = service.request_login_code(identifier="0700000001")
    assert result["login_code"] is None
    assert result["code_sent"] is True
    assert row.delivery_status == "delivered"
    _send.assert_called_once()


@patch("app.services.merchant_login_otp.sms_configured", return_value=True)
@patch("app.services.merchant_login_otp.phone_otp_allowed", return_value=True)
@patch("app.services.login_otp_sms.send_login_otp_sms", return_value=False)
@patch("app.services.merchant_login_otp.allow_otp_echo", return_value=False)
def test_phone_otp_sms_failure_raises_when_not_debug(_echo, _send, _phone_ok, _sms) -> None:
    from app.support.otp_delivery import SMS_SEND_FAILED

    db = MagicMock()
    service = MerchantLoginOtpService(db)
    service._find_user = MagicMock(return_value=_user())  # type: ignore[method-assign]
    service._issue_code = MagicMock(return_value=("654321", MagicMock()))  # type: ignore[method-assign]
    with pytest.raises(MerchantOtpError, match=SMS_SEND_FAILED):
        service.request_login_code(identifier="0700000001")


def test_find_user_by_phone_does_not_scan_all_rows() -> None:
    db = MagicMock()
    filtered = db.query.return_value.filter.return_value
    filtered.first.return_value = None
    MerchantLoginOtpService(db)._find_user(phone="0712345678")
    filtered.all.assert_not_called()
    db.query.return_value.filter.assert_called()
    filtered.first.assert_called()
