"""Human-readable order numbers: ORD + 3 merchant initials + 5-digit increment."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.order_creation import (
    format_merchant_order_number,
    merchant_order_initials,
    next_order_number,
)


def test_merchant_order_initials_from_business_name() -> None:
    assert merchant_order_initials("Spice House") == "SPH"
    assert merchant_order_initials("Mama Mboga") == "MAM"
    assert merchant_order_initials("Java House Nairobi") == "JHN"
    assert merchant_order_initials("Kiosk") == "KIO"
    assert merchant_order_initials("duKAi") == "DUK"
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
