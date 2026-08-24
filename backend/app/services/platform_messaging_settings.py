from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import PlatformMessagingSettings
from app.services.dm_bot_registry import DEFAULT_DM_BOT, normalize_dm_bot

DEFAULT_WAIT_DM_TIME_SECONDS = 10
DEFAULT_RUNTIME_MODE = "dev"


def get_platform_messaging_settings(db: Session) -> PlatformMessagingSettings | None:
    return (
        db.query(PlatformMessagingSettings)
        .order_by(PlatformMessagingSettings.id.desc())
        .first()
    )


def get_wait_dm_time_seconds(db: Session) -> int:
    row = get_platform_messaging_settings(db)
    if row is None:
        return DEFAULT_WAIT_DM_TIME_SECONDS
    value = int(row.wait_dm_time_seconds or DEFAULT_WAIT_DM_TIME_SECONDS)
    return max(1, min(value, 3600))


def auto_responses_paused(db: Session) -> bool:
    """When true, only ticket greeting + inactivity close messages are sent."""
    row = get_platform_messaging_settings(db)
    if row is None:
        return False
    return bool(row.pause_auto_responses)


def allow_orders_when_store_closed(db: Session) -> bool:
    """When true, DM order placement can continue even while store is paused."""
    row = get_platform_messaging_settings(db)
    if row is None:
        return False
    return bool(getattr(row, "allow_orders_when_store_closed", False))


def get_platform_dm_bot(db: Session) -> str:
    row = get_platform_messaging_settings(db)
    if row is None:
        return DEFAULT_DM_BOT
    return normalize_dm_bot(getattr(row, "dm_bot", None))
