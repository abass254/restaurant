from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal


CatalogSource = Literal["platform", "external"]
PLATFORM_REF_PREFIX = "platform:"
EXTERNAL_REF_PREFIX = "external:"


def platform_ref(inventory_item_id: str) -> str:
    return f"{PLATFORM_REF_PREFIX}{inventory_item_id}"


def external_ref(sku: str) -> str:
    return f"{EXTERNAL_REF_PREFIX}{sku}"


def normalize_ref(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith(PLATFORM_REF_PREFIX) or raw.startswith(EXTERNAL_REF_PREFIX):
        return raw
    return platform_ref(raw)


def platform_inventory_item_id(ref: str | None) -> str | None:
    raw = str(ref or "").strip()
    if raw.startswith(PLATFORM_REF_PREFIX):
        item_id = raw[len(PLATFORM_REF_PREFIX) :].strip()
        return item_id or None
    if raw and ":" not in raw:
        return raw
    return None


def external_sku_from_ref(ref: str | None) -> str | None:
    raw = str(ref or "").strip()
    if raw.startswith(EXTERNAL_REF_PREFIX):
        sku = raw[len(EXTERNAL_REF_PREFIX) :].strip()
        return sku or None
    return None


@dataclass(frozen=True)
class CatalogItem:
    ref: str
    source: CatalogSource
    name: str
    price: Decimal | None
    currency: str = "KES"
    stock: int | None = None
    category: str | None = None
    brand: str | None = None
    description: str | None = None
    image_urls: tuple[str, ...] = ()
    external_sku: str | None = None
    unit: str = "pack"
    is_active: bool = True
    product_type: str = "product"
    platform_inventory_item_id: str | None = None
    platform_product_id: str | None = None

    @property
    def inventory_item_id(self) -> str | None:
        return self.platform_inventory_item_id or platform_inventory_item_id(self.ref)

    @property
    def price_kes(self) -> int:
        if self.price is None:
            return 0
        return int(round(float(self.price)))

    @property
    def primary_image_url(self) -> str | None:
        return self.image_urls[0] if self.image_urls else None

    @property
    def is_service(self) -> bool:
        return str(self.product_type or "product").strip().lower() == "service"


@dataclass(frozen=True)
class CatalogSearchHit:
    item: CatalogItem
    score: float
    match_reasons: tuple[str, ...]
