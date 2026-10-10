"""Pack units (CTN / Dozen / PCS) in inventory import."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO

import pytest
from openpyxl import Workbook

from app.models import InventoryItem, Product
from app.services.inventory_import_service import (
    _upsert_inventory,
    parse_import_file,
)
from app.services.sell_units import (
    detect_pack,
    infer_pack_factor,
    pack_factor_from_name,
)


def _xlsx(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    buf = BytesIO()
    workbook.save(buf)
    return buf.getvalue()


def _parse(rows: list[list[object]]):
    _detected, parsed, early = parse_import_file(_xlsx(rows), filename="inv.xlsx")
    assert early == []
    return parsed


def _product(unit: str | None = "Pcs") -> Product:
    return Product(id="prod-1", name="Item", slug="item", product_type="product", unit=unit)


@pytest.mark.parametrize(
    ("name", "factor"),
    [
        ("Eggs Tray 30s", 30),
        ("Coke 24x500ml", 24),
        ("Water 12 x 1.5L", 12),
        ("Coke 500ml 24s", 24),
        ("Royco Cubes 40's", 40),
        ("Biscuits (12)", 12),
        ("Eggs tray of 30", 30),
        ("Tissue 10x4", 40),
        ("Milk x 12", 12),
        ("Sugar 1kg", None),
        ("Omo 3kgs", None),
        ("Cooking Oil 5L", None),
    ],
)
def test_pack_factor_from_name(name: str, factor: int | None) -> None:
    assert pack_factor_from_name(name) == factor


def test_detect_pack_units() -> None:
    assert detect_pack("CTN", "Coke 24x500ml") == ("CTN", 24)
    assert detect_pack("Dozen", "Bic Pens") == ("Dozen", 12)
    assert detect_pack("DZ", "Bic Pens 10s") == ("DZ", 12)
    assert detect_pack("Ctn", "Sugar 1kg") == ("Ctn", None)
    assert detect_pack("PCS", "Coke 24s") is None
    assert detect_pack("Kg", "Rice 25kg") is None
    assert detect_pack(None, "Coke 24s") is None
    # Explicit pack size beats the name.
    assert detect_pack("CTN", "Coke 24s", 12) == ("CTN", 12)


def test_ctn_row_converts_to_pieces() -> None:
    [row] = _parse(
        [
            ["Name", "Unit", "Buying Price", "Selling Price", "Quantity", "Low Stock Threshold"],
            ["Coke 500ml 24s", "CTN", 1100, 1320, 3, 1],
        ],
    )
    assert row.unit == "Pcs"
    assert row.pack_name == "CTN"
    assert row.pack_factor == 24
    assert row.pack_quantity == Decimal("3.000")
    assert row.stock_quantity == Decimal("72.000")
    assert row.low_stock_threshold == Decimal("24.000")
    assert row.selling_price == 55.0
    assert row.buying_price == 45.83
    assert row.pack_warning is None

    item, created = _upsert_inventory(
        account_id="acc-1",
        product=_product(),
        row=row,
        now=datetime.utcnow(),
        existing=None,
    )
    assert created is True
    assert item.stock_quantity == Decimal("72.000")
    assert item.selling_price == 55.0
    assert item.attributes["sell_units"] == [
        {"name": "CTN", "factor": 24, "selling_price": 1320.0, "buying_price": 1100.0},
    ]


def test_dozen_row_uses_twelve() -> None:
    [row] = _parse(
        [
            ["Name", "Unit", "Selling Price", "Quantity"],
            ["Bic Pens Blue", "Dozen", 240, 10],
        ],
    )
    assert row.pack_factor == 12
    assert row.stock_quantity == Decimal("120.000")
    assert row.selling_price == 20.0


def test_pcs_per_pack_column_overrides_name() -> None:
    [row] = _parse(
        [
            ["Name", "Unit", "Pcs per Pack", "Quantity"],
            ["Coke 500ml 24s", "CTN", 12, 2],
        ],
    )
    assert row.pack_factor == 12
    assert row.stock_quantity == Decimal("24.000")


def test_pack_without_factor_is_flagged() -> None:
    [row] = _parse(
        [
            ["Name", "Unit", "Selling Price", "Quantity"],
            ["Sugar 1kg", "CTN", 3000, 4],
        ],
    )
    assert row.pack_factor is None
    assert row.unit == "CTN"
    assert row.stock_quantity == Decimal("4.000")
    assert row.selling_price == 3000
    assert row.pack_warning and "Pcs per pack" in row.pack_warning


def test_pcs_row_unchanged() -> None:
    [row] = _parse(
        [
            ["Name", "Unit", "Selling Price", "Quantity"],
            ["Coke 500ml 24s", "PCS", 60, 30],
        ],
    )
    assert row.unit == "PCS"
    assert row.pack_factor is None
    assert row.pack_warning is None
    assert row.stock_quantity == Decimal("30.000")
    assert row.selling_price == 60


def test_infer_pack_factor_from_prices() -> None:
    assert infer_pack_factor(2366.4, 197.2) == 12
    assert infer_pack_factor(3100, 258.3333) == 12
    assert infer_pack_factor(100, 30) is None
    assert infer_pack_factor(None, 30) is None
    assert infer_pack_factor(50, 50) is None


@pytest.mark.parametrize("ctn_first", [True, False])
def test_ctn_and_pc_rows_of_same_product_merge(ctn_first: bool) -> None:
    header = ["Item Code", "Name", "Unit", "Buying Price", "Selling Price", "Quantity"]
    ctn = ["3470", "ARYUVA LIGHT SOY SAUCE", "CTN", 2366.4, 3100, 15.1]
    pc = ["3470", "ARYUVA LIGHT SOY SAUCE", "PC", 197.2, 258.3333333, 181]
    parsed = _parse([header, ctn, pc] if ctn_first else [header, pc, ctn])
    ctn_row = next(r for r in parsed if r.pack_name)
    pc_row = next(r for r in parsed if not r.pack_name)

    assert ctn_row.pack_of == "PC"
    assert ctn_row.pack_factor == 12
    assert ctn_row.pack_warning is None
    assert ctn_row.unit == "PC"
    assert ctn_row.stock_quantity is None
    assert ctn_row.selling_price is None
    assert pc_row.stock_quantity == Decimal("181.000")

    item = None
    for row in parsed:
        item, _created = _upsert_inventory(
            account_id="acc-1",
            product=_product("PC"),
            row=row,
            now=datetime.utcnow(),
            existing=item,
            stock_mode="add",
        )
    assert item is not None
    assert item.stock_quantity == Decimal("181.000")
    assert item.selling_price == pytest.approx(258.33, abs=0.01)
    assert item.buying_price == 197.2
    assert item.attributes["sell_units"] == [
        {"name": "CTN", "factor": 12, "selling_price": 3100.0, "buying_price": 2366.4},
    ]


def test_price_ratio_beats_name_when_piece_row_exists() -> None:
    parsed = _parse(
        [
            ["Item Code", "Name", "Unit", "Buying Price", "Selling Price", "Quantity"],
            ["4065", "MAGGI CUBES 20*39*4GM", "PC", 111, 130, 0],
            ["4065", "MAGGI CUBES 20*39*4GM", "CTN", 2220, 2600, 0],
            ["4069", "MOLFIX XLARGE 56PC*3", "CTN", 3150.74, 3500, 0],
            ["4069", "MOLFIX XLARGE 56PC*3", "PC", 1050.25, 1200, 0],
        ],
    )
    factors = {r.name: r.pack_factor for r in parsed if r.pack_name}
    assert factors == {"MAGGI CUBES 20*39*4GM": 20, "MOLFIX XLARGE 56PC*3": 3}


def test_ctn_row_without_inferable_size_is_flagged() -> None:
    parsed = _parse(
        [
            ["Item Code", "Name", "Unit", "Selling Price", "Quantity"],
            ["9", "Mystery Item", "CTN", None, 2],
            ["9", "Mystery Item", "PC", 50, 30],
        ],
    )
    ctn_row = next(r for r in parsed if r.pack_name)
    assert ctn_row.pack_of == "PC"
    assert ctn_row.pack_factor is None
    assert ctn_row.pack_warning
    assert ctn_row.stock_quantity is None


def test_clean_multi_unit_rows_with_explicit_sizes() -> None:
    parsed = _parse(
        [
            ["Name", "SKU", "Unit", "Pcs per Pack", "Buying Price", "Selling Price", "Quantity"],
            ["BELLA TOILET JUMBO ROLL 1*12", "2033", "Outer", 1, 94.54, 125, 198],
            ["BELLA TOILET JUMBO ROLL 1*12", "2033", "Bale", 12, 1134.43, 1500, None],
            ["GINGERNUT MANJI 60*3*30G", "2027", "Ctn", 1, 235, 270, 0],
            ["RICE", "77", "Kg", 1, 140, 160, 20],
            ["RICE", "77", "Bag", 25, 3500, 3900, None],
        ],
    )
    outer, bale, ginger, kg, bag = parsed
    assert outer.pack_name is None and outer.unit == "Outer"
    assert outer.stock_quantity == Decimal("198.000")
    assert (bale.pack_name, bale.pack_factor, bale.pack_of) == ("Bale", 12, "Outer")
    assert bale.stock_quantity is None
    assert ginger.pack_name is None and ginger.stock_quantity == Decimal("0.000")
    assert ginger.selling_price == 270
    assert kg.pack_name is None
    assert (bag.pack_name, bag.pack_factor, bag.pack_of) == ("Bag", 25, "Kg")


def test_one_row_per_item_with_bulk_columns() -> None:
    header = [
        "item_id", "name", "unit", "quantity", "single_buying_price", "single_price",
        "bulk_unit", "qty_per_bulk", "bulk_buying_price", "bulk_price",
    ]
    soy, ginger = _parse(
        [
            header,
            ["3470", "ARYUVA LIGHT SOY SAUCE", "Pcs", 181, 197.2, 258.33, "Ctn", 12, 2366.4, 3100],
            ["2027", "GINGERNUT MANJI 60*3*30G", "Ctn", 0, 235, 270, None, None, None, None],
        ],
    )
    assert soy.sku == "3470"
    assert soy.pack_name is None
    assert soy.stock_quantity == Decimal("181.000")
    assert (soy.buying_price, soy.selling_price) == (197.2, 258.33)
    assert ginger.unit == "Ctn" and ginger.pack_name is None
    assert ginger.extra_packs == []

    existing = InventoryItem(
        id="inv-1",
        account_id="acc-1",
        product_id="prod-1",
        stock_quantity=Decimal("0"),
        attributes={"sell_units": [{"name": "OUT", "factor": 39}]},
    )
    item, _ = _upsert_inventory(
        account_id="acc-1",
        product=_product(),
        row=soy,
        now=datetime.utcnow(),
        existing=existing,
    )
    assert item.stock_quantity == Decimal("181.000")
    assert item.selling_price == 258.33
    assert item.attributes["sell_units"] == [
        {"name": "Ctn", "factor": 12, "selling_price": 3100.0, "buying_price": 2366.4},
    ]


def test_existing_piece_price_kept_and_pack_replaced() -> None:
    [row] = _parse(
        [
            ["Name", "Unit", "Selling Price", "Quantity"],
            ["Eggs Tray 30s", "Tray", 450, 2],
        ],
    )
    existing = InventoryItem(
        id="inv-1",
        account_id="acc-1",
        product_id="prod-1",
        stock_quantity=Decimal("5.000"),
        selling_price=17.0,
        attributes={
            "sell_units": [
                {"name": "tray", "factor": 30, "selling_price": 400},
                {"name": "Half", "factor": 15},
            ],
        },
    )
    item, created = _upsert_inventory(
        account_id="acc-1",
        product=_product(),
        row=row,
        now=datetime.utcnow(),
        existing=existing,
        stock_mode="add",
    )
    assert created is False
    assert item.stock_quantity == Decimal("65.000")
    assert item.selling_price == 17.0
    packs = {pack["name"]: pack for pack in item.attributes["sell_units"]}
    assert set(packs) == {"Half", "Tray"}
    assert packs["Tray"]["selling_price"] == 450.0
