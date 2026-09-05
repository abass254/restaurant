"""Self-serve forgot-password requests for merchant dashboard users."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.password_reset_tokens import mint_password_reset_token
from app.models import User
from app.services.password_reset_email import send_password_reset_email

logger = logging.getLogger(__name__)

GENERIC_MESSAGE = (
    "If an account exists for that email, we've sent a password reset link. "
    "Check your inbox and spam folder."
)


def request_password_reset(db: Session, email: str) -> dict[str, Any]:
    """Mint and email a reset link when the address matches an active merchant.

    Always returns the same public message so the endpoint cannot be used to
    probe which emails are registered. The current password is left unchanged
    until the user completes the public reset page.
    """
    result: dict[str, Any] = {
        "message": GENERIC_MESSAGE,
        "reset_link": None,
    }

    clean = (email or "").strip().lower()
    if not clean or "@" not in clean:
        return result

    user = (
        db.query(User)
        .filter(func.lower(User.email) == clean)
        .first()
    )
    if (
        user is None
        or not user.email
        or not user.is_activated
        or user.is_super_admin()
    ):
        return result

    token = mint_password_reset_token(user.id, user.password)
    frontend_url = get_settings().frontend_url.rstrip("/")
    reset_link = f"{frontend_url}/reset-password?token={token}"

    sent = send_password_reset_email(
        to_email=user.email,
        user_name=user.name,
        reset_link=reset_link,
    )
    if sent:
        logger.info("Password reset email sent to %s", user.email)
        return result

    logger.warning("Password reset email was not delivered for %s", user.email)
    if get_settings().app_debug:
        result["reset_link"] = reset_link
    return result
