"""Tests for pack/crate sell-unit helpers and conversion."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.sell_units import (
    normalize_sell_units_payload,
    resolve_sell_unit,
    sell_units_for_item,
)


def _item(**kwargs):
    product = SimpleNamespace(unit=kwargs.pop("unit", "Piece"))
    return SimpleNamespace(
        product=product,
        selling_price=kwargs.pop("selling_price", 20),
        buying_price=kwargs.pop("buying_price", 15),
        attributes=kwargs.pop("attributes", None),
    )


def test_default_base_unit_only():
    units = sell_units_for_item(_item())
    assert len(units) == 1
    assert units[0]["name"] == "Piece"
    assert units[0]["factor"] == 1
    assert units[0]["selling_price"] == 20


def test_pack_units_parsed_from_attributes():
    item = _item(
        unit="Egg",
        attributes={
            "sell_units": [
                {"name": "Crate", "factor": 30, "selling_price": 550},
                {"name": "bad", "factor": 1},
                {"name": "Dozen", "factor": 12},
            ],
        },
    )
    units = sell_units_for_item(item)
    assert [u["name"] for u in units] == ["Egg", "Crate", "Dozen"]
    assert units[1]["factor"] == 30
    assert units[1]["selling_price"] == 550


def test_resolve_sell_unit_case_insensitive():
    item = _item(
        attributes={"sell_units": [{"name": "Crate", "factor": 30, "selling_price": 500}]},
    )
    unit = resolve_sell_unit(item, "crate")
    assert unit["factor"] == 30
    assert unit["selling_price"] == 500


def test_resolve_unknown_sell_unit_raises():
    item = _item(
        attributes={"sell_units": [{"name": "Crate", "factor": 30}]},
    )
    try:
        resolve_sell_unit(item, "Box")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "Unknown sell unit" in str(exc)


def test_normalize_sell_units_payload():
    packs = normalize_sell_units_payload(
        [
            {"name": " Crate ", "factor": "30", "selling_price": "550.5"},
            {"name": "", "factor": 10},
            {"name": "Dozen", "factor": 12},
        ],
    )
    assert packs == [
        {"name": "Crate", "factor": 30, "selling_price": 550.5},
        {"name": "Dozen", "factor": 12},
    ]
