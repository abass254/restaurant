"""Tests for Phase 1 DM agent tools + sales closer tools."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit, platform_ref
from app.services.dm_agent_tools import AGENT_TOOL_DEFINITIONS, DmAgentTools
from app.services.dm_bot_registry import DM_BOT_CATALOG


def _catalog_item(
    name: str,
    *,
    item_id: str = "item-1",
    product_type: str = "product",
    category: str = "perfume",
    brand: str = "Maison",
    stock: int = 4,
    price: str = "1200",
) -> CatalogItem:
    return CatalogItem(
        ref=platform_ref(item_id),
        source="platform",
        name=name,
        price=Decimal(price),
        stock=stock,
        category=category,
        brand=brand,
        description="Fresh scent",
        image_urls=("https://example.com/1.jpg", "https://example.com/2.jpg"),
        is_active=True,
        product_type=product_type,
        platform_inventory_item_id=item_id,
    )


def test_agent_tool_definitions_include_phase1_and_closer_tools():
    names = {tool["name"] for tool in AGENT_TOOL_DEFINITIONS}
    assert {
        "get_customer_orders",
        "get_order_by_number",
        "get_inventory_summary",
        "get_product_details",
        "get_shop_info",
        "recommend_products",
        "amend_order",
    } <= names


def test_ai_agent_registry_does_not_claim_mpesa_stk():
    ai = next(bot for bot in DM_BOT_CATALOG if bot.id == "ai_agent")
    joined = " ".join(ai.capabilities).lower()
    assert "m-pesa stk" not in joined
    assert "recommendations" in joined


def test_product_payload_includes_product_type_and_description():
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.catalog = MagicMock()
    tools.catalog.provider_for_account.return_value = MagicMock(
        item_by_id=lambda *_a, **_k: SimpleNamespace(
            stock_quantity=4,
            low_stock_threshold=5,
            is_low_stock=lambda: True,
        ),
    )
    account = SimpleNamespace(account_id="merchant-1")
    item = _catalog_item("Cairo", product_type="service")

    payload = tools._product_payload(item, account=account, include_description=True)
    assert payload["product_type"] == "service"
    assert payload["brand"] == "Maison"
    assert payload["category"] == "perfume"
    assert payload["description"] == "Fresh scent"
    assert payload["image_count"] == 2
    assert payload["is_low_stock"] is True
    assert payload["is_out_of_stock"] is False


def test_get_product_details_returns_rich_payload():
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    tools.db.commit = MagicMock()
    item = _catalog_item("Cairo", item_id="cairo-id")
    tools._resolve_item = MagicMock(return_value=item)
    tools.catalog = MagicMock()
    tools.catalog.provider_for_account.return_value = MagicMock(
        item_by_id=lambda *_a, **_k: SimpleNamespace(
            stock_quantity=4,
            low_stock_threshold=5,
            is_low_stock=lambda: True,
        ),
    )

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(sales_session={})
    message = SimpleNamespace()

    with patch("app.services.dm_agent_tools.merge_sales_session"):
        result = tools._get_product_details(
            {"inventory_item_id": "cairo-id"},
            account=account,
            conversation=conversation,
            message=message,
        )
    assert result["ok"] is True
    assert result["product"]["name"] == "Cairo"
    assert result["product"]["product_type"] == "product"
    assert result["product"]["image_urls"] == [
        "https://example.com/1.jpg",
        "https://example.com/2.jpg",
    ]
    assert "order/book" in result["hint"]


def test_get_shop_info_returns_shop_dict():
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    account = SimpleNamespace(account_id="merchant-1")
    with patch(
        "app.services.dm_agent_tools.build_shop_info_dict",
        return_value={
            "business_name": "Spice House",
            "business_location": "Westlands",
            "accepting_orders": True,
            "store_status": "open",
            "delivery_fee_per_km": 50.0,
        },
    ):
        result = tools._get_shop_info(
            {},
            account=account,
            conversation=SimpleNamespace(),
            message=SimpleNamespace(),
        )
    assert result["ok"] is True
    assert result["business_name"] == "Spice House"
    assert result["delivery_fee_per_km"] == 50.0


def test_recommend_products_returns_ranked_options_with_why():
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    tools.db.commit = MagicMock()
    tools.catalog = MagicMock()
    tools.catalog.provider_for_account.return_value = MagicMock(
        item_by_id=lambda *_a, **_k: SimpleNamespace(
            stock_quantity=4,
            low_stock_threshold=5,
            is_low_stock=lambda: False,
        ),
    )
    items = [
        _catalog_item("Cairo", item_id="a", price="1500"),
        _catalog_item("Florence", item_id="b", price="1800", stock=2),
        _catalog_item("Rome", item_id="c", price="900"),
    ]
    tools.catalog.search_products.return_value = [
        CatalogSearchHit(item=items[0], score=3.0, match_reasons=("name",)),
        CatalogSearchHit(item=items[1], score=2.0, match_reasons=("category",)),
        CatalogSearchHit(item=items[2], score=1.5, match_reasons=("name",)),
    ]

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(sales_session={})
    with patch("app.services.dm_agent_tools.merge_sales_session") as merge:
        result = tools._recommend_products(
            {"need": "perfume gift", "budget_kes": 2000, "limit": 3},
            account=account,
            conversation=conversation,
            message=SimpleNamespace(),
        )

    assert result["ok"] is True
    assert result["count"] == 3
    assert all("why_this_fits" in row for row in result["recommendations"])
    assert all(row["price_kes"] <= 2000 for row in result["recommendations"])
    assert result["recommendations"][0]["suggestion_number"] == 1
    merge.assert_called_once()
    assert "top pick" in result["hint"]


def test_amend_order_updates_quantity_when_placed():
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    tools.db.commit = MagicMock()
    tools.db.refresh = MagicMock()
    tools.db.add = MagicMock()
    tools.support_tickets = MagicMock()
    tools.support_tickets.get_current_ticket.return_value = None
    tools.orders = MagicMock()

    line = SimpleNamespace(
        inventory_item_id="pen-id",
        product_name="Fresh Series Pen",
        quantity=1,
        unit_price=Decimal("99.00"),
        line_total=Decimal("99.00"),
        updated_at=None,
    )
    order = SimpleNamespace(
        id="ord-1",
        order_number="ORD-000040",
        status="placed",
        items=[line],
        delivery_fee=Decimal("0"),
        discount=Decimal("0"),
        subtotal=Decimal("99.00"),
        total=Decimal("99.00"),
        updated_at=None,
        account_id="merchant-1",
    )
    tools.orders.order_for_session.return_value = order
    tools._resolve_amend_target_order = MagicMock(return_value=order)

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(id="conv-1", sales_session={"order_id": "ord-1"})

    with patch("app.services.dm_agent_tools.deduct_stock") as deduct:
        result = tools._amend_order(
            {"quantity": 5},
            account=account,
            conversation=conversation,
            message=SimpleNamespace(),
        )

    assert result["ok"] is True
    assert result["amended"] is True
    assert result["quantity"] == 5
    assert result["previous_quantity"] == 1
    assert result["total_kes"] == 495
    assert line.quantity == 5
    deduct.assert_called_once()
    tools.db.commit.assert_called()


def test_amend_order_not_amendable_when_being_prepared():
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    tools.support_tickets = MagicMock()
    tools.orders = MagicMock()

    line = SimpleNamespace(
        inventory_item_id="pen-id",
        product_name="Fresh Series Pen",
        quantity=1,
        unit_price=Decimal("99.00"),
        line_total=Decimal("99.00"),
    )
    order = SimpleNamespace(
        id="ord-1",
        order_number="ORD-000040",
        status="being_prepared",
        items=[line],
        total=Decimal("99.00"),
    )
    tools._resolve_amend_target_order = MagicMock(return_value=order)

    result = tools._amend_order(
        {"quantity": 5},
        account=SimpleNamespace(account_id="merchant-1"),
        conversation=SimpleNamespace(id="conv-1", sales_session={}),
        message=SimpleNamespace(),
    )

    assert result["ok"] is False
    assert result["error"] == "not_amendable"
    assert result["extra_quantity"] == 4
    assert "place_extra_order" in result["options"]
    assert "escalate_to_human" in result["options"]
    assert "Do NOT claim" in result["hint"]
