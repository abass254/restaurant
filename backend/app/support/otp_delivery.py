"""Shared OTP delivery policy for merchant and rider login codes."""

from __future__ import annotations

from typing import Any

from app.config import get_settings

PHONE_OTP_UNAVAILABLE = "Phone login is not available. Use your email address."
MAIL_SEND_FAILED = "Could not send the login code. Try again shortly."


def allow_otp_echo() -> bool:
    """Plaintext codes may appear in API JSON only while APP_DEBUG is on."""
    return bool(get_settings().app_debug)


def phone_otp_allowed() -> bool:
    """Phone OTP has no SMS provider; local debug may echo the code instead."""
    return allow_otp_echo()


def echoed_login_code(code: str) -> str | None:
    return code if allow_otp_echo() else None


def with_optional_login_code(payload: dict[str, Any], code: str | None) -> dict[str, Any]:
    payload["login_code"] = echoed_login_code(code) if code else None
    return payload
