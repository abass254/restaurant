"""Short-lived signed tokens for the unauthenticated customer storefront.

Background
----------
When an Instagram customer wants to browse and order, the sales autopilot
mints a token and DMs them a link ``<frontend>/shop/<token>``. The phone
opens a public catalogue page (no merchant session cookies) and posts a
checkout to a token-authed endpoint.

The token is an ``itsdangerous`` signed payload — the same mechanism the
session cookie and mobile-upload links already use:

* No new DB table or migration for the signature itself.
* Tamper-proof (HMAC under the session secret).
* Time-limited (short max-age so a leaked link goes stale fast).
* Carries the conversation id plus a per-mint nonce (``jti``).

Single-use semantics
---------------------
The signature alone is replayable until it expires. To make a link
single-use (and to invalidate older links when a fresh one is minted) we
stamp a random ``jti`` into the token and store the *current* jti on the
conversation's ``sales_session``. The checkout endpoint only accepts a token
whose ``jti`` still matches the conversation, then clears it — so the link
dies the moment an order is placed, and re-minting rotates the jti.
"""

from __future__ import annotations

import secrets
from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

# Token lifetime in seconds. Long enough to browse a catalogue and check out,
# short enough that a shared/leaked link won't be useful for long.
STOREFRONT_TOKEN_MAX_AGE = 45 * 60


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-storefront-token",
    )


def new_jti() -> str:
    """A fresh per-mint nonce used to enforce single-use / invalidation."""
    return secrets.token_urlsafe(16)


def mint_storefront_token(conversation_id: str, jti: str) -> str:
    """Create a signed token scoped to ``conversation_id`` with nonce ``jti``."""
    settings = get_settings()
    payload: dict[str, Any] = {"cid": str(conversation_id), "jti": str(jti)}
    return _serializer(settings).dumps(payload)


class StorefrontTokenInvalid(Exception):
    """Raised when a token is unparseable, expired, or malformed."""


def read_storefront_token(token: str) -> dict[str, Any]:
    """Validate a token's signature + age and return its payload.

    Raises ``StorefrontTokenInvalid`` if the signature is bad, expired, or
    the payload is malformed. Single-use (jti) checking is the caller's job,
    since it needs the conversation row.
    """
    settings = get_settings()
    try:
        data = _serializer(settings).loads(token, max_age=STOREFRONT_TOKEN_MAX_AGE)
    except SignatureExpired as exc:
        raise StorefrontTokenInvalid("Storefront link has expired.") from exc
    except BadSignature as exc:
        raise StorefrontTokenInvalid("Storefront link is invalid.") from exc
    if not isinstance(data, dict) or "cid" not in data or "jti" not in data:
        raise StorefrontTokenInvalid("Storefront link is malformed.")
    return data
