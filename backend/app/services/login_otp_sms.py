"""SMS delivery for merchant and rider login / verification codes."""

from __future__ import annotations

import logging

from app.services.africastalking_service import AfricasTalkingSmsService

logger = logging.getLogger(__name__)


def format_login_otp_sms(*, code: str, expires_in_seconds: int, kind: str) -> str:
    minutes = max(1, int(expires_in_seconds) // 60)
    if kind == "rider":
        label = "rider login code"
    elif kind == "signup":
        label = "verification code"
    else:
        label = "login code"
    return (
        f"DukAI {label}: {code}. Expires in {minutes} min. Do not share this code."
    )


def send_login_otp_sms(
    *,
    to_phone: str,
    code: str,
    expires_in_seconds: int,
    kind: str = "login",
) -> bool:
    phone = (to_phone or "").strip()
    if not phone or not (code or "").strip():
        return False

    service = AfricasTalkingSmsService()
    if not service.configured:
        logger.warning("Login OTP SMS skipped — Africa's Talking is not configured.")
        return False

    result = service.send_text(
        to=phone,
        text=format_login_otp_sms(
            code=code,
            expires_in_seconds=expires_in_seconds,
            kind=kind,
        ),
    )
    if not result.ok:
        logger.warning("Login OTP SMS failed (to=%s): %s", phone, result.error)
        return False
    return True
