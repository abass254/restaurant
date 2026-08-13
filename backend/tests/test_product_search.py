"""Product search scoring for DM agent suggestions."""

from __future__ import annotations

from decimal import Decimal

from app.services.catalog.catalog_search import match_item_from_text, search_catalog_items
from app.services.catalog.catalog_types import CatalogItem, platform_ref
from app.services.dm_catalog_service import DmCatalogService


def _catalog_item(name: str, *, category: str = "", brand: str = "", price: float = 100) -> CatalogItem:
    return CatalogItem(
        ref=platform_ref(f"id-{name}"),
        source="platform",
        name=name,
        price=Decimal(str(price)),
        category=category or None,
        brand=brand or None,
        stock=5,
        platform_inventory_item_id=f"id-{name}",
    )


def test_search_returns_multiple_sprays():
    items = [
        _catalog_item("Ocean Breeze Body Spray", category="body spray"),
        _catalog_item("Vanilla Mist Hair Spray", category="hair spray"),
        _catalog_item("Fresh Linen Room Spray", category="room spray"),
        _catalog_item("Chocolate Bar", category="snacks"),
    ]
    hits = search_catalog_items("spray", items, limit=8)
    names = [hit.item.name for hit in hits]
    assert len(hits) == 3
    assert "Chocolate Bar" not in names


def test_match_does_not_auto_pick_ambiguous_category():
    items = [
        _catalog_item("Ocean Breeze Body Spray", category="body spray"),
        _catalog_item("Vanilla Mist Hair Spray", category="hair spray"),
    ]
    assert match_item_from_text("spray", items) is None


def test_match_picks_exact_name():
    items = [
        _catalog_item("Ocean Breeze Body Spray", category="body spray"),
        _catalog_item("Vanilla Mist Hair Spray", category="hair spray"),
    ]
    matched = match_item_from_text("Vanilla Mist Hair Spray", items)
    assert matched is not None
    assert matched.name == "Vanilla Mist Hair Spray"


def test_ambiguous_suggestions_include_category():
    items = [
        _catalog_item("Ocean Breeze Body Spray", category="body spray", brand="Duk"),
        _catalog_item("Vanilla Mist Hair Spray", category="hair spray", brand="Duk"),
    ]
    hits = search_catalog_items("spray", items, limit=8)
    suggestions = DmCatalogService._ambiguous_product_suggestions(hits)
    assert len(suggestions) == 2
    assert suggestions[0]["category"] == "body spray"
