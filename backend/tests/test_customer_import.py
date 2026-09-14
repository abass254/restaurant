"""Tests for shop customer Excel import."""

from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import Workbook

from app.services.customer_import_service import _parse_workbook


def _xlsx(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    buf = BytesIO()
    workbook.save(buf)
    return buf.getvalue()


def test_parse_workbook_maps_limit_and_opening_balance() -> None:
    content = _xlsx(
        [
            ["Name", "Phone", "Credit Limit", "Opening Balance", "Notes"],
            ["Amina", "0700000001", 5000, 1200, "VIP"],
            ["Brian", "0700000002", "", "", ""],
        ]
    )
    detected, rows, early = _parse_workbook(content)
    assert detected["name"] == "Name"
    assert detected["phone"] == "Phone"
    assert detected["credit_limit"] == "Credit Limit"
    assert detected["opening_balance"] == "Opening Balance"
    assert early == []
    assert len(rows) == 2
    assert rows[0].name == "Amina"
    assert rows[0].phone == "0700000001"
    assert rows[0].credit_limit == 5000.0
    assert rows[0].opening_balance == 1200.0
    assert rows[0].notes == "VIP"
    assert rows[1].credit_limit == 0.0
    assert rows[1].opening_balance == 0.0


def test_parse_workbook_accepts_balance_alias() -> None:
    content = _xlsx(
        [
            ["Customer Name", "Mobile", "Limit", "Owes"],
            ["Cate", "0711000000", 3000, 500],
        ]
    )
    detected, rows, early = _parse_workbook(content)
    assert "credit_limit" in detected
    assert "opening_balance" in detected
    assert early == []
    assert rows[0].opening_balance == 500.0


def test_parse_workbook_requires_name_and_phone_columns() -> None:
    content = _xlsx(
        [
            ["Credit Limit", "Opening Balance"],
            [1000, 100],
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
        ]
    )
    _detected, rows, early = _parse_workbook(content)
    assert len(rows) == 1
    assert rows[0].name == "Ok"
    assert len(early) == 2
    assert all(item.status == "skipped" for item in early)
