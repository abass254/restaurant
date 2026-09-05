"""Session Bearer + CSRF helpers for Expo rider clients."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

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


def test_validate_csrf_skips_for_bearer() -> None:
    bearer_req = MagicMock()
    bearer_req.method = "POST"
    bearer_req.headers = {"Authorization": "Bearer abc"}
    validate_csrf(bearer_req, {})
    assert request_uses_bearer_auth(bearer_req)


def test_validate_csrf_skips_without_session_cookie() -> None:
    req = MagicMock()
    req.method = "POST"
    req.headers = {"X-Rider-Client": "expo"}
    req.cookies.get.return_value = None
    validate_csrf(req, {})
    assert is_rider_mobile_client(req)


def test_validate_csrf_ignores_rider_client_header_when_cookie_present() -> None:
    req = MagicMock()
    req.method = "POST"
    req.headers = {"X-Rider-Client": "expo"}
    req.cookies.get.return_value = "session-cookie"
    with pytest.raises(HTTPException) as exc:
        validate_csrf(req, {"csrf_token": "expected"})
    assert exc.value.status_code == 403


def test_validate_csrf_accepts_matching_header() -> None:
    req = MagicMock()
    req.method = "POST"
    req.headers = {"X-XSRF-TOKEN": "expected"}
    req.cookies.get.return_value = "session-cookie"
    validate_csrf(req, {"csrf_token": "expected"})
