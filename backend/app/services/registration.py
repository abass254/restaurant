from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.password_reset_tokens import mint_password_reset_token
from app.core.security import generate_temp_password, hash_password
from app.models import (
    STORE_TYPES,
    Account,
    User,
    UserMembership,
    is_valid_business_category,
)
from app.support.merchant_permissions import (
    get_memberships,
    serialize_allowed_sections,
)
from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email

logger = logging.getLogger(__name__)


class RegistrationEmailError(Exception):
    """The account could not be finalized because the welcome email failed."""


def _require_business_profile(category: str | None, store_type: str | None) -> tuple[str, str]:
    cleaned = (category or "").strip()
    normalized_type = (store_type or "retail").strip().lower()
    if normalized_type not in STORE_TYPES:
        raise ValueError("Choose a valid store type (retail or restaurant).")
    if not is_valid_business_category(cleaned, normalized_type):
        raise ValueError("Choose a valid category for this business type.")
    return cleaned, normalized_type


class BusinessRegistrationService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()

    def _attach_shop(self, user: User, data: dict, now: datetime) -> Account:
        category, store_type = _require_business_profile(
            data.get("business_category"),
            data.get("store_type"),
        )
        account = Account(
            business_name=data["business_name"].strip(),
            business_location=data["business_location"].strip(),
            business_category=category,
            store_type=store_type,
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            created_at=now,
            updated_at=now,
        )
        self.db.add(account)
        self.db.flush()

        self.db.add(
            UserMembership(
                user_id=user.id,
                account_id=account.id,
                role="system_admin",
                allowed_sections=serialize_allowed_sections([]),
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        user.account_id = account.id
        user.user_role = "system_admin"
        if data.get("admin_phone"):
            user.phone = str(data["admin_phone"]).strip() or user.phone
        user.updated_at = now
        return account

    def signup_user(
        self,
        *,
        name: str,
        email: str,
        password: str,
        phone: str | None = None,
        shop: dict | None = None,
    ) -> User:
        """Create a merchant user, optionally with its initial shop."""
        if shop is not None:
            _require_business_profile(
                shop.get("business_category"),
                shop.get("store_type"),
            )
        now = datetime.now(timezone.utc)
        user = User(
            account_id=None,
            name=name.strip(),
            email=email.strip().lower(),
            phone=(phone or "").strip() or None,
            password=hash_password(password),
            user_role=None,
            is_activated=True,
            require_change_password=False,
            email_verified_at=None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(user)
        self.db.flush()
        if shop is not None:
            self._attach_shop(user, shop, now)
        self.db.commit()
        self.db.refresh(user)
        return user

    def upsert_google_user(
        self,
        *,
        google_id: str,
        email: str,
        name: str,
        email_verified: bool = False,
    ) -> User:
        """Find or create a user from Google profile data."""
        now = datetime.now(timezone.utc)
        email_norm = email.strip().lower()
        user = self.db.query(User).filter(User.google_id == google_id).first()
        if user is None and email_norm:
            user = self.db.query(User).filter(User.email == email_norm).first()
            if user is not None:
                user.google_id = google_id
        if user is None:
            user = User(
                account_id=None,
                name=(name or email_norm.split("@")[0] or "Merchant").strip()[:255],
                email=email_norm or None,
                google_id=google_id,
                password=None,
                user_role=None,
                is_activated=True,
                require_change_password=False,
                email_verified_at=now if email_verified else None,
                created_at=now,
                updated_at=now,
            )
            self.db.add(user)
        else:
            if not user.name and name:
                user.name = name.strip()[:255]
            if email_verified and user.email_verified_at is None:
                user.email_verified_at = now
            if not user.is_activated:
                user.is_activated = True
            user.updated_at = now
        self.db.commit()
        self.db.refresh(user)
        return user

    def create_shop_for_user(self, user: User, data: dict) -> dict:
        """Attach a new shop + owner membership to an existing user."""
        if get_memberships(user):
            raise ValueError("You already have a shop on this account.")

        now = datetime.now(timezone.utc)
        account = self._attach_shop(user, data, now)
        self.db.commit()
        self.db.refresh(account)
        self.db.refresh(user)
        return {"account": account, "user": user}

    def register(self, data: dict) -> dict:
        now = datetime.now(timezone.utc)
        temp_password = generate_temp_password()
        category, store_type = _require_business_profile(
            data.get("business_category"),
            data.get("store_type"),
        )

        account = Account(
            business_name=data["business_name"],
            business_location=data["business_location"],
            business_category=category,
            store_type=store_type,
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            created_at=now,
            updated_at=now,
        )
        self.db.add(account)
        self.db.flush()

        user = User(
            account_id=account.id,
            name=data["business_name"],
            email=data["admin_email"],
            phone=data["admin_phone"],
            password=hash_password(temp_password),
            user_role="system_admin",
            is_activated=True,
            require_change_password=True,
            created_at=now,
            updated_at=now,
        )
        self.db.add(user)
        self.db.flush()
        membership = UserMembership(
            user_id=user.id,
            account_id=account.id,
            role="system_admin",
            allowed_sections=serialize_allowed_sections([]),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        self.db.add(membership)
        self.db.flush()


        email_service = EmailService(self.settings)
        email_sent = False
        if email_service.configured:
            email_sent = self._send_welcome_email(user, temp_password)
            if not email_sent:
                if self.settings.app_env == "local":
                    logger.warning(
                        "Welcome email failed for %s in local env. "
                        "Temporary password: %s",
                        user.email,
                        temp_password,
                    )
                else:
                    self.db.rollback()
                    raise RegistrationEmailError(
                        "Mail provider rejected the welcome email."
                    )
        else:
            logger.warning(
                "Welcome email skipped for %s: Mailtrap not configured",
                user.email,
            )

        self.db.commit()
        self.db.refresh(account)
        self.db.refresh(user)
        return {"account": account, "user": user, "email_sent": email_sent}

    def _send_welcome_email(self, user: User, temp_password: str) -> bool:
        login_url = f"{self.settings.frontend_url.rstrip('/')}/onboarding"
        reset_token = mint_password_reset_token(user.id, user.password)
        reset_url = (
            f"{self.settings.frontend_url.rstrip('/')}/reset-password?token={reset_token}"
        )
        business_name = user.name or "there"

        html = render_branded_email(
            title="Welcome to TransChap",
            heading=f"Welcome to TransChap, {business_name}!",
            intro=(
                "Your shop account is ready. Continue setup to connect channels, "
                "payments, and go live."
            ),
            paragraphs=[
                "For your security, set your own password using the button below. "
                "This link expires in 3 days.",
            ],
            details=[
                ("Email", user.email),
                ("Temporary password", temp_password),
            ],
            cta_label="Continue setup",
            cta_url=login_url,
        )
        return EmailService(self.settings).send_email(
            to=user.email,
            to_name=user.name,
            subject="Welcome to TransChap — your account is ready",
            text=(
                f"Hi {business_name},\n\n"
                "Welcome to TransChap! Your shop account is ready.\n\n"
                f"Email: {user.email}\n"
                f"Temporary password: {temp_password}\n\n"
                f"Sign in here: {login_url}\n"
                f"Set your own password here: {reset_url}\n\n"
                "The password setup link expires in 3 days."
            ),
            html=html,
            category="welcome",
            from_address="no-reply@transchap.app",
            from_name=self.settings.mail_from_name or "TRANSCHAP PLATFORM",
        )
