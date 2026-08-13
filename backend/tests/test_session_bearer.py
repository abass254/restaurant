"""Session Bearer + mobile CSRF helpers for Expo rider clients."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.core.session import (
    decode_session_token,
    encode_session_token,
    get_session,
    is_rider_mobile_client,
    login_rider,
    request_uses_bearer_auth,
    validate_csrf,
)


def test_encode_decode_session_roundtrip() -> None:
    raw = {"rider_id": "r-1", "csrf_token": "tok"}
    token = encode_session_token(raw)
    assert decode_session_token(token)["rider_id"] == "r-1"


def test_get_session_prefers_bearer_over_cookie() -> None:
    session: dict = {}
    login_rider(session, "rider-bearer")
    token = encode_session_token(session)
    req = MagicMock()
    req.headers = {"Authorization": f"Bearer {token}"}
    req.cookies = MagicMock()
    req.cookies.get.return_value = "ignored-cookie"
    loaded = get_session(req)
    assert loaded.get("rider_id") == "rider-bearer"


def test_validate_csrf_skips_for_bearer_and_mobile() -> None:
    bearer_req = MagicMock()
    bearer_req.method = "POST"
    bearer_req.headers = {"Authorization": "Bearer abc"}
    validate_csrf(bearer_req, {})

    mobile_req = MagicMock()
    mobile_req.method = "POST"
    mobile_req.headers = {"X-Rider-Client": "expo"}
    validate_csrf(mobile_req, {})
    assert is_rider_mobile_client(mobile_req)
    assert request_uses_bearer_auth(bearer_req)
