"""Merchant dashboard OTP login (email or phone)."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models import User, UserLoginCode, UserMembership
from app.services.rider_service import normalize_phone

logger = logging.getLogger(__name__)

LOGIN_CODE_TTL_SECONDS = 600
LOGIN_CODE_LENGTH = 4


class MerchantOtpError(ValueError):
    """Business rule violation for merchant OTP login."""


def hash_login_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def hmac_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return f"{email[:2]}***"
    return f"{local[:1]}***@{domain}"


def _mask_phone(phone: str) -> str:
    return f"{'*' * max(0, len(phone) - 4)}{phone[-4:]}"


class MerchantLoginOtpService:
    def __init__(self, db: Session):
        self.db = db

    def _issue_code(self, user: User) -> str:
        code = "".join(secrets.choice("0123456789") for _ in range(LOGIN_CODE_LENGTH))
        now = _utc_now()
        prior = (
            self.db.query(UserLoginCode)
            .filter(
                UserLoginCode.user_id == user.id,
                UserLoginCode.consumed_at.is_(None),
            )
            .all()
        )
        for row in prior:
            row.consumed_at = now

        self.db.add(
            UserLoginCode(
                user_id=user.id,
                code_hash=hash_login_code(code),
                expires_at=now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
                created_at=now,
            )
        )
        self.db.commit()
        return code

    def _find_user(
        self,
        *,
        email: str | None = None,
        phone: str | None = None,
    ) -> User | None:
        clean_email = (email or "").strip().lower()
        clean_phone = normalize_phone(phone or "")

        if clean_email:
            return (
                self.db.query(User)
                .filter(func.lower(User.email) == clean_email)
                .first()
            )

        if not clean_phone:
            return None

        candidates = {clean_phone, clean_phone.lstrip("+")}
        if clean_phone.startswith("+254") and len(clean_phone) >= 13:
            local = clean_phone[4:]
            candidates.add(f"0{local}")
            candidates.add(local)

        users = (
            self.db.query(User)
            .filter(User.phone.is_not(None), User.phone != "")
            .all()
        )
        for user in users:
            stored = normalize_phone(user.phone or "")
            raw = (user.phone or "").strip()
            if stored in candidates or raw in candidates or normalize_phone(raw) == clean_phone:
                return user
        return None

    def request_login_code(
        self,
        *,
        identifier: str,
    ) -> dict[str, Any]:
        raw = (identifier or "").strip()
        if not raw:
            raise MerchantOtpError("Enter your email or phone number to continue.")

        is_email = "@" in raw
        clean_email = raw.lower() if is_email else None
        clean_phone = None if is_email else normalize_phone(raw)
        if not is_email and not clean_phone:
            raise MerchantOtpError("Enter a valid email or phone number.")

        channel = "email" if is_email else "phone"
        generic = {
            "message": (
                "If an account exists, a login code will be sent."
                if channel == "email"
                else "If an account exists, a login code is ready."
            ),
            "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
            "login_code": None,
            "phone_masked": _mask_phone(clean_phone) if clean_phone else None,
            "email_masked": _mask_email(clean_email) if clean_email else None,
            "channel": channel,
            "code_sent": False,
            "identifier": clean_email or clean_phone,
        }

        user = self._find_user(email=clean_email, phone=clean_phone)
        if not user or not user.is_activated:
            return generic

        return self._deliver_code(user, channel=channel, purpose="login")

    def _deliver_code(
        self,
        user: User,
        *,
        channel: str,
        purpose: str,
    ) -> dict[str, Any]:
        code = self._issue_code(user)
        email_masked = _mask_email(user.email) if user.email else None
        phone_masked = _mask_phone(normalize_phone(user.phone or "")) if user.phone else None
        identifier = (
            (user.email or "").strip().lower()
            if channel == "email"
            else normalize_phone(user.phone or "")
        )
        base = {
            "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
            "login_code": None,
            "phone_masked": phone_masked,
            "email_masked": email_masked,
            "channel": channel,
            "code_sent": False,
            "identifier": identifier,
            "has_email": bool(user.email),
            "has_phone": bool((user.phone or "").strip()),
            "purpose": purpose,
        }

        noun = "verification" if purpose == "signup" else "login"

        if channel == "email" and user.email:
            from app.services.merchant_login_otp_email import send_merchant_login_otp_email

            sent = send_merchant_login_otp_email(
                to_email=user.email,
                user_name=user.name,
                code=code,
                expires_in_seconds=LOGIN_CODE_TTL_SECONDS,
            )
            if not sent:
                return {
                    **base,
                    "message": (
                        f"Could not send the email. Use the {noun} code shown below."
                    ),
                    "login_code": code,
                    "code_sent": False,
                }
            return {
                **base,
                "message": (
                    "Verification code sent to your email."
                    if purpose == "signup"
                    else "Login code sent to your email."
                ),
                "code_sent": True,
            }

        # No SMS provider yet — echo code so phone OTP stays usable in local/dev.
        return {
            **base,
            "message": f"{noun.capitalize()} code created. Enter it to continue.",
            "login_code": code,
            "code_sent": False,
        }

    def verify_login_code(
        self,
        *,
        identifier: str,
        code: str,
    ) -> User:
        return self._verify_code(identifier=identifier, code=code, require_activated=True)

    def _verify_code(
        self,
        *,
        identifier: str,
        code: str,
        require_activated: bool,
    ) -> User:
        raw = (identifier or "").strip()
        if not raw:
            raise MerchantOtpError("Email or phone is required.")

        is_email = "@" in raw
        user = self._find_user(
            email=raw.lower() if is_email else None,
            phone=None if is_email else raw,
        )
        if not user:
            raise MerchantOtpError("Invalid login details or code.")
        if require_activated and not user.is_activated:
            raise MerchantOtpError("Invalid login details or code.")
        if not require_activated and user.is_activated:
            raise MerchantOtpError("This account is already verified. Please sign in.")

        raw_code = (code or "").strip()
        if not raw_code or len(raw_code) != LOGIN_CODE_LENGTH:
            raise MerchantOtpError("Enter the 4-digit login code.")

        now = _utc_now()
        rows = (
            self.db.query(UserLoginCode)
            .filter(
                UserLoginCode.user_id == user.id,
                UserLoginCode.consumed_at.is_(None),
            )
            .order_by(UserLoginCode.created_at.desc())
            .all()
        )
        target_hash = hash_login_code(raw_code)
        match = None
        for row in rows:
            exp = _as_aware(row.expires_at)
            if exp and exp < now:
                row.consumed_at = now
                continue
            if hmac_compare(row.code_hash, target_hash):
                match = row
                break

        if not match:
            self.db.commit()
            raise MerchantOtpError("Invalid login details or code.")

        match.consumed_at = now
        user.updated_at = now
        self.db.commit()

        return (
            self.db.query(User)
            .options(
                joinedload(User.account),
                joinedload(User.instagram_account),
                joinedload(User.memberships).joinedload(UserMembership.account),
            )
            .filter(User.id == user.id)
            .first()
        ) or user
