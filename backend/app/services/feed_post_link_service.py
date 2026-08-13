"""Link social feed posts to merchant inventory items."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.models import InventoryItem, SocialPostLink
from app.services.product_media_service import effective_item_image_url


def linked_inventory_payload(item: InventoryItem) -> dict[str, Any]:
    product = item.product
    return {
        "inventory_item_id": item.id,
        "product_id": item.product_id,
        "product_name": product.name if product else "",
        "product_code": product.product_code if product else None,
        "selling_price": float(item.selling_price) if item.selling_price is not None else None,
        "image_url": effective_item_image_url(item),
    }


def list_linked_inventory_for_post(
    db: Session,
    *,
    account_id: str,
    platform: str,
    external_post_id: str,
) -> list[dict[str, Any]]:
    rows = (
        db.query(SocialPostLink)
        .options(joinedload(SocialPostLink.inventory_item).joinedload(InventoryItem.product))
        .filter(
            SocialPostLink.account_id == account_id,
            SocialPostLink.platform == platform,
            SocialPostLink.external_post_id == external_post_id,
        )
        .order_by(SocialPostLink.created_at.asc(), SocialPostLink.id.asc())
        .all()
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        if row.inventory_item is not None:
            out.append(linked_inventory_payload(row.inventory_item))
    return out


def enrich_posts_with_links(
    db: Session,
    account_id: str,
    platform: str,
    posts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not posts:
        return posts

    post_ids = [str(post.get("id") or "") for post in posts if post.get("id")]
    if not post_ids:
        return [{**post, "linked_inventory": []} for post in posts]

    rows = (
        db.query(SocialPostLink)
        .options(joinedload(SocialPostLink.inventory_item).joinedload(InventoryItem.product))
        .filter(
            SocialPostLink.account_id == account_id,
            SocialPostLink.platform == platform,
            SocialPostLink.external_post_id.in_(post_ids),
        )
        .order_by(SocialPostLink.created_at.asc(), SocialPostLink.id.asc())
        .all()
    )
    by_post_id: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row.inventory_item is None:
            continue
        by_post_id.setdefault(row.external_post_id, []).append(
            linked_inventory_payload(row.inventory_item),
        )

    enriched: list[dict[str, Any]] = []
    for post in posts:
        payload = {
            **post,
            "linked_inventory": by_post_id.get(str(post.get("id") or ""), []),
        }
        enriched.append(payload)
    return enriched


def _get_owned_inventory_item(
    db: Session,
    account_id: str,
    inventory_item_id: str,
) -> InventoryItem:
    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.id == inventory_item_id,
            InventoryItem.account_id == account_id,
        )
        .first()
    )
    if item is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found.",
        )
    return item


def add_post_link(
    db: Session,
    *,
    account_id: str,
    platform: str,
    external_post_id: str,
    inventory_item_id: str,
) -> list[dict[str, Any]]:
    if not external_post_id.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="A valid post id is required.",
        )

    item = _get_owned_inventory_item(db, account_id, inventory_item_id)
    existing = (
        db.query(SocialPostLink)
        .filter(
            SocialPostLink.account_id == account_id,
            SocialPostLink.platform == platform,
            SocialPostLink.external_post_id == external_post_id,
            SocialPostLink.inventory_item_id == item.id,
        )
        .first()
    )
    if existing is None:
        now = datetime.utcnow()
        db.add(
            SocialPostLink(
                account_id=account_id,
                platform=platform,
                external_post_id=external_post_id,
                inventory_item_id=item.id,
                created_at=now,
                updated_at=now,
            ),
        )
        db.commit()

    return list_linked_inventory_for_post(
        db,
        account_id=account_id,
        platform=platform,
        external_post_id=external_post_id,
    )


def add_post_links(
    db: Session,
    *,
    account_id: str,
    platform: str,
    external_post_id: str,
    inventory_item_ids: list[str],
) -> list[dict[str, Any]]:
    if not external_post_id.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="A valid post id is required.",
        )

    deduped_ids = list(dict.fromkeys(inventory_item_ids))
    if not deduped_ids:
        return list_linked_inventory_for_post(
            db,
            account_id=account_id,
            platform=platform,
            external_post_id=external_post_id,
        )

    now = datetime.utcnow()
    for inventory_item_id in deduped_ids:
        item = _get_owned_inventory_item(db, account_id, inventory_item_id)
        existing = (
            db.query(SocialPostLink)
            .filter(
                SocialPostLink.account_id == account_id,
                SocialPostLink.platform == platform,
                SocialPostLink.external_post_id == external_post_id,
                SocialPostLink.inventory_item_id == item.id,
            )
            .first()
        )
        if existing is None:
            db.add(
                SocialPostLink(
                    account_id=account_id,
                    platform=platform,
                    external_post_id=external_post_id,
                    inventory_item_id=item.id,
                    created_at=now,
                    updated_at=now,
                ),
            )

    db.commit()
    return list_linked_inventory_for_post(
        db,
        account_id=account_id,
        platform=platform,
        external_post_id=external_post_id,
    )


def remove_post_link(
    db: Session,
    *,
    account_id: str,
    platform: str,
    external_post_id: str,
    inventory_item_id: str,
) -> list[dict[str, Any]]:
    link = (
        db.query(SocialPostLink)
        .filter(
            SocialPostLink.account_id == account_id,
            SocialPostLink.platform == platform,
            SocialPostLink.external_post_id == external_post_id,
            SocialPostLink.inventory_item_id == inventory_item_id,
        )
        .first()
    )
    if link is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="This product is not linked to the post.",
        )
    db.delete(link)
    db.commit()
    return list_linked_inventory_for_post(
        db,
        account_id=account_id,
        platform=platform,
        external_post_id=external_post_id,
    )
