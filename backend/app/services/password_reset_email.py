"""Self-serve password reset emails for merchant dashboard users."""

from __future__ import annotations

import logging

from app.core.password_reset_tokens import PASSWORD_RESET_TOKEN_MAX_AGE
from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email

logger = logging.getLogger(__name__)

RESET_EMAIL_FROM_ADDRESS = "no-reply@dukai.app"
RESET_EMAIL_FROM_NAME = "DUKAI MERCHANT"


def _expiry_label() -> str:
    hours = max(1, PASSWORD_RESET_TOKEN_MAX_AGE // 3600)
    if hours >= 24:
        days = hours // 24
        return "1 day" if days == 1 else f"{days} days"
    return "1 hour" if hours == 1 else f"{hours} hours"


def send_password_reset_email(
    *,
    to_email: str,
    user_name: str,
    reset_link: str,
) -> bool:
    """Email a signed reset link. Returns True if Mailtrap accepted it."""
    recipient = (to_email or "").strip().lower()
    if not recipient:
        return False

    service = EmailService()
    if not service.settings.mail_enabled or not service.configured:
        logger.warning("Password reset email skipped — mail not configured.")
        return False

    first_name = (
        (user_name or "").strip().split()[0] if (user_name or "").strip() else "there"
    )
    expiry = _expiry_label()

    html = render_branded_email(
        title="Reset your DukAI password",
        heading="Reset your DukAI password",
        intro=f"Hi {first_name}, we received a request to reset the password for this account.",
        paragraphs=[
            "Use the button below to choose a new password. "
            f"This link expires in {expiry}.",
            "If you did not request a reset, you can ignore this email. "
            "Your password will stay the same.",
        ],
        details=[
            ("Account email", recipient),
        ],
        cta_label="Reset your password",
        cta_url=reset_link,
        footer_note="Only use this link on the DukAI Merchants site.",
    )
    return service.send_email(
        to=recipient,
        to_name=user_name,
        subject="Reset your DukAI password",
        text=(
            f"Hi {first_name},\n\n"
            "We received a request to reset the password for your DukAI account.\n\n"
            f"Reset your password here: {reset_link}\n\n"
            f"This link expires in {expiry}.\n"
            "If you did not request this, you can ignore the email."
        ),
        html=html,
        category="password-reset",
        from_address=RESET_EMAIL_FROM_ADDRESS,
        from_name=RESET_EMAIL_FROM_NAME,
    )
