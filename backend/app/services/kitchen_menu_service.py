"""Daily reset for restaurant menu availability."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import Account, Catalogue, InventoryItem
from app.support.datetime_utils import utc_now

logger = logging.getLogger(__name__)
NAIROBI = ZoneInfo("Africa/Nairobi")
MENU_CATEGORIES = (
    "food_beverage",
    "food_&_beverage",
    "hotel_menu",
    "hotel",
)


def supports_recipe(product_type: str | None, category: str | None) -> bool:
    """Recipes belong to meals and categorized food menu items, not combos or add-ons."""
    if product_type == "meal":
        return True
    normalized_category = "_".join((category or "").strip().lower().split())
    return product_type not in ("combo", "addon", "service") and normalized_category in MENU_CATEGORIES


def deactivate_restaurant_menus(db: Session) -> int:
    """Pause every active restaurant menu item and return the number changed."""
    category = func.replace(func.lower(func.trim(Catalogue.category)), " ", "_")
    rows = (
        db.query(InventoryItem)
        .join(Account, Account.id == InventoryItem.account_id)
        .join(Catalogue, Catalogue.id == InventoryItem.product_id)
        .filter(
            func.lower(func.trim(Account.store_type)) == "restaurant",
            InventoryItem.is_active.is_(True),
            or_(
                Catalogue.product_type.in_(("meal", "combo", "addon")),
                category.in_(MENU_CATEGORIES),
            ),
        )
        .all()
    )
    if not rows:
        return 0

    now = utc_now()
    for item in rows:
        item.is_active = False
        item.updated_at = now
    db.commit()
    return len(rows)


def _deactivate_in_thread() -> int:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        return deactivate_restaurant_menus(db)
    finally:
        db.close()


async def run_daily_menu_reset() -> None:
    """Deactivate restaurant menus at midnight Africa/Nairobi time each day."""
    while True:
        now = datetime.now(NAIROBI)
        next_day = now.date() + timedelta(days=1)
        next_midnight = datetime.combine(next_day, time.min, tzinfo=NAIROBI)
        await asyncio.sleep((next_midnight - now).total_seconds())
        try:
            changed = await asyncio.to_thread(_deactivate_in_thread)
            logger.info("Daily restaurant menu reset paused %s menu items", changed)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Daily restaurant menu reset failed")
