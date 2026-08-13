"""Tests for deterministic DM order confirmation."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from decimal import Decimal

from app.services.catalog.catalog_types import CatalogItem, platform_ref
from app.services.dm_agent_service import DmAgentService, build_system_prompt
from app.services.dm_agent_tools import DmAgentTools
from app.services.dm_templates import is_order_confirm_yes
from app.support.dm_order_intent import parse_suggestion_pick, resolve_pending_order_item_id
from app.support.sales_session import STEP_AWAITING_ORDER_CONFIRM


def test_parse_suggestion_pick_option_phrases() -> None:
    assert parse_suggestion_pick("Lets go with option 1") == 1
    assert parse_suggestion_pick("go with 2") == 2
    assert parse_suggestion_pick("option 3 please") == 3


def test_resolve_pending_order_item_from_recent_pick() -> None:
    session = {
        "last_suggested_item_ids": ["pen-1", "pen-2", "pen-3"],
    }
    item_id = resolve_pending_order_item_id(
        session,
        recent_customer_messages=["Are they in stock?", "Lets go with option 1"],
    )
    assert item_id == "pen-1"


def test_is_order_confirm_yes_matches_plain_yes() -> None:
    assert is_order_confirm_yes("Yes")
    assert is_order_confirm_yes("yes please")
    assert is_order_confirm_yes("ndio")


def test_start_order_is_idempotent_when_already_awaiting_confirm() -> None:
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    item = CatalogItem(
        ref=platform_ref("pen-id"),
        source="platform",
        name="Gel Pen",
        price=Decimal("99"),
        stock=5,
        is_active=True,
        platform_inventory_item_id="pen-id",
    )
    tools.catalog = MagicMock()
    tools._resolve_start_order_item = MagicMock(return_value=(item, [], None))
    tools._available_products_snapshot = MagicMock(return_value=[])
    tools.orders = MagicMock()
    tools.orders.order_for_session.return_value = None

    account = SimpleNamespace(account_id="merchant-1", onboarding_checks={})
    conversation = SimpleNamespace(
        id="conv-1",
        sales_session={
            "step": STEP_AWAITING_ORDER_CONFIRM,
            "catalog_pending_item_id": "pen-id",
            "catalog_pending_item_ref": platform_ref("pen-id"),
            "catalog_pending_quantity": 1,
        },
    )
    result = tools._start_order(
        {"inventory_item_id": "pen-id"},
        account=account,
        conversation=conversation,
        message=SimpleNamespace(body="yes"),
    )
    assert result["ok"] is True
    assert result["already_awaiting_confirmation"] is True
    assert result["quantity"] == 1
    assert "confirm_order" in result["hint"]
    tools.db.commit.assert_not_called()


def test_start_order_uses_session_quantity_over_default_one() -> None:
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    item = CatalogItem(
        ref=platform_ref("pen-id"),
        source="platform",
        name="Gel Pen",
        price=Decimal("99"),
        stock=15,
        is_active=True,
        platform_inventory_item_id="pen-id",
    )
    tools.catalog = MagicMock()
    tools._resolve_start_order_item = MagicMock(return_value=(item, [], None))
    tools._available_products_snapshot = MagicMock(return_value=[])
    tools.orders = MagicMock()
    tools.orders.order_for_session.return_value = None

    account = SimpleNamespace(account_id="merchant-1", onboarding_checks={})
    conversation = SimpleNamespace(
        id="conv-1",
        sales_session={
            "catalog_pending_quantity": 2,
        },
    )
    with patch("app.services.dm_agent_tools.merge_sales_session") as merge:
        with patch(
            "app.services.dm_agent_tools.inventory_integration_from_account",
            return_value=SimpleNamespace(external=None),
        ):
            result = tools._start_order(
                {"inventory_item_id": "pen-id", "quantity": 1},
                account=account,
                conversation=conversation,
                message=SimpleNamespace(body="I want 2 pens"),
            )

    assert result["ok"] is True
    assert result["quantity"] == 2
    assert result["total_kes"] == 198
    merge.assert_called()
    assert merge.call_args.kwargs.get("catalog_pending_quantity") == 2


def test_start_order_updates_quantity_when_already_awaiting_confirm() -> None:
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    item = CatalogItem(
        ref=platform_ref("pen-id"),
        source="platform",
        name="Gel Pen",
        price=Decimal("99"),
        stock=15,
        is_active=True,
        platform_inventory_item_id="pen-id",
    )
    tools.catalog = MagicMock()
    tools._resolve_start_order_item = MagicMock(return_value=(item, [], None))
    tools._available_products_snapshot = MagicMock(return_value=[])
    tools.orders = MagicMock()
    tools.orders.order_for_session.return_value = None

    account = SimpleNamespace(account_id="merchant-1", onboarding_checks={})
    conversation = SimpleNamespace(
        id="conv-1",
        sales_session={
            "step": STEP_AWAITING_ORDER_CONFIRM,
            "catalog_pending_item_id": "pen-id",
            "catalog_pending_item_ref": platform_ref("pen-id"),
            "catalog_pending_quantity": 1,
        },
    )
    with patch("app.services.dm_agent_tools.merge_sales_session") as merge:
        with patch(
            "app.services.dm_agent_tools.inventory_integration_from_account",
            return_value=SimpleNamespace(external=None),
        ):
            result = tools._start_order(
                {"inventory_item_id": "pen-id", "quantity": 2},
                account=account,
                conversation=conversation,
                message=SimpleNamespace(body="make it 2"),
            )

    assert result["ok"] is True
    assert result["already_awaiting_confirmation"] is True
    assert result["quantity"] == 2
    merge.assert_called()
    tools.db.commit.assert_called()


def test_start_order_parses_quantity_from_customer_message() -> None:
    tools = DmAgentTools.__new__(DmAgentTools)
    tools.db = MagicMock()
    item = CatalogItem(
        ref=platform_ref("pen-id"),
        source="platform",
        name="Gel Pen",
        price=Decimal("99"),
        stock=15,
        is_active=True,
        platform_inventory_item_id="pen-id",
    )
    tools.catalog = MagicMock()
    tools._resolve_start_order_item = MagicMock(return_value=(item, [], None))
    tools._available_products_snapshot = MagicMock(return_value=[])
    tools.orders = MagicMock()
    tools.orders.order_for_session.return_value = None

    account = SimpleNamespace(account_id="merchant-1", onboarding_checks={})
    conversation = SimpleNamespace(id="conv-1", sales_session={})
    with patch("app.services.dm_agent_tools.merge_sales_session") as merge:
        with patch(
            "app.services.dm_agent_tools.inventory_integration_from_account",
            return_value=SimpleNamespace(external=None),
        ):
            result = tools._start_order(
                {"inventory_item_id": "pen-id", "quantity": 1},
                account=account,
                conversation=conversation,
                message=SimpleNamespace(body="two pens please"),
            )

    assert result["ok"] is True
    assert result["quantity"] == 2
    assert merge.call_args.kwargs.get("catalog_pending_quantity") == 2


@patch("app.services.dm_agent_service.merge_sales_session")
@patch.object(DmAgentService, "_send_outbound")
def test_deterministic_confirm_places_order_on_yes(
    mock_send: MagicMock,
    mock_merge: MagicMock,
) -> None:
    service = DmAgentService.__new__(DmAgentService)
    service.db = MagicMock()
    service.settings = MagicMock()
    service.instagram_api = MagicMock()
    service.tools = MagicMock()
    service.tools.execute.return_value = {
        "ok": True,
        "order_number": "ORD-000123",
        "product_name": "Gel Pen",
        "total_kes": 99,
        "customer_notified": False,
    }

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        id="conv-1",
        messages=[],
        sales_session={
            "step": STEP_AWAITING_ORDER_CONFIRM,
            "catalog_pending_item_id": "pen-id",
            "catalog_pending_quantity": 1,
        },
    )
    message = SimpleNamespace(body="Yes", direction="inbound", is_inbound=lambda: True)

    handled = service._handle_deterministic_order_confirm(
        account,
        conversation,
        message,
        conversation.sales_session,
        raw_text="Yes",
    )

    assert handled is True
    service.tools.execute.assert_called_once_with(
        "confirm_order",
        {},
        account=account,
        conversation=conversation,
        message=message,
    )
    mock_send.assert_called_once()
    assert "ORD-000123" in mock_send.call_args[0][2]
    assert message.auto_replied is True


@patch("app.services.dm_agent_service.merge_sales_session")
@patch.object(DmAgentService, "_send_outbound")
def test_deterministic_confirm_uses_recent_option_pick(
    mock_send: MagicMock,
    mock_merge: MagicMock,
) -> None:
    service = DmAgentService.__new__(DmAgentService)
    service.db = MagicMock()
    service.settings = MagicMock()
    service.instagram_api = MagicMock()
    service.tools = MagicMock()
    service.tools.execute.return_value = {
        "ok": True,
        "order_number": "ORD-000124",
        "product_name": "Sweet Yogurt Pen",
        "total_kes": 179,
        "customer_notified": False,
    }

    account = SimpleNamespace(account_id="merchant-1")
    prior = SimpleNamespace(
        body="Lets go with option 1",
        direction="inbound",
        sent_at=None,
        created_at=None,
    )
    prior.is_inbound = lambda: True
    conversation = SimpleNamespace(
        id="conv-1",
        messages=[prior],
        sales_session={
            "last_suggested_item_ids": ["pen-1", "pen-2", "pen-3"],
        },
    )
    message = SimpleNamespace(body="Yes", direction="inbound", is_inbound=lambda: True)

    handled = service._handle_deterministic_order_confirm(
        account,
        conversation,
        message,
        conversation.sales_session,
        raw_text="Yes",
    )

    assert handled is True
    service.tools.execute.assert_called_once_with(
        "confirm_order",
        {},
        account=account,
        conversation=conversation,
        message=message,
    )


@patch.object(DmAgentService, "_send_outbound")
def test_deterministic_product_pick_starts_order(mock_send: MagicMock) -> None:
    service = DmAgentService.__new__(DmAgentService)
    service.db = MagicMock()
    service.settings = MagicMock()
    service.instagram_api = MagicMock()
    service.tools = MagicMock()
    service.tools.execute.return_value = {
        "ok": True,
        "product_name": "Sweet Yogurt Pen",
        "unit_price_kes": 179,
        "quantity": 1,
    }

    account = SimpleNamespace(account_id="merchant-1")
    conversation = SimpleNamespace(
        id="conv-1",
        messages=[],
        sales_session={"last_suggested_item_ids": ["pen-1", "pen-2"]},
    )
    message = SimpleNamespace(body="Lets go with option 1", direction="inbound")

    handled = service._handle_deterministic_product_pick(
        account,
        conversation,
        message,
        conversation.sales_session,
        raw_text="Lets go with option 1",
    )

    assert handled is True
    service.tools.execute.assert_called_once_with(
        "start_order",
        {"catalog_item_ref": "pen-1", "quantity": 1},
        account=account,
        conversation=conversation,
        message=message,
    )
    assert "Sweet Yogurt Pen" in mock_send.call_args[0][2]


def test_build_system_prompt_discourages_reconfirming() -> None:
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={},
    )
    prompt = build_system_prompt(account)
    assert "Never call start_order again for the same pending order" in prompt
    assert "do NOT ask the customer to confirm again" in prompt
