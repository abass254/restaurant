"""Customer / supplier spreadsheet imports: POS exports, duplicates, replace mode."""

from __future__ import annotations

from decimal import Decimal
from io import BytesIO

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Base, ShopCustomer, ShopSupplier
from app.services.customer_import_service import (
    import_customers_from_excel,
    parse_customers_file,
)
from app.services.supplier_import_service import (
    import_suppliers_from_excel,
    parse_suppliers_file,
)

ACCOUNT = "acc-1"


def _xlsx(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    buf = BytesIO()
    workbook.save(buf)
    return buf.getvalue()


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


POS_CUSTOMERS = [
    ["Customers - SHOP"],
    ["Name", "Credit Limit", "Opening Balance", "Advance Balance", "Added On", "Mobile", "Total Sale Due"],
    ["hussein", "No Limit", 0, 0, "09/14/2026", "0722972888", 110],
    ["h18", "No Limit", 0, 0, "09/03/2026", "0794343330", 1000],
    ["h18", "No Limit", 0, 0, "09/03/2026", "0794343330", 560],
    ["Walk-In Customer", "No Limit", 0, 0, "", None, -50],
    [None, "Total:", "Total:", "Total:", "Total:", "Total:", 1620],
]


def test_pos_customer_export_parses_no_limit_and_sale_due() -> None:
    _detected, rows, early = parse_customers_file(_xlsx(POS_CUSTOMERS), filename="c.xlsx")
    assert [r.name for r in rows] == ["hussein", "h18", "h18", "Walk-In Customer"]
    assert rows[0].credit_limit == 0.0
    assert rows[0].opening_balance == 110.0
    assert rows[3].phone is None
    assert early == []


def test_customer_duplicates_are_merged_and_balances_added(db: Session) -> None:
    result = import_customers_from_excel(
        db, content=_xlsx(POS_CUSTOMERS), account_id=ACCOUNT, filename="c.xlsx"
    )
    assert (result.created, result.merged, result.skipped, result.errors) == (3, 1, 0, 0)
    h18 = db.query(ShopCustomer).filter_by(phone="+254794343330").one()
    assert h18.outstanding_balance == Decimal("1560.00")


def test_customers_without_usable_phone_import_and_match_by_name(db: Session) -> None:
    content = _xlsx([
        ["Name", "Phone", "Opening Balance", "Notes"],
        ["No Phone", "", 300, "Pays Fridays"],
        ["Short Phone", "5579", 0, None],
    ])
    first = import_customers_from_excel(db, content=content, account_id=ACCOUNT, filename="c.xlsx")
    again = import_customers_from_excel(db, content=content, account_id=ACCOUNT, filename="c.xlsx")
    assert (first.created, again.created, again.updated) == (2, 0, 2)
    rows = {c.name: c for c in db.query(ShopCustomer).all()}
    assert rows["No Phone"].phone is None
    assert rows["No Phone"].outstanding_balance == Decimal("300.00")
    assert rows["Short Phone"].phone is None
    assert "5579" in (rows["Short Phone"].notes or "")


def test_merge_import_keeps_balance_when_file_has_none(db: Session) -> None:
    db.add(ShopCustomer(account_id=ACCOUNT, name="Ann", phone="+254711000001",
                        credit_limit=500, outstanding_balance=200))
    db.commit()
    import_customers_from_excel(
        db,
        content=_xlsx([["Name", "Phone"], ["Ann K", "0711000001"]]),
        account_id=ACCOUNT,
        filename="c.xlsx",
    )
    ann = db.query(ShopCustomer).filter_by(phone="+254711000001").one()
    assert ann.name == "Ann K"
    assert ann.outstanding_balance == Decimal("200.00")
    assert ann.credit_limit == Decimal("500.00")


def test_replace_customers_removes_missing_but_keeps_debtors(db: Session) -> None:
    db.add_all([
        ShopCustomer(account_id=ACCOUNT, name="Gone", phone="+254711000002",
                     credit_limit=0, outstanding_balance=0, notes="old"),
        ShopCustomer(account_id=ACCOUNT, name="Owes", phone="+254711000003",
                     credit_limit=0, outstanding_balance=300),
        ShopCustomer(account_id=ACCOUNT, name="Stay", phone="+254711000004",
                     credit_limit=0, outstanding_balance=0, notes="old note"),
    ])
    db.commit()
    result = import_customers_from_excel(
        db,
        content=_xlsx([["Name", "Phone"], ["Stay", "0711000004"], ["New", "0711000005"]]),
        account_id=ACCOUNT,
        filename="c.xlsx",
        mode="replace",
    )
    assert (result.created, result.updated, result.removed, result.kept) == (1, 1, 1, 1)
    phones = {c.phone for c in db.query(ShopCustomer).all()}
    assert phones == {"+254711000003", "+254711000004", "+254711000005"}
    stay = db.query(ShopCustomer).filter_by(phone="+254711000004").one()
    assert stay.notes is None


def test_replace_does_nothing_when_no_row_imports(db: Session) -> None:
    db.add(ShopCustomer(account_id=ACCOUNT, name="Keep", phone="+254711000006",
                        credit_limit=0, outstanding_balance=0))
    db.commit()
    result = import_customers_from_excel(
        db,
        content=_xlsx([["Name", "Phone"], ["", "0711000099"]]),
        account_id=ACCOUNT,
        filename="c.xlsx",
        mode="replace",
    )
    assert result.removed == 0
    assert db.query(ShopCustomer).count() == 1


def test_replace_keeps_phoneless_customers_that_are_in_the_file(db: Session) -> None:
    content = _xlsx([["Name", "Phone"], ["Walk-In", ""], ["Ann", "0711000007"]])
    import_customers_from_excel(db, content=content, account_id=ACCOUNT, filename="c.xlsx")
    result = import_customers_from_excel(
        db, content=content, account_id=ACCOUNT, filename="c.xlsx", mode="replace"
    )
    assert (result.updated, result.removed) == (2, 0)
    assert db.query(ShopCustomer).count() == 2


POS_SUPPLIERS = [
    ["Suppliers - SHOP"],
    ["Business Name", "Name", "Opening Balance", "Mobile"],
    [None, "TUZO MILK", 0.0, "0116197228"],
    ["water point ltd.", None, 0.0, "0792652158"],
    ["moha", None, 0.0, "0726218365"],
    ["mount", None, 0.0, "0726218365"],
    [None, None, "Total:", "Total:"],
]


def test_pos_supplier_export_uses_business_name_fallback() -> None:
    _detected, rows, early = parse_suppliers_file(_xlsx(POS_SUPPLIERS), filename="s.xlsx")
    assert [r.name for r in rows] == ["TUZO MILK", "water point ltd.", "moha", "mount"]
    assert early == []


def test_replace_suppliers_merges_and_removes_missing(db: Session) -> None:
    db.add_all([
        ShopSupplier(account_id=ACCOUNT, name="Old", phone="+254700000001", balance=0),
        ShopSupplier(account_id=ACCOUNT, name="Owed", phone="+254700000002", balance=50),
    ])
    db.commit()
    result = import_suppliers_from_excel(
        db, content=_xlsx(POS_SUPPLIERS), account_id=ACCOUNT, filename="s.xlsx", mode="replace"
    )
    assert (result.created, result.merged, result.removed, result.kept) == (3, 1, 1, 1)
    moha = db.query(ShopSupplier).filter_by(phone="+254726218365").one()
    assert moha.notes == "Also listed as: mount"
