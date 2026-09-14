"""Tests for shop supplier Excel import."""

from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import Workbook

from app.services.supplier_import_service import _parse_workbook


def _xlsx(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    buf = BytesIO()
    workbook.save(buf)
    return buf.getvalue()


def test_parse_workbook_maps_name_phone_notes() -> None:
    content = _xlsx(
        [
            ["Name", "Phone", "Notes"],
            ["Bidco", "0700000001", "Oil"],
            ["Brookside", "0700000002", ""],
        ]
    )
    detected, rows, early = _parse_workbook(content)
    assert detected["name"] == "Name"
    assert detected["phone"] == "Phone"
    assert detected["notes"] == "Notes"
    assert early == []
    assert len(rows) == 2
    assert rows[0].name == "Bidco"
    assert rows[0].phone == "0700000001"
    assert rows[0].notes == "Oil"
    assert rows[1].notes is None


def test_parse_workbook_accepts_supplier_aliases_and_title_row() -> None:
    content = _xlsx(
        [
            ["Suppliers - ARMAN MINI MART", None, None],
            ["Supplier Name", "Mobile", "Remarks"],
            ["Cate Distributors", "0711000000", "Nairobi"],
        ]
    )
    detected, rows, early = _parse_workbook(content)
    assert detected["name"] == "Supplier Name"
    assert detected["phone"] == "Mobile"
    assert detected["notes"] == "Remarks"
    assert early == []
    assert len(rows) == 1
    assert rows[0].name == "Cate Distributors"
    assert rows[0].row_number == 3


def test_parse_workbook_requires_name_and_phone_columns() -> None:
    content = _xlsx(
        [
            ["Notes"],
            ["Something"],
        ]
    )
    with pytest.raises(ValueError, match="required columns"):
        _parse_workbook(content)


def test_parse_workbook_skips_incomplete_rows() -> None:
    content = _xlsx(
        [
            ["Name", "Phone"],
            ["Only Name", ""],
            ["", "0700000099"],
            ["Ok", "0700000011"],
            ["Total:", "Total:"],
        ]
    )
    _detected, rows, early = _parse_workbook(content)
    assert len(rows) == 1
    assert rows[0].name == "Ok"
    assert len(early) == 2
    assert all(item.status == "skipped" for item in early)
