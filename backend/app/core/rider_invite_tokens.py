"""Signed tokens for rider fleet onboarding invites."""

from __future__ import annotations

from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

# Seven days — long enough for a merchant to share a link offline.
RIDER_INVITE_TOKEN_MAX_AGE = 7 * 24 * 60 * 60


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-rider-invite-token",
    )


class RiderInviteTokenInvalid(Exception):
    """Raised when an invite token is bad or expired."""


def mint_rider_invite_token(
    rider_id: str,
    invite_id: str,
    *,
    jti: str,
) -> str:
    settings = get_settings()
    payload: dict[str, Any] = {
        "rid": str(rider_id),
        "iid": str(invite_id),
        "jti": str(jti),
    }
    return _serializer(settings).dumps(payload)


def read_rider_invite_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        data = _serializer(settings).loads(token, max_age=RIDER_INVITE_TOKEN_MAX_AGE)
    except SignatureExpired as exc:
        raise RiderInviteTokenInvalid("Invite link has expired.") from exc
    except BadSignature as exc:
        raise RiderInviteTokenInvalid("Invite link is invalid.") from exc
    if not isinstance(data, dict) or "rid" not in data or "jti" not in data:
        raise RiderInviteTokenInvalid("Invite link is malformed.")
    return data
