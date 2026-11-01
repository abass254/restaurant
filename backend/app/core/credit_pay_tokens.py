"""Signed tokens for the public credit / pay-bill page."""

from __future__ import annotations

from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

CREDIT_PAY_TOKEN_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-credit-pay",
    )


def mint_credit_pay_token(customer_id: str) -> str:
    settings = get_settings()
    payload: dict[str, Any] = {"cid": str(customer_id)}
    return _serializer(settings).dumps(payload)


class CreditPayTokenInvalid(Exception):
    pass


def read_credit_pay_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        data = _serializer(settings).loads(
            token,
            max_age=CREDIT_PAY_TOKEN_MAX_AGE,
        )
    except SignatureExpired as exc:
        raise CreditPayTokenInvalid("This pay-bill link has expired.") from exc
    except BadSignature as exc:
        raise CreditPayTokenInvalid("This pay-bill link is invalid.") from exc
    if not isinstance(data, dict) or "cid" not in data:
        raise CreditPayTokenInvalid("This pay-bill link is malformed.")
    return data
