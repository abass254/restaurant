"""Platform messaging settings (super admin).

Controls DM ticket behaviour such as the inactivity timeout after the
initial greeting.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import PlatformMessagingSettings, User
from app.services.dm_bot_registry import DEFAULT_DM_BOT, normalize_dm_bot
from app.services.platform_messaging_settings import (
    DEFAULT_WAIT_DM_TIME_SECONDS,
    get_platform_messaging_settings,
)

router = APIRouter(prefix="/messaging-settings", tags=["messaging-settings"])


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only super admins can manage messaging settings.",
        )


class MessagingSettingsPayload(BaseModel):
    wait_dm_time_seconds: int = Field(default=DEFAULT_WAIT_DM_TIME_SECONDS, ge=1, le=3600)
    pause_auto_responses: bool = False
    dm_bot: str | None = None


class MessagingSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    wait_dm_time_seconds: int
    pause_auto_responses: bool
    dm_bot: str


@router.get("")
def show_messaging_settings(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    _require_super_admin(user)
    row = get_platform_messaging_settings(db)
    if row is None:
        return {
            "settings": {
                "id": "",
                "wait_dm_time_seconds": DEFAULT_WAIT_DM_TIME_SECONDS,
                "pause_auto_responses": False,
                "dm_bot": DEFAULT_DM_BOT,
            },
        }
    settings = MessagingSettingsOut.model_validate(row)
    settings = settings.model_copy(update={"dm_bot": normalize_dm_bot(settings.dm_bot)})
    return {"settings": settings}


@router.put("")
def upsert_messaging_settings(
    payload: MessagingSettingsPayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)

    row = get_platform_messaging_settings(db)
    now = datetime.now(timezone.utc)
    if row is None:
        row = PlatformMessagingSettings(created_at=now)
        db.add(row)

    row.wait_dm_time_seconds = payload.wait_dm_time_seconds
    row.pause_auto_responses = payload.pause_auto_responses
    row.dm_bot = DEFAULT_DM_BOT
    row.updated_at = now
    db.commit()
    db.refresh(row)

    settings = MessagingSettingsOut.model_validate(row)
    settings = settings.model_copy(update={"dm_bot": DEFAULT_DM_BOT})
    return {
        "message": "Messaging settings saved.",
        "settings": settings,
    }
