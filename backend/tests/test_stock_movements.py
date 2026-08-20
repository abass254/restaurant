"""Unit tests for barcode matching and manual stock adjustments."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.support.barcode import (
    code_matches_candidate,
    normalize_scan_value,
    product_matches_barcode,
)
from app.services.inventory_stock_service import (
    InsufficientStockError,
    UntrackedStockError,
    adjust_stock,
)


def test_normalize_scan_value_strips_non_alnum() -> None:
    assert normalize_scan_value("  ABC-123  ") == "abc123"
    assert normalize_scan_value(None) == ""


def test_code_matches_candidate_exact_and_normalized() -> None:
    assert code_matches_candidate("ABC-123", "abc-123")
    assert code_matches_candidate("abc123", "ABC-123")
    assert not code_matches_candidate("xyz", "ABC-123")


def test_product_matches_barcode_uses_attributes() -> None:
    product = SimpleNamespace(
        product_code="PRD-1",
        sku=None,
        attributes={"barcode": "8901234567890"},
    )
    assert product_matches_barcode(product, "8901234567890")
    assert not product_matches_barcode(product, "nope")


class _FakeQuery:
    def __init__(self, item):
        self._item = item

    def options(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def with_for_update(self):
        return self

    def first(self):
        return self._item


class _FakeDB:
    def __init__(self, item):
        self.item = item
        self.added = []

    def query(self, *_args, **_kwargs):
        return _FakeQuery(self.item)

    def add(self, obj):
        self.added.append(obj)


def test_adjust_stock_in_increments_and_logs() -> None:
    product = SimpleNamespace(name="Soap", product_type="product")
    product.is_service = lambda: False  # type: ignore[attr-defined]
    item = SimpleNamespace(
        id="item-1",
        account_id="acc-1",
        stock_quantity=2,
        is_active=True,
        product=product,
        updated_at=None,
    )
    db = _FakeDB(item)
    movements = adjust_stock(
        db,  # type: ignore[arg-type]
        [("item-1", 3)],
        direction="in",
        account_id="acc-1",
        reason="receive",
        user_id="user-1",
    )
    assert item.stock_quantity == 5
    assert len(movements) == 1
    assert movements[0].quantity_before == 2
    assert movements[0].quantity_after == 5
    assert movements[0].direction == "in"


def test_adjust_stock_out_rejects_oversell() -> None:
    product = SimpleNamespace(name="Soap", product_type="product")
    product.is_service = lambda: False  # type: ignore[attr-defined]
    item = SimpleNamespace(
        id="item-1",
        account_id="acc-1",
        stock_quantity=1,
        is_active=True,
        product=product,
        updated_at=None,
    )
    db = _FakeDB(item)
    with pytest.raises(InsufficientStockError):
        adjust_stock(
            db,  # type: ignore[arg-type]
            [("item-1", 2)],
            direction="out",
            account_id="acc-1",
            reason="adjustment",
        )


def test_adjust_stock_rejects_untracked() -> None:
    product = SimpleNamespace(name="Consult", product_type="service")
    product.is_service = lambda: True  # type: ignore[attr-defined]
    item = SimpleNamespace(
        id="item-1",
        account_id="acc-1",
        stock_quantity=None,
        is_active=True,
        product=product,
        updated_at=None,
    )
    db = _FakeDB(item)
    with pytest.raises(UntrackedStockError):
        adjust_stock(
            db,  # type: ignore[arg-type]
            [("item-1", 1)],
            direction="in",
            account_id="acc-1",
            reason="receive",
        )
