from __future__ import annotations

import secrets
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, Request, status
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session, joinedload

from app.config import Settings, get_settings
from app.models import User, UserMembership
from app.support.merchant_permissions import active_account_id, get_active_membership
from app.services.platform_instagram import (
    get_merchant_instagram_account,
    require_merchant_account_id,
)

SESSION_USER_KEY = "user_id"
SESSION_RIDER_KEY = "rider_id"
SESSION_CSRF_KEY = "csrf_token"
SESSION_ACTIVE_ACCOUNT_KEY = "active_account_id"


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="dukai-session",
    )


def get_bearer_token(request: Request) -> str | None:
    """Return raw Bearer token from Authorization header, if present."""
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def request_uses_bearer_auth(request: Request) -> bool:
    return get_bearer_token(request) is not None


def decode_session_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        data = _serializer(settings).loads(token, max_age=settings.session_max_age)
    except BadSignature:
        return {}
    return data if isinstance(data, dict) else {}


def encode_session_token(session: dict[str, Any]) -> str:
    settings = get_settings()
    return str(_serializer(settings).dumps(session))


def get_session(request: Request) -> dict[str, Any]:
    settings = get_settings()
    bearer = get_bearer_token(request)
    if bearer:
        return decode_session_token(bearer)
    cookie = request.cookies.get(settings.session_cookie_name)
    if not cookie:
        return {}
    return decode_session_token(cookie)


def _cookie_secure(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    forwarded = request.headers.get("x-forwarded-proto", "")
    if forwarded.split(",")[0].strip().lower() == "https":
        return True
    settings = get_settings()
    if settings.frontend_url.startswith("https://"):
        return True
    return settings.app_env != "local"


def save_session(request: Request, session: dict[str, Any]) -> dict[str, str]:
    settings = get_settings()
    token = encode_session_token(session)
    return {
        "key": settings.session_cookie_name,
        "value": token,
        "max_age": settings.session_max_age,
        "httponly": True,
        "samesite": "lax",
        "secure": _cookie_secure(request),
    }


def ensure_csrf_token(session: dict[str, Any]) -> str:
    token = session.get(SESSION_CSRF_KEY)
    if not token:
        token = secrets.token_urlsafe(40)
        session[SESSION_CSRF_KEY] = token
    return str(token)


def xsrf_cookie_value(token: str) -> str:
    return quote(token, safe="")


def is_rider_mobile_client(request: Request) -> bool:
    """Expo / native rider clients send this header instead of cookie CSRF."""
    value = (request.headers.get("X-Rider-Client") or "").strip().lower()
    return value in {"expo", "rider-app", "mobile"}


def validate_csrf(request: Request, session: dict[str, Any]) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return

    # Bearer sessions are not cookie-CSRF vulnerable; mobile login bootstraps without cookies.
    if request_uses_bearer_auth(request) or is_rider_mobile_client(request):
        return

    expected = session.get(SESSION_CSRF_KEY)
    if not expected:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="CSRF token mismatch.")

    header = request.headers.get("X-XSRF-TOKEN") or request.headers.get("X-CSRF-TOKEN")
    if not header or header != expected:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="CSRF token mismatch.")


def login_user(
    session: dict[str, Any],
    user_id: str,
    *,
    active_account_id: str | None = None,
) -> None:
    session[SESSION_USER_KEY] = user_id
    if active_account_id:
        session[SESSION_ACTIVE_ACCOUNT_KEY] = str(active_account_id)
    else:
        session.pop(SESSION_ACTIVE_ACCOUNT_KEY, None)
    session.pop(SESSION_RIDER_KEY, None)
    ensure_csrf_token(session)


def login_rider(session: dict[str, Any], rider_id: str) -> None:
    session[SESSION_RIDER_KEY] = rider_id
    session.pop(SESSION_USER_KEY, None)
    ensure_csrf_token(session)


def logout_user(session: dict[str, Any]) -> None:
    session.pop(SESSION_USER_KEY, None)
    session.pop(SESSION_ACTIVE_ACCOUNT_KEY, None)
    session.pop(SESSION_RIDER_KEY, None)
    ensure_csrf_token(session)


def get_current_user(db: Session, session: dict[str, Any]) -> User | None:
    user_id = session.get(SESSION_USER_KEY)
    if not user_id:
        return None
    user = (
        db.query(User)
        .options(
            joinedload(User.account),
            joinedload(User.instagram_account),
            joinedload(User.memberships).joinedload(UserMembership.account),
        )
        .filter(User.id == str(user_id))
        .first()
    )
    if user is None:
        return None
    active_account_id = session.get(SESSION_ACTIVE_ACCOUNT_KEY)
    if active_account_id:
        setattr(user, "_active_account_id", str(active_account_id))
    else:
        membership = get_active_membership(user)
        if membership is not None:
            setattr(user, "_active_account_id", str(membership.account_id))
            session[SESSION_ACTIVE_ACCOUNT_KEY] = str(membership.account_id)
    return user


def require_user(db: Session, session: dict[str, Any]) -> User:
    user = get_current_user(db, session)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unauthenticated.")
    return user


def get_active_account_id(session: dict[str, Any]) -> str | None:
    value = session.get(SESSION_ACTIVE_ACCOUNT_KEY)
    return str(value) if value else None


def set_active_account_id(session: dict[str, Any], account_id: str | None) -> None:
    if account_id:
        session[SESSION_ACTIVE_ACCOUNT_KEY] = str(account_id)
    else:
        session.pop(SESSION_ACTIVE_ACCOUNT_KEY, None)


def get_current_rider(db: Session, session: dict[str, Any]):
    from app.models import Rider

    rider_id = session.get(SESSION_RIDER_KEY)
    if not rider_id:
        return None
    return db.get(Rider, str(rider_id))


def require_rider(db: Session, session: dict[str, Any]):
    from app.models import Rider

    rider = get_current_rider(db, session)
    if not rider:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Rider session required.")
    if rider.status != "active":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="This rider account is not active.",
        )
    return rider


def require_instagram_user(db: Session, session: dict[str, Any]) -> User:
    user = require_user(db, session)
    merchant_id = require_merchant_account_id(user)
    if not get_merchant_instagram_account(db, merchant_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "no_channel_connected",
                "message": "Connect your shop's Instagram account in Settings to access messages.",
            },
        )
    return user


def require_onboarded_user(db: Session, session: dict[str, Any]) -> User:
    user = require_instagram_user(db, session)
    account = get_merchant_instagram_account(db, active_account_id(user))
    if not account or not account.is_onboarded():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "channel_not_onboarded",
                "message": "Complete platform Instagram onboarding to access this resource.",
            },
            headers={"X-Redirect": "/onboarding"},
        )
    return user
