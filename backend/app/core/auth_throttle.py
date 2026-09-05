"""In-process rate limits and lockouts for login / OTP endpoints."""

from __future__ import annotations

import time
from threading import Lock

from fastapi import HTTPException, Request, status

LOGIN_IP_MAX = 30
LOGIN_IP_WINDOW = 900
LOGIN_ID_FAILURES = 8
LOGIN_ID_LOCKOUT = 900

OTP_REQUEST_IP_MAX = 20
OTP_REQUEST_ID_MAX = 5
OTP_REQUEST_WINDOW = 600

OTP_VERIFY_IP_MAX = 30
OTP_VERIFY_IP_WINDOW = 600
OTP_VERIFY_FAILURES = 5
OTP_VERIFY_LOCKOUT = 900

_THROTTLED_MESSAGE = "Too many attempts. Try again shortly."


class AuthThrottled(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, int(retry_after))
        super().__init__(_THROTTLED_MESSAGE)


class _Bucket:
    __slots__ = ("events", "failures", "lock_until")

    def __init__(self) -> None:
        self.events: list[float] = []
        self.failures: int = 0
        self.lock_until: float = 0.0


_lock = Lock()
_buckets: dict[str, _Bucket] = {}


def reset_auth_throttle() -> None:
    """Clear all buckets (tests only)."""
    with _lock:
        _buckets.clear()


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def identity_key(raw: str | None) -> str:
    return (raw or "").strip().lower()


def _bucket(key: str) -> _Bucket:
    found = _buckets.get(key)
    if found is None:
        found = _Bucket()
        _buckets[key] = found
    return found


def _raise_if_locked(bucket: _Bucket, now: float) -> None:
    if bucket.lock_until > now:
        raise AuthThrottled(int(bucket.lock_until - now))


def hit(key: str, *, max_events: int, window_seconds: int) -> None:
    now = time.monotonic()
    with _lock:
        bucket = _bucket(key)
        _raise_if_locked(bucket, now)
        bucket.events = [stamp for stamp in bucket.events if now - stamp < window_seconds]
        if len(bucket.events) >= max_events:
            oldest = bucket.events[0]
            raise AuthThrottled(int(window_seconds - (now - oldest)))
        bucket.events.append(now)


def fail(key: str, *, max_failures: int, lockout_seconds: int) -> None:
    now = time.monotonic()
    with _lock:
        bucket = _bucket(key)
        _raise_if_locked(bucket, now)
        bucket.failures += 1
        if bucket.failures >= max_failures:
            bucket.lock_until = now + lockout_seconds
            bucket.failures = 0
            raise AuthThrottled(lockout_seconds)


def succeed(key: str) -> None:
    with _lock:
        bucket = _buckets.get(key)
        if bucket is None:
            return
        bucket.failures = 0
        bucket.lock_until = 0.0


def assert_unlocked(key: str) -> None:
    now = time.monotonic()
    with _lock:
        _raise_if_locked(_bucket(key), now)


def raise_throttled(exc: AuthThrottled) -> None:
    raise HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail=str(exc),
        headers={"Retry-After": str(exc.retry_after)},
    )


def enforce(callback) -> None:
    try:
        callback()
    except AuthThrottled as exc:
        raise_throttled(exc)


def throttle_login(request: Request, identifier: str) -> None:
    ip = client_ip(request)
    ident = identity_key(identifier)

    def _run() -> None:
        assert_unlocked(f"login-id:{ident}")
        hit(f"login-ip:{ip}", max_events=LOGIN_IP_MAX, window_seconds=LOGIN_IP_WINDOW)

    enforce(_run)


def record_login_failure(identifier: str) -> None:
    ident = identity_key(identifier)

    def _run() -> None:
        fail(
            f"login-id:{ident}",
            max_failures=LOGIN_ID_FAILURES,
            lockout_seconds=LOGIN_ID_LOCKOUT,
        )

    enforce(_run)


def record_login_success(identifier: str) -> None:
    succeed(f"login-id:{identity_key(identifier)}")


def throttle_otp_request(request: Request, identifier: str) -> None:
    ip = client_ip(request)
    ident = identity_key(identifier)

    def _run() -> None:
        hit(
            f"otp-req-ip:{ip}",
            max_events=OTP_REQUEST_IP_MAX,
            window_seconds=OTP_REQUEST_WINDOW,
        )
        hit(
            f"otp-req-id:{ident}",
            max_events=OTP_REQUEST_ID_MAX,
            window_seconds=OTP_REQUEST_WINDOW,
        )

    enforce(_run)


def throttle_otp_verify(request: Request, identifier: str) -> None:
    ip = client_ip(request)
    ident = identity_key(identifier)

    def _run() -> None:
        assert_unlocked(f"otp-ver-id:{ident}")
        hit(
            f"otp-ver-ip:{ip}",
            max_events=OTP_VERIFY_IP_MAX,
            window_seconds=OTP_VERIFY_IP_WINDOW,
        )

    enforce(_run)


def record_otp_verify_failure(identifier: str) -> None:
    ident = identity_key(identifier)

    def _run() -> None:
        fail(
            f"otp-ver-id:{ident}",
            max_failures=OTP_VERIFY_FAILURES,
            lockout_seconds=OTP_VERIFY_LOCKOUT,
        )

    enforce(_run)


def record_otp_verify_success(identifier: str) -> None:
    succeed(f"otp-ver-id:{identity_key(identifier)}")
