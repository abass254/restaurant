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
    assert [(r.name, r.phone) for r in rows] == [("Only Name", None), ("Ok", "0700000011")]
    assert [(item.phone, item.status) for item in early] == [("0700000099", "skipped")]


def test_parse_workbook_all_extended_columns() -> None:
    content = _xlsx(
        [
            ["Name", "Phone", "Balance", "Address", "Postal Code", "City", "Email", "Fax", "PIN Number", "Notes"],
            ["Nairobi Flour Mills", "0722112233", 4500.50, "Mombasa Rd", "PO Box 99", "Nairobi", "info@nfm.co.ke", "0201122", "P012345678X", "Weekly supply"],
        ]
    )
    detected, rows, early = _parse_workbook(content)
    assert early == []
    assert len(rows) == 1
    row = rows[0]
    assert row.name == "Nairobi Flour Mills"
    assert row.phone == "0722112233"
    assert float(row.balance) == 4500.50
    assert row.address == "Mombasa Rd"
    assert row.postal_code == "PO Box 99"
    assert row.city == "Nairobi"
    assert row.email == "info@nfm.co.ke"
    assert row.fax == "0201122"
    assert row.pin_number == "P012345678X"
    assert row.notes == "Weekly supply"


def test_parse_csv_and_template_generation() -> None:
    from app.services.supplier_import_service import _parse_csv, generate_supplier_template

    csv_data = (
        "Supplier Name,Phone,Balance,Address,Postal Code,City,Email,Fax,PIN Number,Notes\n"
        "Alpha Mills,0711223344,1200,Lunga Lunga,PO Box 1,Nairobi,alpha@test.com,020123,P123,Grain supplier\n"
    ).encode("utf-8")

    detected, rows, early = _parse_csv(csv_data)
    assert early == []
    assert len(rows) == 1
    assert rows[0].name == "Alpha Mills"
    assert rows[0].phone == "0711223344"
    assert float(rows[0].balance) == 1200.0

    xlsx_bytes, xlsx_name, xlsx_type = generate_supplier_template("xlsx")
    assert xlsx_name.endswith(".xlsx")
    assert len(xlsx_bytes) > 0

    csv_bytes, csv_name, csv_type = generate_supplier_template("csv")
    assert csv_name.endswith(".csv")
    assert b"Supplier Name,Phone,Balance" in csv_bytes
