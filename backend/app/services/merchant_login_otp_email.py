"""Email delivery for merchant dashboard OTP login codes."""

from __future__ import annotations

import logging

from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email

logger = logging.getLogger(__name__)

OTP_EMAIL_FROM_ADDRESS = "no-reply@transchap.app"
OTP_EMAIL_FROM_NAME = "TRANSCHAP MERCHANT"


def send_merchant_login_otp_email(
    *,
    to_email: str,
    user_name: str,
    code: str,
    expires_in_seconds: int,
) -> bool:
    recipient = (to_email or "").strip().lower()
    if not recipient:
        return False

    service = EmailService()
    if not service.settings.mail_enabled or not service.configured:
        logger.warning("Merchant login OTP email skipped — mail not configured.")
        return False

    first_name = (
        (user_name or "").strip().split()[0] if (user_name or "").strip() else "there"
    )
    minutes = max(1, expires_in_seconds // 60)

    html = render_branded_email(
        title="Your TransChap login code",
        heading="Sign in to TransChap Merchants",
        intro=f"Hi {first_name}, use this one-time code to sign in to your dashboard.",
        paragraphs=[
            f"Your login code is {code}.",
            f"It expires in about {minutes} minutes. If you did not request this, ignore the email.",
        ],
        details=[
            ("Login code", code),
        ],
        footer_note="Only enter this code on the TransChap Merchants sign-in page.",
    )
    return service.send_email(
        to=recipient,
        to_name=user_name,
        subject=f"Your TransChap login code: {code}",
        text=(
            f"Hi {first_name},\n\n"
            f"Your TransChap Merchants login code is: {code}\n\n"
            f"It expires in about {minutes} minutes.\n"
            "If you did not request this, you can ignore the email."
        ),
        html=html,
        category="merchant-login-otp",
        from_address=OTP_EMAIL_FROM_ADDRESS,
        from_name=OTP_EMAIL_FROM_NAME,
    )
