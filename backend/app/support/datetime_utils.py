from __future__ import annotations

from datetime import datetime, timezone


def as_utc(value: datetime | None) -> datetime | None:
    """Normalize DB/API datetimes to aware UTC for safe comparison."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def naive_utc(value: datetime | None) -> datetime | None:
    """Convert an API datetime to the naive-UTC form stored in DB columns."""
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def utc_now() -> datetime:
    """Return current UTC time as naive datetime (SQLite-friendly)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def sortable_datetime(value: datetime | None) -> datetime:
    """Fallback-aware datetime for sorting and max/min."""
    return as_utc(value) or datetime.min.replace(tzinfo=timezone.utc)
