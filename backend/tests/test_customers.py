"""Tests for shop customers and credit limits."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.services.customer_service import (
    CustomerService,
    CustomerServiceError,
    available_credit,
)
from app.services.rider_service import normalize_phone


def test_available_credit_never_goes_negative() -> None:
    assert available_credit(5000, 1200) == Decimal("3800.00")
    assert available_credit(1000, 1000) == Decimal("0.00")
    assert available_credit(500, 900) == Decimal("0.00")
    assert available_credit(0, 0) == Decimal("0.00")


def test_create_customer_rejects_empty_name() -> None:
    service = CustomerService(MagicMock())
    with pytest.raises(CustomerServiceError, match="name is required"):
        service.create_customer("acct-1", name="  ", phone="+254700000001")


def test_create_customer_rejects_duplicate_phone() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = MagicMock()
    service = CustomerService(db)
    with pytest.raises(CustomerServiceError, match="already exists"):
        service.create_customer("acct-1", name="Amina", phone="0700000001")


def test_create_customer_persists_normalized_phone_and_limit() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    captured = {}

    def capture_add(obj) -> None:
        captured["customer"] = obj
        obj.id = "cust-1"

    db.add.side_effect = capture_add

    service = CustomerService(db)
    customer = service.create_customer(
        "acct-1",
        name=" Amina Wanjiku ",
        phone="0700 000 001",
        email="amina@example.com",
        credit_limit="5000.5",
    )

    assert customer is captured["customer"]
    assert captured["customer"].name == "Amina Wanjiku"
    assert captured["customer"].phone == normalize_phone("0700000001")
    assert captured["customer"].email == "amina@example.com"
    assert captured["customer"].credit_limit == Decimal("5000.50")
    assert captured["customer"].outstanding_balance == Decimal("0.00")
    db.commit.assert_called_once()


def test_update_customer_rejects_limit_below_outstanding() -> None:
    db = MagicMock()
    existing = MagicMock()
    existing.id = "cust-1"
    existing.outstanding_balance = Decimal("2500.00")
    existing.credit_limit = Decimal("5000.00")
    db.query.return_value.filter.return_value.first.return_value = existing

    service = CustomerService(db)
    with pytest.raises(CustomerServiceError, match="outstanding"):
        service.update_customer("acct-1", "cust-1", credit_limit=1000)


def test_delete_customer_rejects_outstanding_balance() -> None:
    db = MagicMock()
    existing = MagicMock()
    existing.outstanding_balance = Decimal("10.00")
    db.query.return_value.filter.return_value.first.return_value = existing

    service = CustomerService(db)
    with pytest.raises(CustomerServiceError, match="outstanding balance"):
        service.delete_customer("acct-1", "cust-1")
    db.delete.assert_not_called()


def test_charge_credit_allows_unlimited_when_limit_is_zero() -> None:
    customer = MagicMock()
    customer.credit_limit = Decimal("0.00")
    customer.outstanding_balance = Decimal("200.00")
    CustomerService(MagicMock()).charge_credit(customer, Decimal("50.00"))
    assert customer.outstanding_balance == Decimal("250.00")


def test_charge_credit_rejects_when_limit_exceeded() -> None:
    customer = MagicMock()
    customer.credit_limit = Decimal("1000.00")
    customer.outstanding_balance = Decimal("900.00")
    with pytest.raises(CustomerServiceError, match="credit is left"):
        CustomerService(MagicMock()).charge_credit(customer, Decimal("150.00"))


def test_collect_credit_partial_and_caps_at_outstanding() -> None:
    customer = MagicMock()
    customer.outstanding_balance = Decimal("80.00")
    applied = CustomerService(MagicMock()).collect_credit(customer, Decimal("30.00"))
    assert applied == Decimal("30.00")
    assert customer.outstanding_balance == Decimal("50.00")
    applied = CustomerService(MagicMock()).collect_credit(customer, Decimal("90.00"))
    assert applied == Decimal("50.00")
    assert customer.outstanding_balance == Decimal("0.00")


def test_collect_credit_rejects_when_nothing_owed() -> None:
    customer = MagicMock()
    customer.outstanding_balance = Decimal("0.00")
    with pytest.raises(CustomerServiceError, match="does not owe"):
        CustomerService(MagicMock()).collect_credit(customer, Decimal("10.00"))
