from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any


def parse_signed_request(signed_request: str, app_secret: str) -> dict[str, Any] | None:
    """Parse and verify a Meta signed_request payload."""
    if not signed_request or "." not in signed_request:
        return None

    encoded_sig, payload = signed_request.split(".", 1)
    try:
        sig = base64.urlsafe_b64decode(_pad_base64(encoded_sig))
        data = json.loads(base64.urlsafe_b64decode(_pad_base64(payload)))
    except (ValueError, json.JSONDecodeError):
        return None

    expected_sig = hmac.new(
        app_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(sig, expected_sig):
        return None

    return data


def _pad_base64(value: str) -> str:
    remainder = len(value) % 4
    if remainder:
        return value + ("=" * (4 - remainder))
    return value
