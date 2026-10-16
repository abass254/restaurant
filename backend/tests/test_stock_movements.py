"""Unit tests for barcode matching and manual stock adjustments."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.schemas import OrderItemOut
from app.support.barcode import (
    code_matches_candidate,
    normalize_scan_value,
    product_matches_barcode,
)
from app.services.inventory_stock_service import (
    InsufficientStockError,
    UntrackedStockError,
    adjust_stock,
    apply_unit_costs,
    deduct_stock,
    PurchaseVoidError,
    lines_from_order,
    restore_stock,
    void_purchase,
)
from app.models import InventoryItem, StockMovement


def test_normalize_scan_value_strips_non_alnum() -> None:
    assert normalize_scan_value("  ABC-123  ") == "abc123"
    assert normalize_scan_value(None) == ""


def test_code_matches_candidate_exact_and_normalized() -> None:
    assert code_matches_candidate("ABC-123", "abc-123")
    assert code_matches_candidate("abc123", "ABC-123")
    assert not code_matches_candidate("xyz", "ABC-123")


def test_product_matches_barcode_uses_sku_only() -> None:
    product = SimpleNamespace(
        product_code="PRD-1",
        sku="8901234567890",
        attributes={"barcode": "9999999999999"},
    )
    assert product_matches_barcode(product, "8901234567890")
    assert not product_matches_barcode(product, "9999999999999")
    assert not product_matches_barcode(product, "PRD-1")
    assert not product_matches_barcode(product, "nope")

    empty_sku = SimpleNamespace(
        product_code="PRD-2",
        sku=None,
        attributes={"barcode": "8901234567890"},
    )
    assert not product_matches_barcode(empty_sku, "8901234567890")


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


def test_adjust_stock_record_only_does_not_change_on_hand() -> None:
    product = SimpleNamespace(name="Soap", product_type="product")
    product.is_service = lambda: False  # type: ignore[attr-defined]
    item = SimpleNamespace(
        id="item-1",
        account_id="acc-1",
        stock_quantity=8,
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
        record_only=True,
    )
    assert item.stock_quantity == 8
    assert movements[0].quantity == 3
    assert movements[0].quantity_before == 8
    assert movements[0].quantity_after == 8


def test_apply_unit_costs_stamps_movement_and_buying_price() -> None:
    item = SimpleNamespace(buying_price=10, updated_at=None)
    movement = SimpleNamespace(
        inventory_item_id="item-1",
        unit_cost=None,
        inventory_item=item,
        created_at="now",
    )
    apply_unit_costs([movement], {"item-1": 0.00499})
    assert movement.unit_cost == 0.005
    assert item.buying_price == 0.005
    assert item.updated_at == "now"


def test_apply_unit_costs_can_skip_buying_price() -> None:
    item = SimpleNamespace(buying_price=10, updated_at=None)
    movement = SimpleNamespace(
        inventory_item_id="item-1",
        unit_cost=None,
        inventory_item=item,
        created_at="now",
    )
    apply_unit_costs([movement], {"item-1": 42}, update_buying_price=False)
    assert movement.unit_cost == 42
    assert item.buying_price == 10
    assert item.updated_at is None


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


def test_fractional_stock_deduction_and_restore() -> None:
    product = SimpleNamespace(name="Flour", product_type="product")
    product.is_service = lambda: False  # type: ignore[attr-defined]
    item = SimpleNamespace(
        id="item-1",
        account_id="acc-1",
        stock_quantity=Decimal("2.000"),
        is_active=True,
        product=product,
        updated_at=None,
    )
    db = _FakeDB(item)
    assert deduct_stock(
        db,  # type: ignore[arg-type]
        [("item-1", Decimal("0.750"))],
        account_id="acc-1",
    )
    assert item.stock_quantity == Decimal("1.250")
    restore_stock(
        db,  # type: ignore[arg-type]
        [("item-1", Decimal("0.750"))],
        account_id="acc-1",
    )
    assert item.stock_quantity == Decimal("2.000")


def test_order_stock_uses_fractional_sell_unit_factor() -> None:
    order = SimpleNamespace(
        items=[
            SimpleNamespace(
                inventory_item_id="item-1",
                quantity=3,
                unit_factor=Decimal("0.2500"),
            ),
        ],
    )
    assert lines_from_order(order) == [("item-1", Decimal("0.7500"))]


def test_order_output_preserves_fractional_unit_factor_and_stock() -> None:
    item = SimpleNamespace(
        id="order-item-1",
        inventory_item_id="item-1",
        product_id="product-1",
        product_name="Flour",
        product_sku=None,
        quantity=1,
        unit_price=25,
        line_total=25,
        sell_unit="1/4 KG",
        unit_factor=Decimal("0.2500"),
        notes=None,
        modifiers=None,
        inventory_item=SimpleNamespace(stock_quantity=Decimal("1.250")),
    )
    result = OrderItemOut.from_model(item)
    assert result.unit_factor == 0.25
    assert result.stock_quantity == 1.25


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


class _VoidDB:
    def __init__(self, movement, item):
        self.rows = {StockMovement: movement, InventoryItem: item}
        self.added = []

    def query(self, model, *_args, **_kwargs):
        return _FakeQuery(self.rows[model])

    def add(self, obj):
        self.added.append(obj)


def _purchase(**overrides):
    values = dict(
        id="mv-1",
        account_id="acc-1",
        inventory_item_id="item-1",
        direction="in",
        reason="receive",
        quantity=Decimal("3.000"),
        quantity_before=Decimal("2.000"),
        quantity_after=Decimal("5.000"),
        voided_at=None,
        voided_by=None,
        void_reason=None,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def _stocked_item(qty):
    return SimpleNamespace(
        id="item-1",
        stock_quantity=Decimal(qty),
        product=SimpleNamespace(name="Soap"),
        updated_at=None,
    )


def test_void_purchase_removes_stock_and_logs_reversal() -> None:
    movement = _purchase()
    item = _stocked_item("5.000")
    db = _VoidDB(movement, item)
    result = void_purchase(
        db,  # type: ignore[arg-type]
        "mv-1",
        account_id="acc-1",
        reason="  Wrong item  ",
        user_id="user-1",
    )
    assert result is movement
    assert item.stock_quantity == Decimal("2.000")
    assert movement.voided_at is not None
    assert movement.voided_by == "user-1"
    assert movement.void_reason == "Wrong item"
    assert len(db.added) == 1
    reversal = db.added[0]
    assert reversal.direction == "out"
    assert reversal.quantity == Decimal("3.000")
    assert reversal.note == "Voided purchase · Wrong item"


def test_void_record_only_purchase_keeps_stock() -> None:
    movement = _purchase(quantity_before=Decimal("8.000"), quantity_after=Decimal("8.000"))
    item = _stocked_item("8.000")
    db = _VoidDB(movement, item)
    void_purchase(db, "mv-1", account_id="acc-1", reason="dup")  # type: ignore[arg-type]
    assert item.stock_quantity == Decimal("8.000")
    assert db.added == []
    assert movement.voided_at is not None


def test_void_purchase_rejects_when_stock_already_used() -> None:
    movement = _purchase()
    item = _stocked_item("1.000")
    db = _VoidDB(movement, item)
    with pytest.raises(InsufficientStockError):
        void_purchase(db, "mv-1", account_id="acc-1", reason="oops")  # type: ignore[arg-type]
    assert movement.voided_at is None
    assert item.stock_quantity == Decimal("1.000")


def test_void_purchase_rejects_non_purchase_and_double_void() -> None:
    item = _stocked_item("5.000")
    with pytest.raises(PurchaseVoidError):
        void_purchase(
            _VoidDB(_purchase(direction="out"), item),  # type: ignore[arg-type]
            "mv-1",
            account_id="acc-1",
            reason="nope",
        )
    with pytest.raises(PurchaseVoidError):
        void_purchase(
            _VoidDB(_purchase(voided_at="earlier"), item),  # type: ignore[arg-type]
            "mv-1",
            account_id="acc-1",
            reason="again",
        )
