"""Email-gated access for internal merchant tools (Login codes, QA, etc.)."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.models import User

INTERNAL_TOOLS_ALLOWED_EMAILS = frozenset(
    {
        "abassahmed1738@gmail.com",
        "amal.mohamedali10@gmail.com",
    }
)


def is_internal_tools_user(user: User) -> bool:
    email = (user.email or "").strip().lower()
    return email in INTERNAL_TOOLS_ALLOWED_EMAILS


def require_internal_tools_user(user: User) -> User:
    if not is_internal_tools_user(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Internal tools access required.",
        )
    return user


# Backwards-compatible alias for QA endpoints.
require_qa_user = require_internal_tools_user
is_qa_user = is_internal_tools_user
