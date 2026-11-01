"""Tests for inventory import and template generator."""

from __future__ import annotations

import csv
import io
from datetime import datetime
from decimal import Decimal
from io import BytesIO

import pytest
from openpyxl import Workbook, load_workbook

from app.models import InventoryItem, Product
from app.services.inventory_import_service import (
    ParsedRow,
    _parse_csv,
    _parse_workbook,
    _upsert_inventory,
    generate_inventory_template,
    parse_import_file,
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


def _csv(rows: list[list[object]]) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def test_generate_excel_template() -> None:
    data, filename, media_type = generate_inventory_template("xlsx")
    assert filename == "TransChap_inventory_template.xlsx"
    assert "spreadsheetml" in media_type

    wb = load_workbook(filename=BytesIO(data), read_only=True)
    assert "Inventory Template" in wb.sheetnames
    assert "Instructions & Guide" in wb.sheetnames

    sheet = wb["Inventory Template"]
    rows = list(sheet.iter_rows(values_only=True))
    assert len(rows) >= 4  # Header + 3 sample rows
    headers = [str(h).lower() for h in rows[0]]
    assert "name" in headers
    assert "sku" in headers
    assert "selling price" in headers
    assert "quantity" in headers
    wb.close()


def test_generate_csv_template() -> None:
    data, filename, media_type = generate_inventory_template("csv")
    assert filename == "TransChap_inventory_template.csv"
    assert "text/csv" in media_type

    text = data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    assert len(rows) >= 4
    headers = [h.lower() for h in rows[0]]
    assert "name" in headers
    assert "sku" in headers
    assert "quantity" in headers


def test_parse_csv_import() -> None:
    content = _csv(
        [
            ["Name", "SKU", "Selling Price", "Quantity", "Category"],
            ["Fresh Milk 500ml", "MLK-001", "65.00", "30", "Dairy"],
            ["White Sugar 1kg", "SGR-001", "150.00", "50", "Groceries"],
        ]
    )
    detected, rows, early = parse_import_file(content, filename="inventory.csv")
    assert detected["name"] == "Name"
    assert detected["sku"] == "SKU"
    assert detected["selling_price"] == "Selling Price"
    assert detected["stock_quantity"] == "Quantity"
    assert len(early) == 0
    assert len(rows) == 2

    assert rows[0].name == "Fresh Milk 500ml"
    assert rows[0].sku == "MLK-001"
    assert rows[0].selling_price == 65.00
    assert rows[0].stock_quantity == Decimal("30.000")
    assert rows[0].category == "Dairy"


def test_upsert_inventory_stock_modes() -> None:
    now = datetime.utcnow()
    product = Product(
        id="prod-1",
        name="Fresh Milk 500ml",
        slug="fresh-milk-500ml",
        product_type="retail",
    )
    row = ParsedRow(
        row_number=2,
        name="Fresh Milk 500ml",
        sku="MLK-001",
        selling_price=70.0,
        stock_quantity=Decimal("15.000"),
    )

    # 1. New item: sets stock quantity
    item, created = _upsert_inventory(
        account_id="acc-1",
        product=product,
        row=row,
        now=now,
        existing=None,
        stock_mode="replace",
    )
    assert created is True
    assert item.stock_quantity == Decimal("15.000")
    assert item.selling_price == 70.0

    # 2. Existing item with stock_mode="replace": overwrites stock
    existing_item = InventoryItem(
        id="inv-1",
        account_id="acc-1",
        product_id="prod-1",
        stock_quantity=Decimal("20.000"),
        selling_price=65.0,
    )
    item, created = _upsert_inventory(
        account_id="acc-1",
        product=product,
        row=row,
        now=now,
        existing=existing_item,
        stock_mode="replace",
    )
    assert created is False
    assert item.stock_quantity == Decimal("15.000")
    assert item.selling_price == 70.0

    # 3. Existing item with stock_mode="add": adds to existing stock
    existing_item.stock_quantity = Decimal("20.000")
    item, created = _upsert_inventory(
        account_id="acc-1",
        product=product,
        row=row,
        now=now,
        existing=existing_item,
        stock_mode="add",
    )
    assert created is False
    assert item.stock_quantity == Decimal("35.000")  # 20 + 15

    # 4. Existing item with stock_mode="keep": keeps current stock
    existing_item.stock_quantity = Decimal("20.000")
    item, created = _upsert_inventory(
        account_id="acc-1",
        product=product,
        row=row,
        now=now,
        existing=existing_item,
        stock_mode="keep",
    )
    assert created is False
    assert item.stock_quantity == Decimal("20.000")  # Kept unchanged
    assert item.selling_price == 70.0  # Price still updated!
