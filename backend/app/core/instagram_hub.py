"""Instagram OAuth hub client (merchants / service).

The hub at dukai.app starts Meta login and forwards the authorization code
back here. This app exchanges the code and stores tokens. Meta never hits
this origin for OAuth or webhook verification — the hub does.
"""

from __future__ import annotations

import hmac
import secrets
from urllib.parse import urlencode

from app.config import Settings

OAUTH_STATE_COOKIE = "instagram_oauth_state"
OAUTH_STATE_SESSION_KEY = "instagram_oauth_state"
OAUTH_STATE_MAX_AGE = 600


def new_oauth_state() -> str:
    return secrets.token_urlsafe(16)


def states_match(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    a = left.encode("utf-8")
    b = right.encode("utf-8")
    if len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


def hub_connect_url(
    settings: Settings,
    state: str,
    *,
    origin: str | None = None,
) -> str:
    """https://dukai.app/instagram?platform=merchant&state=...&return_to=..."""
    hub = (settings.instagram_hub_url or "https://dukai.app").rstrip("/")
    platform = (settings.dukai_platform or "merchant").strip() or "merchant"
    params = {"platform": platform, "state": state}
    if origin:
        params["return_to"] = f"{origin.rstrip('/')}/instagram/callback"
    return f"{hub}/instagram?{urlencode(params)}"


def public_https_origin(*candidates: str | None) -> str | None:
    for candidate in candidates:
        value = (candidate or "").strip().rstrip("/")
        if value.startswith("https://"):
            return value
    return None


def state_cookie(*, value: str, secure: bool) -> dict[str, str | int | bool]:
    return {
        "key": OAUTH_STATE_COOKIE,
        "value": value,
        "max_age": OAUTH_STATE_MAX_AGE,
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "path": "/",
    }
