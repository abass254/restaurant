"""Email delivery for rider login OTP codes."""

from __future__ import annotations

import logging

from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email

logger = logging.getLogger(__name__)

OTP_EMAIL_FROM_ADDRESS = "no-reply@dukai.app"
OTP_EMAIL_FROM_NAME = "DUKAI PLATFORM"


def send_rider_login_otp_email(
    *,
    to_email: str,
    rider_name: str,
    merchant_name: str,
    code: str,
    expires_in_seconds: int,
) -> bool:
    """Send a one-time login code to the rider. Returns True if accepted by mail API."""
    recipient = (to_email or "").strip().lower()
    if not recipient:
        return False

    service = EmailService()
    if not service.settings.mail_enabled or not service.configured:
        logger.warning("Rider login OTP email skipped — mail not configured.")
        return False

    shop = (merchant_name or "").strip() or "your shop"
    first_name = (
        (rider_name or "").strip().split()[0] if (rider_name or "").strip() else "there"
    )
    minutes = max(1, expires_in_seconds // 60)

    html = render_branded_email(
        title="Your DukAI Rider login code",
        heading="Sign in to DukAI Rider",
        intro=(
            f"Hi {first_name}, use this one-time code to sign in to the rider app "
            f"for {shop}."
        ),
        paragraphs=[
            f"Your login code is {code}.",
            f"It expires in about {minutes} minutes. If you did not request this, ignore the email.",
        ],
        details=[
            ("Shop", shop),
            ("Login code", code),
        ],
        footer_note="Only enter this code in the DukAI Rider app.",
    )
    return service.send_email(
        to=recipient,
        to_name=rider_name,
        subject=f"Your DukAI Rider code: {code}",
        text=(
            f"Hi {first_name},\n\n"
            f"Your DukAI Rider login code for {shop} is: {code}\n\n"
            f"It expires in about {minutes} minutes.\n"
            "If you did not request this, you can ignore the email."
        ),
        html=html,
        category="rider-login-otp",
        from_address=OTP_EMAIL_FROM_ADDRESS,
        from_name=OTP_EMAIL_FROM_NAME,
    )
