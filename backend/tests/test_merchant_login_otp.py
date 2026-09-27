"""Merchant OTP delivery must not leak codes outside debug."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import User, UserLoginCode
from app.services.merchant_login_otp import (
    MerchantLoginOtpService,
    MerchantOtpError,
    hash_login_code,
)
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


def test_issue_code_does_not_query_after_commit() -> None:
    db = MagicMock()
    user = _user()

    def commit_then_reject_refresh() -> None:
        db.refresh.side_effect = AssertionError("refresh after commit")

    db.commit.side_effect = commit_then_reject_refresh
    code, row = MerchantLoginOtpService(db)._issue_code(
        user,
        channel="email",
        purpose="login",
    )

    assert len(code) == 6
    assert row.user_id == user.id
    db.refresh.assert_not_called()


def test_verify_code_does_not_query_after_commit() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    now = datetime.now(timezone.utc)
    user = User(
        id="user-1",
        email="shop@example.com",
        name="Amina",
        is_activated=True,
    )
    db.add(user)
    db.add(
        UserLoginCode(
            user_id=user.id,
            code_hash=hash_login_code("123456"),
            channel="email",
            purpose="login",
            expires_at=now + timedelta(minutes=10),
        )
    )
    db.commit()

    original_commit = db.commit

    def commit_then_reject_queries() -> None:
        original_commit()
        db.execute = MagicMock(side_effect=AssertionError("query after commit"))  # type: ignore[method-assign]

    with patch.object(db, "commit", side_effect=commit_then_reject_queries):
        result = MerchantLoginOtpService(db).verify_login_code(
            identifier="shop@example.com",
            code="123456",
        )

    assert result is user
    db.close()


def test_find_user_by_phone_does_not_scan_all_rows() -> None:
    db = MagicMock()
    filtered = db.query.return_value.filter.return_value
    filtered.first.return_value = None
    MerchantLoginOtpService(db)._find_user(phone="0712345678")
    filtered.all.assert_not_called()
    db.query.return_value.filter.assert_called()
    filtered.first.assert_called()
