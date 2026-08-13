from __future__ import annotations

from sqlalchemy.orm import Session

from app.services.platform_messaging_settings import (
    DEFAULT_RUNTIME_MODE,
    get_platform_messaging_settings,
)

VALID_RUNTIME_MODES = frozenset({"dev", "production"})


def get_runtime_mode(db: Session) -> str:
    row = get_platform_messaging_settings(db)
    if row is None:
        return DEFAULT_RUNTIME_MODE
    mode = str(row.runtime_mode or DEFAULT_RUNTIME_MODE).strip().lower()
    if mode not in VALID_RUNTIME_MODES:
        return DEFAULT_RUNTIME_MODE
    return mode


def is_dev_runtime(db: Session) -> bool:
    return get_runtime_mode(db) == "dev"
