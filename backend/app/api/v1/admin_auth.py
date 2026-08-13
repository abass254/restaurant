"""Shared auth dependencies for platform admin routes."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.session import require_user
from app.database import get_db
from app.dependencies import get_request_session
from app.models import User


def require_super_admin(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
) -> User:
    user = require_user(db, session)
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Super admin access is required.",
        )
    return user
