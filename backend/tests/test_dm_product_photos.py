"""Tests for single-product photo delivery in DM."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.dm_agent_tools import DmAgentTools
from app.services.dm_catalog_service import DmCatalogService


def _item(
    name: str,
    *,
    item_id: str = "item-1",
    media: list[dict] | None = None,
    cover: str | None = None,
):
    product = SimpleNamespace(
        name=name,
        category="Beauty",
        brand="",
        unit="pack",
        image_url=cover,
    )
    return SimpleNamespace(
        id=item_id,
        product=product,
        media=media or [],
        selling_price=599,
        stock_quantity=10,
        is_active=True,
    )


def test_product_image_urls_uses_shop_gallery_only() -> None:
    service = DmCatalogService(MagicMock(), MagicMock(frontend_url="https://shop.test"), MagicMock())
    item = _item(
        "Table Mirror",
        media=[
            {"url": "/uploads/mirror-1.jpg", "content_type": "image/jpeg"},
            {"url": "/uploads/mirror-2.jpg", "content_type": "image/jpeg"},
            {"url": "/uploads/clip.mp4", "content_type": "video/mp4"},
        ],
    )
    urls = service._product_image_urls(item)
    assert len(urls) == 2
    assert all(url.startswith("https://shop.test/") for url in urls)


def test_product_image_urls_falls_back_to_platform_cover() -> None:
    service = DmCatalogService(MagicMock(), MagicMock(frontend_url="https://shop.test"), MagicMock())
    item = _item("Table Mirror", cover="/uploads/cover.jpg")
    urls = service._product_image_urls(item)
    assert urls == ["https://shop.test/uploads/cover.jpg"]


@patch.object(DmCatalogService, "_deliver")
def test_send_product_photos_delivers_only_requested_item(mock_deliver: MagicMock) -> None:
    mock_deliver.return_value = ("sent", 2)
    service = DmCatalogService(MagicMock(), MagicMock(frontend_url="https://shop.test"), MagicMock())
    item = _item(
        "Starlight Table Mirror",
        media=[{"url": "/uploads/mirror.jpg", "content_type": "image/jpeg"}],
    )
    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(id="conv-1", participant_ig_id="cust-1")

    result = service.send_product_photos(account, conversation, item)

    assert result.photos_sent is True
    assert result.image_count == 1
    assert result.product_name == "Starlight Table Mirror"
    steps = mock_deliver.call_args[0][2]
    assert steps[0].kind == "text"
    assert "Starlight Table Mirror" in steps[0].body
    assert steps[1].kind == "image"
    assert steps[1].body.startswith("https://shop.test/")


def test_resolve_photo_item_uses_last_discussed_id() -> None:
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.catalog = MagicMock()
    mirror = _item("Table Mirror", item_id="mirror-id")
    tools.catalog.item_by_id.return_value = mirror

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        sales_session={"last_discussed_item_id": "mirror-id"},
    )
    item = tools._resolve_photo_item(account, conversation, {})
    assert item is not None
    assert item.id == "mirror-id"


def test_build_system_prompt_mentions_product_photos_tool() -> None:
    from app.services.dm_agent_service import build_system_prompt

    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={},
    )
    prompt = build_system_prompt(account)
    assert "send_product_photos" in prompt
    assert "Never use send_product_catalog for photo requests" in prompt
