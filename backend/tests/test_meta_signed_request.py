from __future__ import annotations

import base64
import hashlib
import hmac
import json

from app.core.meta_signed_request import parse_signed_request


def _make_signed_request(payload: dict, secret: str) -> str:
    encoded_payload = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(
        secret.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    encoded_sig = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    return f"{encoded_sig}.{encoded_payload}"


def test_parse_signed_request_valid():
    secret = "test-secret"
    signed = _make_signed_request({"user_id": "12345"}, secret)
    data = parse_signed_request(signed, secret)
    assert data == {"user_id": "12345"}


def test_parse_signed_request_invalid_secret():
    signed = _make_signed_request({"user_id": "12345"}, "test-secret")
    assert parse_signed_request(signed, "wrong-secret") is None


def test_parse_signed_request_malformed():
    assert parse_signed_request("not-valid", "secret") is None
