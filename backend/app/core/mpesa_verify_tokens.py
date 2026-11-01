"""Short-lived tokens proving a merchant confirmed an M-PESA destination lookup."""

from __future__ import annotations

from typing import Any

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

VERIFY_TOKEN_MAX_AGE = 10 * 60


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.session_secret,
        salt="TransChap-mpesa-destination-verify",
    )


class MpesaVerifyTokenInvalid(Exception):
    """Raised when a destination verification token is bad or expired."""


def mint_mpesa_verify_token(
    *,
    account_id: str,
    shortcode: str,
    shortcode_type: str,
    account_number: str,
    organization_name: str,
) -> str:
    settings = get_settings()
    payload = {
        "aid": str(account_id),
        "sc": str(shortcode),
        "st": str(shortcode_type),
        "an": str(account_number or ""),
        "nm": str(organization_name),
    }
    return _serializer(settings).dumps(payload)


def read_mpesa_verify_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        data = _serializer(settings).loads(token, max_age=VERIFY_TOKEN_MAX_AGE)
    except SignatureExpired as exc:
        raise MpesaVerifyTokenInvalid(
            "That lookup expired. Look up the destination again."
        ) from exc
    except BadSignature as exc:
        raise MpesaVerifyTokenInvalid(
            "That confirmation is invalid. Look up the destination again."
        ) from exc
    if not isinstance(data, dict) or not data.get("sc") or not data.get("st"):
        raise MpesaVerifyTokenInvalid(
            "That confirmation is invalid. Look up the destination again."
        )
    return data
