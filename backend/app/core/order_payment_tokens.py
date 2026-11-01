"""Signed tokens for the public order payment page."""

from __future__ import annotations

from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

ORDER_PAYMENT_TOKEN_MAX_AGE = 60 * 60 * 24 * 14  # 14 days


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-order-payment",
    )


def mint_order_payment_token(order_id: str) -> str:
    settings = get_settings()
    payload: dict[str, Any] = {"oid": str(order_id)}
    return _serializer(settings).dumps(payload)


class OrderPaymentTokenInvalid(Exception):
    pass


def read_order_payment_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        data = _serializer(settings).loads(
            token,
            max_age=ORDER_PAYMENT_TOKEN_MAX_AGE,
        )
    except SignatureExpired as exc:
        raise OrderPaymentTokenInvalid(
            "This payment link has expired."
        ) from exc
    except BadSignature as exc:
        raise OrderPaymentTokenInvalid(
            "This payment link is invalid."
        ) from exc
    if not isinstance(data, dict) or "oid" not in data:
        raise OrderPaymentTokenInvalid("This payment link is malformed.")
    return data
