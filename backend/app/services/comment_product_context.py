"""Product context for AI replies on Instagram post comments."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import InventoryItem, SocialPostLink
from app.services.catalog.catalog_types import CatalogItem
from app.services.dm_catalog_service import DmCatalogService


def load_linked_inventory_items(
    db: Session,
    *,
    merchant_account_id: str,
    post_id: str,
    platform: str = "instagram",
) -> list[InventoryItem]:
    rows = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .join(SocialPostLink, InventoryItem.id == SocialPostLink.inventory_item_id)
        .filter(
            SocialPostLink.account_id == merchant_account_id,
            SocialPostLink.platform == platform,
            SocialPostLink.external_post_id == post_id,
            InventoryItem.is_active.is_(True),
        )
        .order_by(InventoryItem.updated_at.desc().nullslast(), InventoryItem.id.asc())
        .all()
    )
    return [item for item in rows if item.product is not None]


def _product_dict(item: InventoryItem | CatalogItem) -> dict[str, Any]:
    if isinstance(item, CatalogItem):
        return {
            "inventory_item_id": item.inventory_item_id,
            "name": item.name,
            "category": item.category,
            "brand": item.brand,
            "price_kes": item.price_kes,
            "stock": item.stock,
            "unit": item.unit,
        }
    product = item.product
    assert product is not None
    return {
        "inventory_item_id": item.id,
        "name": (product.name or "Product").strip(),
        "category": (product.category or "").strip() or None,
        "brand": (product.brand or "").strip() or None,
        "price_kes": int(round(float(item.selling_price or 0))),
        "stock": item.stock_quantity,
        "unit": (product.unit or "pack").strip() or "pack",
    }


def linked_product_catalog(
    db: Session,
    *,
    merchant_account_id: str,
    post_id: str,
    platform: str = "instagram",
) -> list[dict[str, Any]]:
    """Products explicitly linked to this post in the Feeds UI."""
    items = load_linked_inventory_items(
        db,
        merchant_account_id=merchant_account_id,
        post_id=post_id,
        platform=platform,
    )
    return [_product_dict(item) for item in items]


def search_linked_products(
    items: list[InventoryItem],
    query: str,
    *,
    limit: int = 8,
) -> list[dict[str, Any]]:
    hits = DmCatalogService._search_items(query, items, limit=limit)
    results: list[dict[str, Any]] = []
    for index, hit in enumerate(hits, start=1):
        payload = _product_dict(hit.item)
        payload["matched_on"] = list(hit.match_reasons)
        payload["suggestion_number"] = index
        results.append(payload)
    return results


def search_shop_products(
    catalog: DmCatalogService,
    merchant_account_id: str,
    query: str,
    *,
    limit: int = 8,
    linked_item_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    hits = catalog.search_products(merchant_account_id, query, limit=limit)
    results: list[dict[str, Any]] = []
    for index, hit in enumerate(hits, start=1):
        if linked_item_ids and hit.item.inventory_item_id in linked_item_ids:
            continue
        payload = _product_dict(hit.item)
        payload["matched_on"] = list(hit.match_reasons)
        payload["suggestion_number"] = index
        results.append(payload)
    return results[:limit]


def detect_mentioned_products(
    comment_text: str,
    linked_products: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Heuristic: names from linked products that appear in the comment."""
    lowered = (comment_text or "").lower()
    if not lowered.strip():
        return []

    mentioned: list[dict[str, Any]] = []
    for product in linked_products:
        name = str(product.get("name") or "").strip()
        if not name:
            continue
        name_lower = name.lower()
        if name_lower in lowered:
            mentioned.append({**product, "matched_on": ["exact_name"]})
            continue
        tokens = [part for part in re.split(r"[^a-z0-9]+", name_lower) if len(part) >= 4]
        if any(token in lowered for token in tokens):
            mentioned.append({**product, "matched_on": ["name_token"]})
    return mentioned
