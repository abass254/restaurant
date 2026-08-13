"""Store accepting / busy / station heartbeat helpers."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

HEARTBEAT_STALE_SECONDS = 5 * 60
PAUSE_REASON_MANUAL = "manual"
PAUSE_REASON_HEARTBEAT = "heartbeat"
PAUSE_REASON_SCHEDULED = "scheduled"


def _utcnow() -> datetime:
    return datetime.utcnow()


def effective_prep_minutes(account: Any, order_prep: int | None = None) -> int:
    """Return quoted prep time: order override or default + busy bump."""
    base = int(order_prep) if order_prep is not None else int(
        getattr(account, "default_prep_minutes", None) or 20,
    )
    busy = int(getattr(account, "busy_extra_prep_minutes", None) or 0)
    return max(5, base + busy)


def is_pause_active(account: Any, *, now: datetime | None = None) -> bool:
    """True when the merchant has paused online order acceptance."""
    now = now or _utcnow()
    if not bool(getattr(account, "orders_paused", False)):
        return False
    until = getattr(account, "orders_paused_until", None)
    if until is not None and until <= now:
        return False
    return True


def apply_heartbeat_auto_pause(account: Any, *, now: datetime | None = None) -> bool:
    """Auto-pause when a registered station device goes silent.

    Returns True if the account row was mutated.
    """
    now = now or _utcnow()
    if not bool(getattr(account, "station_heartbeat_required", False)):
        return False

    last = getattr(account, "station_last_heartbeat_at", None)
    if last is None:
        return False

    stale = (now - last).total_seconds() >= HEARTBEAT_STALE_SECONDS
    if not stale:
        # Heartbeat recovered: clear auto-pause only (keep manual pauses).
        if (
            bool(getattr(account, "orders_paused", False))
            and getattr(account, "orders_paused_reason", None) == PAUSE_REASON_HEARTBEAT
        ):
            account.orders_paused = False
            account.orders_paused_until = None
            account.orders_paused_reason = None
            account.updated_at = now
            return True
        return False

    if is_pause_active(account, now=now):
        return False

    account.orders_paused = True
    account.orders_paused_until = None
    account.orders_paused_reason = PAUSE_REASON_HEARTBEAT
    account.updated_at = now
    return True


def refresh_expired_pause(account: Any, *, now: datetime | None = None) -> bool:
    """Clear timed pauses that have elapsed. Returns True if mutated."""
    now = now or _utcnow()
    if not bool(getattr(account, "orders_paused", False)):
        return False
    until = getattr(account, "orders_paused_until", None)
    if until is None or until > now:
        return False
    account.orders_paused = False
    account.orders_paused_until = None
    account.orders_paused_reason = None
    account.updated_at = now
    return True


def sync_store_status(account: Any, *, now: datetime | None = None) -> bool:
    """Apply timed-pause expiry + heartbeat auto-pause. Returns if mutated."""
    now = now or _utcnow()
    changed = refresh_expired_pause(account, now=now)
    changed = apply_heartbeat_auto_pause(account, now=now) or changed
    return changed


def is_accepting_orders(account: Any, *, now: datetime | None = None) -> bool:
    now = now or _utcnow()
    sync_store_status(account, now=now)
    return not is_pause_active(account, now=now)


def store_status_payload(account: Any, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or _utcnow()
    sync_store_status(account, now=now)
    paused = is_pause_active(account, now=now)
    last = getattr(account, "station_last_heartbeat_at", None)
    heartbeat_required = bool(getattr(account, "station_heartbeat_required", False))
    heartbeat_stale = False
    seconds_since_heartbeat: int | None = None
    if last is not None:
        seconds_since_heartbeat = max(0, int((now - last).total_seconds()))
        heartbeat_stale = seconds_since_heartbeat >= HEARTBEAT_STALE_SECONDS

    status = "paused" if paused else "open"
    if not paused and int(getattr(account, "busy_extra_prep_minutes", 0) or 0) > 0:
        status = "busy"

    return {
        "status": status,
        "accepting_orders": not paused,
        "orders_paused": paused,
        "orders_paused_until": (
            account.orders_paused_until.isoformat()
            if getattr(account, "orders_paused_until", None)
            else None
        ),
        "orders_paused_reason": getattr(account, "orders_paused_reason", None),
        "busy_extra_prep_minutes": int(
            getattr(account, "busy_extra_prep_minutes", 0) or 0,
        ),
        "default_prep_minutes": int(getattr(account, "default_prep_minutes", 20) or 20),
        "effective_prep_minutes": effective_prep_minutes(account),
        "station_heartbeat_required": heartbeat_required,
        "station_last_heartbeat_at": last.isoformat() if last else None,
        "station_heartbeat_stale": heartbeat_stale if heartbeat_required else False,
        "seconds_since_heartbeat": seconds_since_heartbeat,
        "heartbeat_stale_after_seconds": HEARTBEAT_STALE_SECONDS,
        "business_name": getattr(account, "business_name", None),
    }


def pause_store(
    account: Any,
    *,
    duration_minutes: int | None = None,
    reason: str = PAUSE_REASON_MANUAL,
    now: datetime | None = None,
) -> None:
    now = now or _utcnow()
    account.orders_paused = True
    account.orders_paused_reason = reason
    if duration_minutes and duration_minutes > 0:
        account.orders_paused_until = now + timedelta(minutes=int(duration_minutes))
    else:
        account.orders_paused_until = None
    account.updated_at = now


def resume_store(account: Any, *, now: datetime | None = None) -> None:
    now = now or _utcnow()
    account.orders_paused = False
    account.orders_paused_until = None
    account.orders_paused_reason = None
    account.updated_at = now


def set_busy(
    account: Any,
    *,
    extra_prep_minutes: int,
    now: datetime | None = None,
) -> None:
    now = now or _utcnow()
    account.busy_extra_prep_minutes = max(0, int(extra_prep_minutes))
    account.updated_at = now


def record_station_heartbeat(account: Any, *, now: datetime | None = None) -> None:
    now = now or _utcnow()
    account.station_last_heartbeat_at = now
    account.station_heartbeat_required = True
    account.updated_at = now
    # Recover from heartbeat auto-pause immediately.
    if getattr(account, "orders_paused_reason", None) == PAUSE_REASON_HEARTBEAT:
        resume_store(account, now=now)
