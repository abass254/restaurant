from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from sqlalchemy.orm import Session, joinedload

from app.models import InventoryItem
from app.services.catalog.catalog_search import match_item_from_text, search_catalog_items
from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit, platform_ref
from app.services.product_media_service import (
    effective_item_image_url,
    inventory_media_for_item,
    is_image_media,
)


class CatalogProvider(Protocol):
    def list_items(self, account_id: str, *, limit: int = 25) -> list[CatalogItem]: ...

    def search(self, account_id: str, query: str, *, limit: int = 8) -> list[CatalogSearchHit]: ...

    def get_item(self, account_id: str, ref: str) -> CatalogItem | None: ...

    def match_product(self, account_id: str, text: str) -> CatalogItem | None: ...

    def check_availability(self, account_id: str, ref: str, quantity: int) -> tuple[bool, int | None]: ...


def inventory_item_to_catalog(item: InventoryItem, *, settings=None) -> CatalogItem | None:
    product = item.product
    if product is None:
        return None
    image_urls: list[str] = []
    seen: set[str] = set()
    for record in inventory_media_for_item(item):
        if not is_image_media(record):
            continue
        url = str(record.get("url") or "").strip()
        if url and url not in seen:
            seen.add(url)
            image_urls.append(url)
    if not image_urls:
        cover = effective_item_image_url(item)
        if cover:
            image_urls.append(cover)
    product_type = str(getattr(product, "product_type", None) or "product").strip().lower()
    if product_type not in {"product", "service"}:
        product_type = "product"
    return CatalogItem(
        ref=platform_ref(str(item.id)),
        source="platform",
        name=(product.name or "Product").strip(),
        price=Decimal(str(item.selling_price or 0)).quantize(Decimal("0.01"))
        if item.selling_price is not None
        else None,
        currency="KES",
        stock=item.stock_quantity,
        category=(product.category or "").strip() or None,
        brand=(product.brand or "").strip() or None,
        description=(product.description or "").strip() or None,
        image_urls=tuple(image_urls),
        external_sku=(product.sku or "").strip() or None,
        unit=(product.unit or "pack").strip() or "pack",
        is_active=bool(
            item.is_active and item.is_saleable() and item.selling_price is not None
        ),
        product_type=product_type,
        platform_inventory_item_id=str(item.id),
        platform_product_id=str(product.id),
    )


class PlatformCatalogProvider:
    def __init__(self, db: Session, settings=None):
        self.db = db
        self.settings = settings

    def _load_rows(self, account_id: str) -> list[InventoryItem]:
        return (
            self.db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(
                InventoryItem.account_id == account_id,
                InventoryItem.is_active.is_(True),
                InventoryItem.selling_price.isnot(None),
                InventoryItem.inventory_role.in_(("for_sale", "both")),
            )
            .order_by(
                InventoryItem.updated_at.is_(None),
                InventoryItem.updated_at.desc(),
                InventoryItem.id.desc(),
            )
            .all()
        )

    def _load_catalog_items(self, account_id: str) -> list[CatalogItem]:
        items: list[CatalogItem] = []
        for row in self._load_rows(account_id):
            catalog_item = inventory_item_to_catalog(row, settings=self.settings)
            if catalog_item is not None:
                items.append(catalog_item)
        return items

    def list_items(self, account_id: str, *, limit: int = 25) -> list[CatalogItem]:
        return self._load_catalog_items(account_id)[: max(1, min(limit, 25))]

    def search(self, account_id: str, query: str, *, limit: int = 8) -> list[CatalogSearchHit]:
        return search_catalog_items(query, self._load_catalog_items(account_id), limit=limit)

    def get_item(self, account_id: str, ref: str) -> CatalogItem | None:
        from app.services.catalog.catalog_types import normalize_ref, platform_inventory_item_id

        normalized = normalize_ref(ref)
        item_id = platform_inventory_item_id(normalized)
        if not item_id:
            return None
        row = (
            self.db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(InventoryItem.id == item_id, InventoryItem.account_id == account_id)
            .first()
        )
        if row is None:
            return None
        return inventory_item_to_catalog(row, settings=self.settings)

    def item_by_id(self, item_id: str, account_id: str) -> InventoryItem | None:
        return (
            self.db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(InventoryItem.id == item_id, InventoryItem.account_id == account_id)
            .first()
        )

    def match_product(self, account_id: str, text: str) -> CatalogItem | None:
        return match_item_from_text(text, self._load_catalog_items(account_id))

    def check_availability(self, account_id: str, ref: str, quantity: int) -> tuple[bool, int | None]:
        item = self.get_item(account_id, ref)
        if item is None or not item.is_active:
            return False, None
        if item.stock is None:
            return True, None
        return quantity <= item.stock, item.stock
