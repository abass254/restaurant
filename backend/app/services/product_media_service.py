"""Store-scoped product media and platform primary image helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urljoin

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InventoryItem, Product

_VIDEO_EXTENSIONS = (".mp4", ".mov", ".webm")


def coerce_media(value: Any) -> list[dict[str, Any]]:
    """Defensive parse — older rows may have NULL or a non-list value."""
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict) and v.get("url")]
    return []


def is_image_media(record: dict[str, Any]) -> bool:
    content_type = str(record.get("content_type") or "")
    if content_type:
        return content_type.startswith("image/")
    url = str(record.get("url") or "").lower()
    return not any(url.endswith(ext) for ext in _VIDEO_EXTENSIONS)


def pick_default_primary_url(media_items: list[dict[str, Any]]) -> str | None:
    """Pick the earliest-uploaded image from a flat media list."""
    images = [m for m in media_items if is_image_media(m)]
    if not images:
        return None
    images.sort(key=lambda m: str(m.get("uploaded_at") or ""))
    return str(images[0]["url"])


def collect_store_media(db: Session, product_id: str) -> list[dict[str, Any]]:
    """All media records contributed by every shop carrying ``product_id``."""
    rows = (
        db.query(InventoryItem)
        .filter(InventoryItem.product_id == product_id)
        .order_by(InventoryItem.updated_at.desc(), InventoryItem.id.desc())
        .all()
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        for record in coerce_media(row.media):
            enriched = dict(record)
            enriched["account_id"] = row.account_id
            enriched["inventory_item_id"] = row.id
            out.append(enriched)
    return out


def media_url_in_product_pool(db: Session, product_id: str, url: str) -> bool:
    return any(m.get("url") == url for m in collect_store_media(db, product_id))


def inventory_media_for_item(item: InventoryItem) -> list[dict[str, Any]]:
    return coerce_media(item.media)


def absolute_media_url(path: str, settings: Settings, *, for_instagram: bool = False) -> str:
    """Turn a stored upload path into a URL Instagram (and browsers) can fetch."""
    if not path:
        return ""
    if path.startswith(("http://", "https://")):
        return path
    if path.startswith("/"):
        uploads_base = (settings.uploads_public_base_url or "").rstrip("/")
        if path.startswith("/uploads/") and uploads_base:
            # Production media host (this platform may run against prod data
            # while APP_URL/FRONTEND_URL stay on localhost).
            base = uploads_base
        elif for_instagram and path.startswith("/uploads/"):
            # Served by FastAPI's static mount — use the API origin so Meta's
            # crawler hits the file directly instead of a frontend proxy layer.
            base = (settings.app_url or settings.frontend_url or "").rstrip("/")
        else:
            base = (settings.frontend_url or settings.app_url or "").rstrip("/")
        if base:
            return urljoin(base + "/", path.lstrip("/"))
    return path


def effective_item_image_url(item: InventoryItem) -> str | None:
    """Best thumbnail for a shop's inventory row: own media first, then platform."""
    for record in inventory_media_for_item(item):
        if is_image_media(record):
            return str(record["url"])
    product = item.product
    if product and product.image_url:
        return str(product.image_url)
    return None


def sync_product_primary_image(db: Session, product: Product) -> None:
    """Refresh the platform primary image when it is not admin-locked."""
    if product.primary_image_locked:
        return
    product.image_url = pick_default_primary_url(collect_store_media(db, product.id))


def after_inventory_media_change(db: Session, product_id: str) -> Product | None:
    """Call after uploads/deletes so the platform primary stays in sync."""
    product = db.get(Product, product_id)
    if product is None:
        return None
    sync_product_primary_image(db, product)
    product.updated_at = datetime.utcnow()
    return product
