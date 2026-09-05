"""Backwards-compatible re-exports — prefer internal_tools_access."""

from app.support.internal_tools_access import (
    INTERNAL_TOOLS_ALLOWED_EMAILS,
    is_internal_tools_user,
    is_qa_user,
    require_internal_tools_user,
    require_qa_user,
)

__all__ = [
    "INTERNAL_TOOLS_ALLOWED_EMAILS",
    "is_internal_tools_user",
    "is_qa_user",
    "require_internal_tools_user",
    "require_qa_user",
]
