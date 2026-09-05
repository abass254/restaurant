"""Delivery lifecycle — independent of kitchen orders when order_id is null."""

from __future__ import annotations

from typing import Final

DELIVERY_SEARCHING: Final = "searching"
DELIVERY_ACTIVE: Final = "active"
DELIVERY_COMPLETED: Final = "completed"
DELIVERY_CANCELLED: Final = "cancelled"

ACTIVE_DELIVERY_STATUSES: Final = frozenset(
    {DELIVERY_SEARCHING, DELIVERY_ACTIVE},
)

TERMINAL_DELIVERY_STATUSES: Final = frozenset(
    {DELIVERY_COMPLETED, DELIVERY_CANCELLED},
)
