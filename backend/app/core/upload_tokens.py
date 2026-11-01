"""Short-lived signed tokens for unauthenticated mobile uploads.

Background
----------
The desktop merchant clicks "Upload from phone" → backend mints a token, the
frontend renders a QR code that encodes ``<frontend>/m/upload/<token>``. The
phone scans it, hits an upload page that doesn't share the merchant's session
cookies, and posts files to a token-authed endpoint.

The token is just an ``itsdangerous`` signed payload with a short max-age,
the same mechanism the session cookie already uses. Benefits:

* No new DB table or migration.
* Tamper-proof (HMAC under the session secret).
* Time-limited (we hard-code 30 min so a misplaced phone link goes stale fast).
* Carries everything the upload endpoint needs (product id + minter id).

If we ever need single-use semantics or per-token revocation we'd swap this
out for a real table, but for the QR upload flow the time bound is enough.
"""

from __future__ import annotations

import time
from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

# Token lifetime in seconds. Long enough for a merchant to walk to their phone
# and snap a few photos; short enough that a leaked link won't be useful.
UPLOAD_TOKEN_MAX_AGE = 30 * 60

# Process-local revocation list. Maps the raw token string to the unix
# timestamp at which we can forget it (i.e. its natural expiry — once past
# that the signature would be rejected anyway, so the entry is moot).
#
# Why in-memory? Tokens have a hard 30-min ceiling, so even in the worst case
# a worker restart loses the revoke flag for at most 30 minutes. We'd swap
# this for Redis or a `revoked_upload_tokens` table if/when we go multi-worker.
_REVOKED: dict[str, float] = {}


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-product-upload-token",
    )


def mint_product_upload_token(
    product_id: str,
    user_id: str | None,
    *,
    inventory_item_id: str | None = None,
) -> str:
    """Create a signed token authorising uploads to a shop inventory row.

    The minter's id is stamped so we can audit "uploaded_by" on the resulting
    media records — but the token works even if the user is later deleted.
    """
    settings = get_settings()
    payload: dict[str, Any] = {"pid": str(product_id), "uid": user_id}
    if inventory_item_id is not None:
        payload["iid"] = str(inventory_item_id)
    return _serializer(settings).dumps(payload)


class UploadTokenInvalid(Exception):
    """Raised when a token is unparseable, expired, or for a different product."""


def _prune_revoked(now: float | None = None) -> None:
    """Drop revoked entries that are past their natural expiry."""
    cutoff = time.time() if now is None else now
    for key, expires_at in list(_REVOKED.items()):
        if expires_at <= cutoff:
            _REVOKED.pop(key, None)


def is_revoked(token: str) -> bool:
    """True if the token has been explicitly expired by a user."""
    _prune_revoked()
    return token in _REVOKED


def read_product_upload_token(
    token: str,
    *,
    check_revoked: bool = True,
) -> dict[str, Any]:
    """Validate a token and return its payload.

    Raises ``UploadTokenInvalid`` if the signature is bad, expired, or the
    token has been explicitly revoked. ``check_revoked=False`` lets the
    revoke endpoint itself decode a token to verify ownership without
    bouncing on its own revocation flag.
    """
    if check_revoked and is_revoked(token):
        raise UploadTokenInvalid("Upload link has been expired.")
    settings = get_settings()
    try:
        data = _serializer(settings).loads(token, max_age=UPLOAD_TOKEN_MAX_AGE)
    except SignatureExpired as exc:
        raise UploadTokenInvalid("Upload link has expired.") from exc
    except BadSignature as exc:
        raise UploadTokenInvalid("Upload link is invalid.") from exc
    if not isinstance(data, dict) or "pid" not in data:
        raise UploadTokenInvalid("Upload link is malformed.")
    return data


def revoke_product_upload_token(token: str) -> None:
    """Mark a token as invalid for the rest of its natural lifetime.

    Idempotent — calling this twice for the same token is a no-op.
    """
    _REVOKED[token] = time.time() + UPLOAD_TOKEN_MAX_AGE
    _prune_revoked()
