"""Invite and access-notification emails for merchant team members."""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.password_reset_tokens import mint_password_reset_token
from app.core.security import hash_password
from app.models import Account, User
from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email

INVITE_EMAIL_FROM_ADDRESS = "no-reply@dukai.app"
INVITE_EMAIL_FROM_NAME = "DUKAI PLATFORM"

_TEMP_PASSWORD_ALPHABET = (
    "".join(c for c in string.ascii_uppercase if c not in "OI")
    + "".join(c for c in string.ascii_lowercase if c not in "l")
    + "".join(c for c in string.digits if c not in "01")
)


def generate_temp_password(length: int = 12) -> str:
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))


def _require_mail_service() -> EmailService:
    service = EmailService()
    if not service.settings.mail_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email sending is disabled.",
        )
    if not service.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail provider is not configured.",
        )
    return service


def send_merchant_access_granted_email(
    db: Session,
    user: User,
    account: Account,
) -> None:
    """Notify an existing user they were added to another merchant."""
    if not user.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This user has no email address on file.",
        )

    service = _require_mail_service()
    frontend_url = get_settings().frontend_url.rstrip("/")
    login_url = f"{frontend_url}/sign-in"
    business_name = account.business_name or "a shop"

    html = render_branded_email(
        title="New shop access on DukAI",
        heading=f"You now have access to {business_name}",
        intro=(
            "You were added to another shop dashboard on DukAI. "
            "Sign in with your existing email and password, then switch stores "
            "from the Store menu in the top bar."
        ),
        details=[
            ("Shop", business_name),
            ("Account email", user.email),
        ],
        cta_label="Sign in to DukAI",
        cta_url=login_url,
        footer_note="If you weren't expecting this, contact your shop administrator.",
    )
    sent = service.send_email(
        to=user.email,
        to_name=user.name,
        subject=f"You now have access to {business_name} on DukAI",
        text=(
            f"Hi {user.name},\n\n"
            f"You now have access to {business_name} on DukAI.\n\n"
            f"Sign in with your existing password: {login_url}\n\n"
            "After signing in, use the Store menu in the top bar to switch shops."
        ),
        html=html,
        category="merchant-access",
        from_address=INVITE_EMAIL_FROM_ADDRESS,
        from_name=INVITE_EMAIL_FROM_NAME,
    )
    if not sent:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the access notification email.",
        )


def send_merchant_user_invite_email(db: Session, user: User) -> None:
    """Email a temporary password and reset link to a brand-new merchant user."""
    if not user.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This user has no email address on file.",
        )

    service = _require_mail_service()
    temp_password = generate_temp_password()
    user.password = hash_password(temp_password)
    user.require_change_password = True
    user.updated_at = datetime.now(timezone.utc)

    token = mint_password_reset_token(user.id, user.password)
    frontend_url = get_settings().frontend_url.rstrip("/")
    reset_link = f"{frontend_url}/reset-password?token={token}"

    html = render_branded_email(
        title="Reset your DukAI password",
        heading="Set a new password for your DukAI account",
        intro=(
            "You were invited to a shop dashboard on DukAI. "
            "Use the button below to choose your own password."
        ),
        paragraphs=[
            "For your security, set a new password right away. "
            "This link expires in 3 days.",
        ],
        details=[
            ("Temporary password", temp_password),
            ("Account email", user.email),
        ],
        cta_label="Set your password",
        cta_url=reset_link,
        footer_note="If you weren't expecting this, contact your shop administrator.",
    )
    sent = service.send_email(
        to=user.email,
        to_name=user.name,
        subject="You're invited to DukAI",
        text=(
            f"Hi {user.name},\n\n"
            "You were invited to a shop dashboard on DukAI.\n\n"
            f"Temporary password: {temp_password}\n\n"
            f"Set your own password here: {reset_link}\n\n"
            "This link expires in 3 days."
        ),
        html=html,
        category="password-reset",
        from_address=INVITE_EMAIL_FROM_ADDRESS,
        from_name=INVITE_EMAIL_FROM_NAME,
    )
    if not sent:
        db.rollback()
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the invite email. No password was changed.",
        )

    db.add(user)
    db.commit()
    db.refresh(user)
