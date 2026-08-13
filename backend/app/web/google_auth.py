"""Google Sign-In for merchant signup / login."""

from __future__ import annotations

import logging
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import joinedload

from app.config import get_settings
from app.core.session import login_user, save_session
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import User, UserMembership
from app.services.registration import BusinessRegistrationService
from app.support.merchant_permissions import get_memberships

logger = logging.getLogger(__name__)

router = APIRouter(tags=["google-auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _frontend_url(path: str = "", *, error: str | None = None) -> str:
    settings = get_settings()
    url = f"{settings.frontend_url.rstrip('/')}{path}"
    if error:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}error={quote(error)}"
    return url


def _google_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.google_oauth_client_id.strip()
        and settings.google_oauth_client_secret.strip()
        and settings.google_oauth_redirect_uri.strip()
    )


def _safe_next(path: str | None) -> str:
    if path and path.startswith("/") and not path.startswith("//"):
        return path
    return "/onboarding"


@router.get("/auth/google")
def google_redirect(
    request: Request,
    next: str | None = Query(default=None),
    session: dict = Depends(get_request_session),
):
    if not _google_configured():
        return RedirectResponse(
            _frontend_url("/signup", error="Google Sign-In is not configured yet."),
            status_code=302,
        )

    settings = get_settings()
    next_path = _safe_next(next)
    # Stash next path in session for the callback.
    session["google_oauth_next"] = next_path

    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": next_path,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)


@router.get("/auth/google/callback")
def google_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    next_path = _safe_next(state or session.pop("google_oauth_next", None))

    if error:
        return RedirectResponse(
            _frontend_url("/signup", error=f"Google Sign-In cancelled ({error})."),
            status_code=302,
        )
    if not code or not _google_configured():
        return RedirectResponse(
            _frontend_url("/signup", error="Google Sign-In failed. Please try again."),
            status_code=302,
        )

    settings = get_settings()
    try:
        with httpx.Client(timeout=20.0) as client:
            token_res = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_oauth_client_id,
                    "client_secret": settings.google_oauth_client_secret,
                    "redirect_uri": settings.google_oauth_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_res.raise_for_status()
            access_token = token_res.json().get("access_token")
            if not access_token:
                raise RuntimeError("No access token from Google.")

            info_res = client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            info_res.raise_for_status()
            info = info_res.json()
    except Exception:
        logger.exception("Google OAuth token/userinfo exchange failed")
        return RedirectResponse(
            _frontend_url("/signup", error="Could not complete Google Sign-In."),
            status_code=302,
        )

    google_id = str(info.get("sub") or "").strip()
    email = str(info.get("email") or "").strip().lower()
    name = str(info.get("name") or "").strip()
    email_verified = bool(info.get("email_verified"))
    if not google_id or not email:
        return RedirectResponse(
            _frontend_url(
                "/signup",
                error="Google did not return an email address for this account.",
            ),
            status_code=302,
        )

    user = BusinessRegistrationService(services.db).upsert_google_user(
        google_id=google_id,
        email=email,
        name=name,
        email_verified=email_verified,
    )
    user = (
        services.db.query(User)
        .options(
            joinedload(User.account),
            joinedload(User.instagram_account),
            joinedload(User.memberships).joinedload(UserMembership.account),
        )
        .filter(User.id == user.id)
        .first()
    )

    memberships = get_memberships(user)
    active_account_id = str(memberships[0].account_id) if memberships else None
    login_user(session, user.id, active_account_id=active_account_id)

    response = RedirectResponse(
        _frontend_url(next_path if active_account_id else "/onboarding"),
        status_code=302,
    )
    cookie = save_session(request, session)
    response.set_cookie(**cookie)
    return response
