"""Tests for the in-memory request/log buffers behind the admin Logs page."""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core import log_buffer
from app.core.log_buffer import BufferLogHandler, RequestLogMiddleware


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestLogMiddleware)

    @app.get("/ok")
    def ok():
        return {"ok": True}

    @app.get("/missing")
    def missing():
        raise HTTPException(404, "nope")

    @app.get("/boom")
    def boom():
        raise RuntimeError("boom")

    @app.get("/api/v1/admin/logs")
    def logs():
        return {}

    return app


def test_middleware_records_status_codes_and_redacts_query():
    log_buffer.request_buffer.clear()
    client = TestClient(_app(), raise_server_exceptions=False)

    client.get("/ok?token=abc123&page=2")
    client.get("/missing")
    client.get("/boom")
    client.get("/api/v1/admin/logs")

    entries = list(log_buffer.request_buffer)
    assert [(e["path"], e["status"]) for e in entries] == [
        ("/ok?token=***&page=2", 200),
        ("/missing", 404),
        ("/boom", 500),
    ]
    assert all(e["method"] == "GET" and e["duration_ms"] >= 0 for e in entries)


def test_log_handler_captures_messages_and_tracebacks():
    log_buffer.log_buffer.clear()
    logger = logging.getLogger("tests.log_buffer")
    handler = BufferLogHandler()
    logger.addHandler(handler)
    try:
        logger.warning("hello %s", "world")
        try:
            raise ValueError("bad")
        except ValueError:
            logger.exception("failed")
    finally:
        logger.removeHandler(handler)

    first, second = list(log_buffer.log_buffer)
    assert first["level"] == "warning"
    assert first["message"] == "hello world"
    assert first["logger"] == "tests.log_buffer"
    assert second["level"] == "error"
    assert "ValueError: bad" in second["message"]


def test_snapshot_respects_limits():
    log_buffer.request_buffer.clear()
    for i in range(5):
        log_buffer.request_buffer.append({"path": f"/{i}"})
    snap = log_buffer.snapshot(request_limit=2, log_limit=0)
    assert [r["path"] for r in snap["requests"]] == ["/3", "/4"]
    assert snap["logs"] == []
