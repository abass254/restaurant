"""In-memory ring buffers of recent HTTP requests and log records.

Feeds the super-admin Logs dashboard. Buffers are per-process, so they only
cover the single uvicorn worker the app runs with and reset on restart.
"""

from __future__ import annotations

import logging
import re
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

REQUEST_BUFFER_SIZE = 2000
LOG_BUFFER_SIZE = 2000
MAX_MESSAGE_CHARS = 4000
MAX_PATH_CHARS = 300
SLOW_REQUEST_MS = 1000

logger = logging.getLogger(__name__)

# Polling the dashboard itself would otherwise drown out real traffic.
EXCLUDED_PATHS = frozenset({"/api/v1/admin/logs"})

_SENSITIVE_QUERY = re.compile(
    r"(?i)\b((?:access_)?token|code|secret|password|signature|key|otp)=([^&]*)"
)
_ANSI = re.compile(r"\x1b\[[0-9;]*m")

request_buffer: deque[dict[str, Any]] = deque(maxlen=REQUEST_BUFFER_SIZE)
log_buffer: deque[dict[str, Any]] = deque(maxlen=LOG_BUFFER_SIZE)
started_at = datetime.now(timezone.utc)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _redact_query(query: str) -> str:
    return _SENSITIVE_QUERY.sub(lambda m: f"{m.group(1)}=***", query)


def _client_ip(scope: dict[str, Any]) -> str | None:
    for name, value in scope.get("headers") or []:
        if name == b"x-forwarded-for":
            return value.decode("latin-1").split(",")[0].strip() or None
    client = scope.get("client")
    return client[0] if client else None


class BufferLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = _ANSI.sub("", record.getMessage())
            if record.exc_info and not record.exc_text:
                record.exc_text = logging.Formatter().formatException(record.exc_info)
            if record.exc_text:
                message = f"{message}\n{record.exc_text}"
            log_buffer.append(
                {
                    "ts": _iso(record.created),
                    "level": record.levelname.lower(),
                    "logger": record.name,
                    "message": message[:MAX_MESSAGE_CHARS],
                }
            )
        except Exception:  # noqa: BLE001 - a log handler must never raise
            self.handleError(record)


def install_log_handler() -> None:
    """Attach the buffer handler to root and uvicorn loggers (idempotent)."""
    # uvicorn's own loggers don't propagate to root; uvicorn.access is skipped
    # because RequestLogMiddleware records richer request data.
    for name in ("", "uvicorn"):
        target = logging.getLogger(name)
        if not any(isinstance(h, BufferLogHandler) for h in target.handlers):
            target.addHandler(BufferLogHandler())


class RequestLogMiddleware:
    """Pure ASGI middleware recording method, path, status and latency."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("path") in EXCLUDED_PATHS:
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            path = scope.get("path", "")
            query = scope.get("query_string", b"").decode("latin-1")
            if query:
                path = f"{path}?{_redact_query(query)}"
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            request_buffer.append(
                {
                    "ts": _iso(time.time()),
                    "method": scope.get("method", ""),
                    "path": path[:MAX_PATH_CHARS],
                    "status": status_holder["status"],
                    "duration_ms": duration_ms,
                    "ip": _client_ip(scope),
                }
            )
            if duration_ms >= SLOW_REQUEST_MS:
                logger.warning(
                    "Slow request %s %s took %.0fms (status %s)",
                    scope.get("method", ""),
                    path[:MAX_PATH_CHARS],
                    duration_ms,
                    status_holder["status"],
                )


def snapshot(*, request_limit: int, log_limit: int) -> dict[str, Any]:
    requests = list(request_buffer)[-request_limit:] if request_limit else []
    logs = list(log_buffer)[-log_limit:] if log_limit else []
    return {
        "started_at": started_at.isoformat(),
        "requests": requests,
        "logs": logs,
        "request_capacity": REQUEST_BUFFER_SIZE,
        "log_capacity": LOG_BUFFER_SIZE,
    }
