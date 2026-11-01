"""Signed tokens for the unauthenticated customer order-tracking page.

When an order is placed, we mint a link ``<frontend>/track/<token>`` that
lets the customer (or anyone with the link) see live progress without a
merchant login. The token is an ``itsdangerous`` signed payload — the same
mechanism as storefront and upload links:

* No new DB table or migration.
* Tamper-proof (HMAC under the session secret).
* Time-limited (long enough to cover the full order lifecycle).
* Scoped to a single ``order_id``.
"""

from __future__ import annotations

from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

# Long enough for slow deliveries and follow-up; short enough that a leaked
# link eventually goes stale.
ORDER_TRACKING_TOKEN_MAX_AGE = 60 * 60 * 24 * 90  # 90 days


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-order-tracking",
    )


def mint_order_tracking_token(order_id: str) -> str:
    """Create a signed token scoped to ``order_id``."""
    settings = get_settings()
    payload: dict[str, Any] = {"oid": str(order_id)}
    return _serializer(settings).dumps(payload)


class OrderTrackingTokenInvalid(Exception):
    """Raised when a token is unparseable, expired, or malformed."""


def read_order_tracking_token(token: str) -> dict[str, Any]:
    """Validate a token's signature + age and return its payload."""
    settings = get_settings()
    try:
        data = _serializer(settings).loads(
            token,
            max_age=ORDER_TRACKING_TOKEN_MAX_AGE,
        )
    except SignatureExpired as exc:
        raise OrderTrackingTokenInvalid(
            "This tracking link has expired."
        ) from exc
    except BadSignature as exc:
        raise OrderTrackingTokenInvalid(
            "This tracking link is invalid."
        ) from exc
    if not isinstance(data, dict) or "oid" not in data:
        raise OrderTrackingTokenInvalid("This tracking link is malformed.")
    return data
