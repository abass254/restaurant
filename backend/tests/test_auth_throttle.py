"""Login / OTP in-process throttle."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core import auth_throttle


@pytest.fixture(autouse=True)
def _clear_buckets():
    auth_throttle.reset_auth_throttle()
    yield
    auth_throttle.reset_auth_throttle()


def test_hit_allows_under_limit() -> None:
    for _ in range(3):
        auth_throttle.hit("k", max_events=3, window_seconds=60)


def test_hit_blocks_over_limit() -> None:
    for _ in range(3):
        auth_throttle.hit("k", max_events=3, window_seconds=60)
    with pytest.raises(auth_throttle.AuthThrottled):
        auth_throttle.hit("k", max_events=3, window_seconds=60)


def test_fail_lockout_after_max_failures() -> None:
    for _ in range(auth_throttle.OTP_VERIFY_FAILURES - 1):
        auth_throttle.fail(
            "otp",
            max_failures=auth_throttle.OTP_VERIFY_FAILURES,
            lockout_seconds=30,
        )
    with pytest.raises(auth_throttle.AuthThrottled) as exc:
        auth_throttle.fail(
            "otp",
            max_failures=auth_throttle.OTP_VERIFY_FAILURES,
            lockout_seconds=30,
        )
    assert exc.value.retry_after >= 1
    with pytest.raises(auth_throttle.AuthThrottled):
        auth_throttle.assert_unlocked("otp")


def test_succeed_clears_failures() -> None:
    auth_throttle.fail("otp", max_failures=5, lockout_seconds=30)
    auth_throttle.succeed("otp")
    auth_throttle.assert_unlocked("otp")


def test_raise_throttled_is_http_429() -> None:
    with pytest.raises(HTTPException) as exc:
        auth_throttle.raise_throttled(auth_throttle.AuthThrottled(12))
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"] == "12"
