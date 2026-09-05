"""Short-lived signed tokens for password resets.

Used by both self-serve forgot-password and admin/staff-initiated reset emails.
We mint a signed ``itsdangerous`` token and email a
``<frontend>/reset-password?token=<token>`` URL. The recipient opens a public
page and chooses their own password.

Single-use semantics
---------------------
No new DB table is needed. The token carries the user id plus a *fingerprint*
of the password hash that was active when the link was minted. The reset
endpoint only accepts a token whose fingerprint still matches the user's
current password — so the moment the user resets (the hash changes) the link
dies. Admin flows that set a temporary password also invalidate older links.
"""

from __future__ import annotations

import hashlib
from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

# How long a reset link stays valid. Long enough for the recipient to find the
# email and act, short enough that a leaked/forgotten link goes stale.
PASSWORD_RESET_TOKEN_MAX_AGE = 60 * 60 * 24 * 3  # 3 days


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="dukai-password-reset",
    )


def password_fingerprint(password_hash: str | None) -> str:
    """A short, irreversible fingerprint of the stored password hash.

    Binds a token to the password that was set when it was minted so the link
    becomes single-use once the password changes.
    """
    digest = hashlib.sha256((password_hash or "").encode("utf-8")).hexdigest()
    return digest[:16]


def mint_password_reset_token(user_id: str, password_hash: str | None) -> str:
    """Create a signed token scoped to ``user_id`` and its current password."""
    settings = get_settings()
    payload: dict[str, Any] = {
        "uid": str(user_id),
        "fp": password_fingerprint(password_hash),
    }
    return _serializer(settings).dumps(payload)


class PasswordResetTokenInvalid(Exception):
    """Raised when a token is unparseable, expired, or malformed."""


def read_password_reset_token(token: str) -> dict[str, Any]:
    """Validate a token's signature + age and return its payload.

    Raises :class:`PasswordResetTokenInvalid` if the signature is bad, expired,
    or the payload is malformed. Fingerprint (single-use) checking is the
    caller's job since it needs the current user row.
    """
    settings = get_settings()
    try:
        data = _serializer(settings).loads(
            token,
            max_age=PASSWORD_RESET_TOKEN_MAX_AGE,
        )
    except SignatureExpired as exc:
        raise PasswordResetTokenInvalid(
            "This password reset link has expired."
        ) from exc
    except BadSignature as exc:
        raise PasswordResetTokenInvalid(
            "This password reset link is invalid."
        ) from exc
    if not isinstance(data, dict) or "uid" not in data or "fp" not in data:
        raise PasswordResetTokenInvalid("This password reset link is malformed.")
    return data
