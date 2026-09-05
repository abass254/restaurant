"""Create the local-only default super admin; never reset an existing password."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.security import hash_password
from app.models import User

SUPER_ADMIN_USERNAME = "netizen"
SUPER_ADMIN_DEFAULT_PASSWORD = "password"
SUPER_ADMIN_ROLE = "super_admin"
SUPER_ADMIN_DISPLAY_NAME = "Platform Super Admin"


def allow_default_super_admin_seed(settings: Settings | None = None) -> bool:
    """Default netizen/password is local-dev only."""
    cfg = settings or get_settings()
    if cfg.app_debug:
        return True
    return cfg.app_env.strip().lower() in {"local", "development", "dev"}


def seed_super_admin(
    db: Session,
    *,
    allow_default_seed: bool | None = None,
) -> str:
    """Create the default super admin once. Never overwrite an existing password.

    Returns a short status token for migrate logs.
    """
    allowed = (
        allow_default_seed
        if allow_default_seed is not None
        else allow_default_super_admin_seed()
    )
    now = datetime.now(timezone.utc)
    user = db.query(User).filter(User.username == SUPER_ADMIN_USERNAME).first()
    if user is not None:
        return "already present"

    if not allowed:
        return "skipped"

    user = User(
        name=SUPER_ADMIN_DISPLAY_NAME,
        username=SUPER_ADMIN_USERNAME,
        email=None,
        account_id=None,
        password=hash_password(SUPER_ADMIN_DEFAULT_PASSWORD),
        user_role=SUPER_ADMIN_ROLE,
        is_activated=True,
        require_change_password=False,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.commit()
    return "created"
