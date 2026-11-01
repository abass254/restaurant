"""Human-readable order numbers: ORD + 3 merchant initials + 5-digit increment."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.services import order_creation
from app.services.order_creation import (
    format_merchant_order_number,
    insert_order,
    merchant_order_initials,
    next_order_number,
)


def test_merchant_order_initials_from_business_name() -> None:
    assert merchant_order_initials("Spice House") == "SPH"
    assert merchant_order_initials("Mama Mboga") == "MAM"
    assert merchant_order_initials("Java House Nairobi") == "JHN"
    assert merchant_order_initials("Kiosk") == "KIO"
    assert merchant_order_initials("TransChap") == "TRA"
    assert merchant_order_initials("7 Eleven") == "7EL"
    assert merchant_order_initials("The Burger Joint") == "BUJ"
    assert merchant_order_initials("AB") == "ABX"
    assert merchant_order_initials("") == "XXX"
    assert merchant_order_initials(None) == "XXX"


def test_format_merchant_order_number() -> None:
    assert format_merchant_order_number("SPH", 1) == "ORDSPH00001"
    assert format_merchant_order_number("mam", 42) == "ORDMAM00042"
    assert format_merchant_order_number("JHN", 99999) == "ORDJHN99999"


def test_next_order_number_starts_at_one_for_shop() -> None:
    db = MagicMock()
    account_query = MagicMock()
    account_query.filter.return_value.first.return_value = SimpleNamespace(
        business_name="Spice House"
    )
    count_query = MagicMock()
    count_query.filter.return_value.scalar.return_value = 0
    exists_query = MagicMock()
    exists_query.filter.return_value.first.return_value = None
    db.query.side_effect = [account_query, count_query, exists_query]

    assert next_order_number(db, "acc-1") == "ORDSPH00001"


def test_next_order_number_increments_and_skips_taken_slots() -> None:
    db = MagicMock()
    account_query = MagicMock()
    account_query.filter.return_value.first.return_value = SimpleNamespace(
        business_name="Mama Mboga"
    )
    count_query = MagicMock()
    count_query.filter.return_value.scalar.return_value = 3
    taken = MagicMock()
    free = MagicMock()
    taken.filter.return_value.first.return_value = ("ord-id",)
    free.filter.return_value.first.return_value = None
    db.query.side_effect = [account_query, count_query, taken, free]

    assert next_order_number(db, "acc-2") == "ORDMAM00005"


def test_insert_order_retries_past_a_number_taken_concurrently(monkeypatch) -> None:
    db = MagicMock()
    db.get_bind.return_value.dialect.name = "mysql"
    db.flush.side_effect = [None, IntegrityError("INSERT", {}, Exception("duplicate")), None]
    calls: list[int] = []

    def fake_next(_db, _account_id, *, at_least: int = 1) -> str:
        calls.append(at_least)
        return format_merchant_order_number("MAM", at_least)

    monkeypatch.setattr(order_creation, "next_order_number", fake_next)
    order = SimpleNamespace(account_id="acc-2", order_number="ORDMAM00004")

    insert_order(db, order)

    assert calls == [5]
    assert order.order_number == "ORDMAM00005"
    assert db.begin_nested.call_count == 2


def test_insert_order_gives_up_after_repeated_clashes(monkeypatch) -> None:
    db = MagicMock()
    db.get_bind.return_value.dialect.name = "mysql"
    db.flush.side_effect = [None] + [IntegrityError("INSERT", {}, Exception("duplicate"))] * 5
    monkeypatch.setattr(order_creation, "next_order_number", lambda *_a, **_k: "ORDMAM00009")

    with pytest.raises(IntegrityError):
        insert_order(db, SimpleNamespace(account_id="acc-2", order_number="ORDMAM00004"))
