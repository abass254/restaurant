"""Platform-wide runtime mode (dev vs production)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.session import validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import PlatformMessagingSettings, User
from app.api.v1.admin import require_super_admin
from app.services.platform_messaging_settings import get_platform_messaging_settings
from app.services.platform_runtime import VALID_RUNTIME_MODES, get_runtime_mode

router = APIRouter(prefix="/platform", tags=["platform"])


class RuntimeModeOut(BaseModel):
    mode: Literal["dev", "production"]
    price_edit_enabled: bool
    mpesa_uses_daraja_sandbox: bool


class RuntimeModeUpdate(BaseModel):
    mode: Literal["dev", "production"]


@router.get("/runtime-mode")
def show_runtime_mode(db: Session = Depends(get_db)) -> dict:
    mode = get_runtime_mode(db)
    return {
        "data": RuntimeModeOut(
            mode=mode,  # type: ignore[arg-type]
            price_edit_enabled=mode == "dev",
            mpesa_uses_daraja_sandbox=mode == "dev",
        ),
    }


@router.patch("/runtime-mode")
def update_runtime_mode(
    payload: RuntimeModeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    user: User = Depends(require_super_admin),
):
    validate_csrf(request, session)

    if payload.mode not in VALID_RUNTIME_MODES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid mode.")

    row = get_platform_messaging_settings(db)
    now = datetime.now(timezone.utc)
    if row is None:
        row = PlatformMessagingSettings(
            runtime_mode=payload.mode,
            created_at=now,
        )
        db.add(row)
    else:
        row.runtime_mode = payload.mode
    row.updated_at = now
    db.commit()

    return {
        "message": f"Platform mode set to {payload.mode}.",
        "data": RuntimeModeOut(
            mode=payload.mode,
            price_edit_enabled=payload.mode == "dev",
            mpesa_uses_daraja_sandbox=payload.mode == "dev",
        ),
    }
