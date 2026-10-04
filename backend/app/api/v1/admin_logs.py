"""Super-admin feed of recent backend requests and log lines."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.api.v1.admin_auth import require_super_admin
from app.core import log_buffer
from app.core.log_buffer import LOG_BUFFER_SIZE, REQUEST_BUFFER_SIZE
from app.models import User

router = APIRouter(tags=["admin-logs"])


@router.get("/logs")
def get_backend_logs(
    requests: int = Query(1000, ge=0, le=REQUEST_BUFFER_SIZE),
    logs: int = Query(500, ge=0, le=LOG_BUFFER_SIZE),
    _admin: User = Depends(require_super_admin),
) -> dict[str, Any]:
    return log_buffer.snapshot(request_limit=requests, log_limit=logs)
