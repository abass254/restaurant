from __future__ import annotations

import secrets
from typing import Any

from itsdangerous import BadSignature, BadTimeSignature, URLSafeTimedSerializer

from app.config import Settings

OAUTH_STATE_SALT = "TransChap-instagram-oauth-state"
OAUTH_STATE_MAX_AGE = 600


def _oauth_signing_key(settings: Settings) -> str:
    """
    Secret for signing OAuth state.

    Uses the Meta app secret so a leftover signed state from before the
    hub cutover can still be verified on callback.
    """
    for candidate in (
        settings.instagram_app_secret,
        settings.meta_app_secret,
        settings.session_secret,
    ):
        value = candidate.strip() if isinstance(candidate, str) else ""
        if value:
            return value
    return "change-me-in-production"


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_oauth_signing_key(settings), salt=OAUTH_STATE_SALT)


def create_oauth_state(settings: Settings, *, user_id: str, return_origin: str) -> str:
    origin = settings.validate_oauth_return_origin(return_origin)
    payload = {
        "nonce": secrets.token_urlsafe(16),
        "user_id": str(user_id),
        "return_origin": origin,
    }
    return _serializer(settings).dumps(payload)


def parse_oauth_state(settings: Settings, state: str) -> dict[str, Any]:
    try:
        data = _serializer(settings).loads(state, max_age=OAUTH_STATE_MAX_AGE)
    except (BadSignature, BadTimeSignature) as exc:
        raise RuntimeError(
            "OAuth state mismatch or expired. Please try logging in again.",
        ) from exc

    if not isinstance(data, dict):
        raise RuntimeError("OAuth state mismatch. Please try logging in again.")

    user_id = data.get("user_id")
    return_origin = data.get("return_origin")
    if not user_id or not return_origin:
        raise RuntimeError("OAuth state mismatch. Please try logging in again.")

    settings.validate_oauth_return_origin(str(return_origin))
    return data


def try_parse_return_origin(settings: Settings, state: str | None) -> str | None:
    if not state:
        return None
    try:
        return str(parse_oauth_state(settings, state)["return_origin"])
    except RuntimeError:
        return None
