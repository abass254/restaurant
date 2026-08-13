from __future__ import annotations

from datetime import datetime


def parse_meta_datetime(value: str) -> datetime:
    """Parse Graph API timestamps (Z or +0000 offsets)."""
    normalized = value.strip().replace("Z", "+00:00")
    if normalized.endswith("+0000"):
        normalized = f"{normalized[:-5]}+00:00"
    elif normalized.endswith("-0000"):
        normalized = f"{normalized[:-5]}-00:00"
    return datetime.fromisoformat(normalized)
