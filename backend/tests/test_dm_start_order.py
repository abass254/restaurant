"""Tests for DM agent start_order product resolution."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.catalog.catalog_types import CatalogItem, normalize_ref, platform_ref
from app.services.dm_agent_tools import DmAgentTools


def _catalog_item(name: str, *, item_id: str = "item-1", price: float = 100) -> CatalogItem:
    return CatalogItem(
        ref=platform_ref(item_id),
        source="platform",
        name=name,
        price=Decimal(str(price)),
        stock=5,
        is_active=True,
        platform_inventory_item_id=item_id,
    )


def _tools_with_items(items: list[CatalogItem]) -> DmAgentTools:
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.catalog = MagicMock()

    def _get_catalog_item(ref: str, account_id: str, **kwargs):
        normalized = normalize_ref(ref)
        for item in items:
            if item.ref == normalized or item.inventory_item_id == ref:
                return item
        return None

    tools.catalog.get_catalog_item.side_effect = _get_catalog_item
    return tools


def test_resolve_start_order_item_uses_session_pending_id() -> None:
    tools = _tools_with_items([_catalog_item("Cairo", item_id="cairo-id")])
    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        sales_session={"catalog_pending_item_id": "cairo-id"},
    )
    item, hits, queried = tools._resolve_start_order_item(
        account,
        conversation,
        {"quantity": 1},
    )
    assert item is not None
    assert item.inventory_item_id == "cairo-id"
    assert hits == []
    assert queried is None


def test_resolve_start_order_item_uses_catalog_index() -> None:
    tools = _tools_with_items(
        [
            _catalog_item("Cairo", item_id="cairo-id"),
            _catalog_item("Florence", item_id="florence-id"),
        ],
    )
    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        sales_session={"last_catalog_item_ids": ["cairo-id", "florence-id"]},
    )
    item, _, _ = tools._resolve_start_order_item(
        account,
        conversation,
        {"product_name": "2"},
    )
    assert item is not None
    assert item.inventory_item_id == "florence-id"
