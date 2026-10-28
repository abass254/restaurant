"""Tests for comment product context on linked post inventory."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.comment_product_context import detect_mentioned_products
from app.services.dm_catalog_service import DmCatalogService


def _linked_product(name: str, *, category: str = "", price: float = 100):
    return {
        "inventory_item_id": f"id-{name}",
        "name": name,
        "category": category or None,
        "brand": None,
        "price_kes": int(price),
        "stock": 5,
        "unit": "pack",
    }


def test_detect_mentioned_products_by_name_fragment():
    products = [
        _linked_product("Ocean Breeze Body Spray", category="body spray"),
        _linked_product("Vanilla Hair Spray", category="hair spray"),
    ]
    mentioned = detect_mentioned_products("How much is the body spray?", products)
    assert len(mentioned) >= 1
    assert any("Body Spray" in m["name"] for m in mentioned)


def test_search_linked_products_finds_multiple_sprays():
    items = [
        SimpleNamespace(
            id="1",
            selling_price=850,
            stock_quantity=3,
            media=[],
            is_active=True,
            is_saleable=lambda: True,
            product=SimpleNamespace(
                id="product-1",
                name="Ocean Breeze Body Spray",
                category="body spray",
                brand="Duk",
                unit="pack",
                description="",
                image_url=None,
                sku=None,
            ),
        ),
        SimpleNamespace(
            id="2",
            selling_price=720,
            stock_quantity=2,
            media=[],
            is_active=True,
            is_saleable=lambda: True,
            product=SimpleNamespace(
                id="product-2",
                name="Vanilla Hair Spray",
                category="hair spray",
                brand="Duk",
                unit="pack",
                description="",
                image_url=None,
                sku=None,
            ),
        ),
    ]
    from app.services.comment_product_context import search_linked_products

    results = search_linked_products(items, "spray", limit=6)
    assert len(results) == 2


def test_normalize_comment_webhook_payload():
    from app.services.webhook_payload import InstagramWebhookPayload

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "178414",
                "changes": [
                    {
                        "field": "comments",
                        "value": {
                            "id": "comment123",
                            "text": "Price for the spray?",
                            "from": {"id": "user1", "username": "buyer"},
                            "media": {"id": "post456"},
                        },
                    },
                ],
            },
        ],
    }
    events = InstagramWebhookPayload.comment_events(payload)
    assert len(events) == 1
    assert events[0]["comment"]["post_id"] == "post456"
    assert events[0]["comment"]["text"] == "Price for the spray?"
