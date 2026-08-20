"""Instagram DM bot identity — AI sales agent only.

Menu bot and sales autopilot have been removed. Helpers remain so existing
call sites keep a stable “is AI agent” check.
"""

from __future__ import annotations

DEFAULT_DM_BOT = "ai_agent"


def normalize_dm_bot(value: str | None) -> str:
    del value
    return DEFAULT_DM_BOT


def dm_bot_catalog_payload() -> list[dict[str, object]]:
    return []
