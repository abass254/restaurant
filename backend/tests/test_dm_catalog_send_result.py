"""Tests for catalogue delivery outcomes used by the DM agent."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.dm_catalog_service import CatalogSendResult, DmCatalogService
from app.services.dm_templates import (
    EMPTY_STORE_MESSAGE,
    format_catalog_follow_up,
    format_empty_store_message,
    format_no_catalog_matches_message,
)


def test_format_empty_store_message_uses_shop_name() -> None:
    message = format_empty_store_message("Test Store")
    assert "Test Store" in message
    assert "still loading products" in message


def test_format_no_catalog_matches_message() -> None:
    message = format_no_catalog_matches_message("stationery")
    assert "stationery" in message
    assert "don't have anything matching" in message


def test_format_catalog_follow_up_variants() -> None:
    assert "closest matches" in format_catalog_follow_up(filtered=True, item_count=3)
    assert "in stock" in format_catalog_follow_up(filtered=False, item_count=4)
    assert "what we have right now" in format_catalog_follow_up(filtered=False, item_count=1)


def test_compose_steps_empty_store_message() -> None:
    db = MagicMock()
    db.get.return_value = None
    service = DmCatalogService(db, MagicMock(), MagicMock())
    account = SimpleNamespace(
        id="acct-1",
        account_id="merchant-1",
        username="testshop",
        display_name="Test Store",
        name="Test Store",
        platform="instagram",
        onboarding_checks={},
    )
    steps = service._compose_steps(
        SimpleNamespace(id="conv-1"),
        [],
        1,
        account=account,
        query=None,
    )
    assert len(steps) == 1
    assert steps[0].kind == "text"
    assert "Test Store" in steps[0].body
    assert steps[0].body != EMPTY_STORE_MESSAGE


def test_compose_steps_no_query_matches() -> None:
    service = DmCatalogService(MagicMock(), MagicMock(), MagicMock())
    steps = service._compose_steps(
        SimpleNamespace(id="conv-1"),
        [],
        1,
        account=None,
        query="stationery",
    )
    assert len(steps) == 1
    assert steps[0].kind == "text"
    assert steps[0].body == format_no_catalog_matches_message("stationery")


def test_catalog_send_result_defaults() -> None:
    result = CatalogSendResult(catalog_sent=True, item_count=3, outbound_delivered=True)
    assert result.catalog_sent is True
    assert result.item_count == 3
    assert result.outbound_delivered is True
