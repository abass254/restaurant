"""Log client error response details beneath uvicorn access lines (dev)."""

from __future__ import annotations

import json
import logging
import os
import traceback
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.http_errors")

_FULLSCREEN_ENV = "HTTP_ERROR_LOG_FULLSCREEN"


def _fullscreen_enabled() -> bool:
    return os.getenv(_FULLSCREEN_ENV, "").strip().lower() in ("1", "true", "yes")


def _format_detail(detail: Any) -> str:
    lines = _detail_lines(detail)
    if not lines:
        return ""
    if len(lines) == 1:
        return lines[0]
    return "; ".join(lines)


def _detail_lines(detail: Any) -> list[str]:
    if detail is None:
        return []
    if isinstance(detail, str):
        text = detail.strip()
        return [text] if text else []
    if isinstance(detail, dict):
        message = detail.get("message") or detail.get("detail")
        if message and not isinstance(message, (dict, list)):
            return [str(message)]
        try:
            payload = json.dumps(detail, indent=2, default=str)
        except TypeError:
            payload = str(detail)
        return payload.splitlines()
    if isinstance(detail, list):
        lines: list[str] = []
        for item in detail:
            if isinstance(item, dict):
                loc = ".".join(str(part) for part in item.get("loc", ()))
                msg = item.get("msg", "")
                lines.append(f"{loc}: {msg}" if loc else str(msg))
            else:
                lines.append(str(item))
        return [line for line in lines if line.strip()]
    text = str(detail).strip()
    return [text] if text else []


def _should_fullscreen(status_code: int, detail: Any, lines: list[str]) -> bool:
    if _fullscreen_enabled():
        return True
    if status_code >= 500:
        return True
    if len(lines) > 1:
        return True
    if isinstance(detail, dict) and len(detail) > 1:
        return True
    return False


def _log_fullscreen_block(header: str, lines: list[str]) -> None:
    if not lines:
        return
    width = max(len(header), *(len(line) for line in lines), 48)
    body = "\n".join(f"    │ {line}" for line in lines)
    logger.warning(
        "    ┌─ %s %s\n%s\n    └%s",
        header,
        "─" * max(0, width - len(header)),
        body,
        "─" * (width + 4),
    )


def _log_client_error(
    request: Request,
    status_code: int,
    detail: Any,
    *,
    exc: BaseException | None = None,
) -> None:
    if status_code < 400:
        return

    summary = _format_detail(detail).strip()
    lines = _detail_lines(detail)
    if exc is not None and status_code >= 500:
        lines.extend(traceback.format_exception(type(exc), exc, exc.__traceback__))
    if not summary and not lines:
        return

    # Indented follow-up line reads as an “expand” under the uvicorn access log.
    if summary:
        logger.warning(
            "%s %s %s\n    └─ %s",
            status_code,
            request.method,
            request.url.path,
            summary,
        )
    else:
        logger.warning(
            "%s %s %s",
            status_code,
            request.method,
            request.url.path,
        )

    if _should_fullscreen(status_code, detail, lines):
        header = f"{status_code} {request.method} {request.url.path}"
        _log_fullscreen_block(header, lines)


def log_unhandled_error(request: Request, exc: BaseException) -> None:
    _log_client_error(request, 500, str(exc), exc=exc)


def register_http_error_logging(app) -> None:
    """Attach handlers that echo 4xx/5xx `detail` into the server log."""

    @app.exception_handler(HTTPException)
    async def logged_http_exception(request: Request, exc: HTTPException):
        _log_client_error(request, exc.status_code, exc.detail, exc=exc)
        return await http_exception_handler(request, exc)

    @app.exception_handler(StarletteHTTPException)
    async def logged_starlette_http_exception(
        request: Request,
        exc: StarletteHTTPException,
    ):
        _log_client_error(request, exc.status_code, exc.detail, exc=exc)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    @app.exception_handler(RequestValidationError)
    async def logged_validation_exception(request: Request, exc: RequestValidationError):
        _log_client_error(request, 422, exc.errors(), exc=exc)
        return await request_validation_exception_handler(request, exc)
