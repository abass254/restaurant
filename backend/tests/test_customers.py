"""Tests for shop customers and credit limits."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.v1 import customers as customers_api
from app.models import ShopCustomer
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


def test_charge_credit_records_date_to_pay() -> None:
    customer = MagicMock()
    customer.credit_limit = Decimal("0.00")
    customer.outstanding_balance = Decimal("0.00")
    CustomerService(MagicMock()).charge_credit(customer, Decimal("50.00"), date_to_pay="2026-11-01")
    assert customer.date_to_pay == date(2026, 11, 1)
    with pytest.raises(CustomerServiceError, match="YYYY-MM-DD"):
        CustomerService(MagicMock()).charge_credit(customer, Decimal("50.00"), date_to_pay="soon")


def test_rebalance_order_credit_charges_or_releases_the_difference() -> None:
    service = CustomerService(MagicMock())
    customer = MagicMock()
    service.get_or_create_for_sale = MagicMock(return_value=customer)
    service.charge_credit = MagicMock()
    service.release_credit_for_order = MagicMock()

    service.rebalance_order_credit(
        "acct-1", previous_phone="+254712345678", previous_amount=300,
        phone="0712345678", name="Amina", amount=350,
    )
    service.charge_credit.assert_called_once_with(customer, Decimal("50.00"))
    service.release_credit_for_order.assert_not_called()

    service.charge_credit.reset_mock()
    service.rebalance_order_credit(
        "acct-1", previous_phone="+254712345678", previous_amount=300,
        phone="+254712345678", name="Amina", amount=0,
    )
    service.release_credit_for_order.assert_called_once_with(
        "acct-1", phone="+254712345678", amount=Decimal("300.00"),
    )
    service.charge_credit.assert_not_called()


def test_rebalance_order_credit_moves_tab_when_customer_changes() -> None:
    service = CustomerService(MagicMock())
    customer = MagicMock()
    service.get_or_create_for_sale = MagicMock(return_value=customer)
    service.charge_credit = MagicMock()
    service.release_credit_for_order = MagicMock()

    service.rebalance_order_credit(
        "acct-1", previous_phone="+254712345678", previous_amount=300,
        phone="+254700000001", name="Baraka", amount=300,
    )
    service.release_credit_for_order.assert_called_once_with(
        "acct-1", phone="+254712345678", amount=Decimal("300.00"),
    )
    service.get_or_create_for_sale.assert_called_once_with("acct-1", name="Baraka", phone="+254700000001")
    service.charge_credit.assert_called_once_with(customer, Decimal("300.00"))


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


def test_create_customer_accepts_opening_balance() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    captured = {}

    def capture_add(obj) -> None:
        captured["customer"] = obj
        obj.id = "cust-2"

    db.add.side_effect = capture_add

    service = CustomerService(db)
    customer = service.create_customer(
        "acct-1",
        name="Brian",
        phone="0700000002",
        credit_limit=8000,
        outstanding_balance=1500,
    )

    assert captured["customer"].credit_limit == Decimal("8000.00")
    assert captured["customer"].outstanding_balance == Decimal("1500.00")
    assert customer is captured["customer"]


def test_create_customer_rejects_opening_above_limit() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    service = CustomerService(db)
    with pytest.raises(CustomerServiceError, match="Opening balance"):
        service.create_customer(
            "acct-1",
            name="Brian",
            phone="0700000002",
            credit_limit=1000,
            outstanding_balance=1500,
        )


def test_upsert_import_updates_existing_by_phone() -> None:
    db = MagicMock()
    existing = MagicMock()
    existing.id = "cust-1"
    existing.phone = normalize_phone("0700000001")
    existing.outstanding_balance = Decimal("0.00")
    existing.credit_limit = Decimal("1000.00")
    db.query.return_value.filter.return_value.first.return_value = existing

    service = CustomerService(db)
    customer, status = service.upsert_import_customer(
        "acct-1",
        name="Amina Updated",
        phone="0700000001",
        credit_limit=6000,
        outstanding_balance=2200,
        notes="from excel",
    )

    assert status == "updated"
    assert customer is existing
    assert existing.name == "Amina Updated"
    assert existing.credit_limit == Decimal("6000.00")
    assert existing.outstanding_balance == Decimal("2200.00")
    assert existing.notes == "from excel"
    db.commit.assert_called_once()


def test_create_customer_defaults_to_1000_limit_and_saves_location_and_pay_date() -> None:
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
        name="James Mwangi",
        phone="+254712345678",
        physical_location="Shop 4, Tom Mboya St",
        date_to_pay="2026-10-15",
    )

    assert customer is captured["customer"]
    assert customer.credit_limit == Decimal("1000.00")
    assert customer.physical_location == "Shop 4, Tom Mboya St"
    assert customer.address == "Shop 4, Tom Mboya St"
    assert customer.date_to_pay == date(2026, 10, 15)


def test_create_customer_rejects_invalid_date_to_pay() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    service = CustomerService(db)
    with pytest.raises(CustomerServiceError, match="YYYY-MM-DD"):
        service.create_customer(
            "acct-1",
            name="James Mwangi",
            phone="+254712345678",
            date_to_pay="invalid-date",
        )


def test_update_customer_date_to_pay() -> None:
    db = MagicMock()
    existing = ShopCustomer(
        id="cust-1",
        account_id="acct-1",
        name="James Mwangi",
        phone="+254712345678",
        date_to_pay=None,
    )
    db.query.return_value.filter.return_value.first.return_value = existing
    service = CustomerService(db)
    updated = service.update_customer(
        "acct-1",
        "cust-1",
        date_to_pay="2026-11-20",
    )
    assert updated.date_to_pay == date(2026, 11, 20)


def test_manual_credit_collection_records_partial_payment(monkeypatch) -> None:
    customer = ShopCustomer(
        id="cust-1",
        account_id="acct-1",
        name="Amina",
        phone="254700000001",
        credit_limit=Decimal("1000.00"),
        outstanding_balance=Decimal("80.00"),
    )
    user = SimpleNamespace(id="user-1")
    db = MagicMock()
    db.get.return_value = SimpleNamespace(force_mpesa_prompt=False)
    customer_query = MagicMock()
    customer_query.filter.return_value.with_for_update.return_value.first.return_value = customer
    transaction_query = MagicMock()
    transaction_query.filter.return_value.first.return_value = None
    db.query.side_effect = lambda model: (
        customer_query if model is ShopCustomer else transaction_query
    )
    monkeypatch.setattr(customers_api, "validate_csrf", lambda *_: None)
    monkeypatch.setattr(customers_api, "require_user", lambda *_: user)
    monkeypatch.setattr(
        customers_api,
        "assert_merchant_section_any_access",
        lambda *_: None,
    )
    monkeypatch.setattr(
        customers_api,
        "require_merchant_account_id",
        lambda *_: "acct-1",
    )
    monkeypatch.setattr(
        customers_api,
        "_customer_out",
        lambda row: {"id": row.id, "outstanding_balance": float(row.outstanding_balance)},
    )

    response = customers_api.manually_collect_customer_credit(
        customer.id,
        customers_api.ManualCreditCollectRequest(amount=Decimal("30.00")),
        request=None,
        db=db,
        session={},
    )

    assert customer.outstanding_balance == Decimal("50.00")
    assert response["collection"]["amount"] == 30.0
    assert response["collection"]["receipt_code"] is None
    recorded = db.add.call_args.args[0]
    assert recorded.status == "success"
    assert recorded.mpesa_receipt_number is None
    assert recorded.callback_payload["manual_credit_collection"] is True
    db.commit.assert_called_once()


def test_manual_credit_collection_defaults_to_full_balance(monkeypatch) -> None:
    customer = ShopCustomer(
        id="cust-1",
        account_id="acct-1",
        name="Amina",
        phone="254700000001",
        credit_limit=Decimal("1000.00"),
        outstanding_balance=Decimal("80.00"),
    )
    user = SimpleNamespace(id="user-1")
    db = MagicMock()
    db.get.return_value = SimpleNamespace(force_mpesa_prompt=False)
    customer_query = MagicMock()
    customer_query.filter.return_value.with_for_update.return_value.first.return_value = customer
    transaction_query = MagicMock()
    transaction_query.filter.return_value.first.return_value = None
    db.query.side_effect = lambda model: (
        customer_query if model is ShopCustomer else transaction_query
    )
    monkeypatch.setattr(customers_api, "validate_csrf", lambda *_: None)
    monkeypatch.setattr(customers_api, "require_user", lambda *_: user)
    monkeypatch.setattr(
        customers_api,
        "assert_merchant_section_any_access",
        lambda *_: None,
    )
    monkeypatch.setattr(
        customers_api,
        "require_merchant_account_id",
        lambda *_: "acct-1",
    )
    monkeypatch.setattr(
        customers_api,
        "_customer_out",
        lambda row: {"id": row.id, "outstanding_balance": float(row.outstanding_balance)},
    )

    response = customers_api.manually_collect_customer_credit(
        customer.id,
        customers_api.ManualCreditCollectRequest(mpesa_code="qgh7abc123"),
        request=None,
        db=db,
        session={},
    )

    assert customer.outstanding_balance == Decimal("0.00")
    assert response["collection"]["amount"] == 80.0
    assert response["collection"]["receipt_code"] == "QGH7ABC123"
    assert db.add.call_args.args[0].mpesa_receipt_number == "QGH7ABC123"


def test_manual_credit_collection_is_blocked_when_stk_is_enforced(monkeypatch) -> None:
    user = SimpleNamespace(id="user-1")
    db = MagicMock()
    db.get.return_value = SimpleNamespace(force_mpesa_prompt=True)
    monkeypatch.setattr(customers_api, "validate_csrf", lambda *_: None)
    monkeypatch.setattr(customers_api, "require_user", lambda *_: user)
    monkeypatch.setattr(
        customers_api,
        "assert_merchant_section_any_access",
        lambda *_: None,
    )
    monkeypatch.setattr(
        customers_api,
        "require_merchant_account_id",
        lambda *_: "acct-1",
    )

    with pytest.raises(customers_api.HTTPException) as exc_info:
        customers_api.manually_collect_customer_credit(
            "cust-1",
            customers_api.ManualCreditCollectRequest(),
            request=None,
            db=db,
            session={},
        )

    assert exc_info.value.status_code == 403
    db.query.assert_not_called()


def test_customer_tab_attributes_balance_to_newest_sales(monkeypatch) -> None:
    from datetime import datetime

    from app.models import MpesaTransaction, Order, OrderItem

    customer = ShopCustomer(
        id="cust-1",
        account_id="acct-1",
        name="Amina",
        phone="254700000001",
        credit_limit=Decimal("0.00"),
        outstanding_balance=Decimal("750.00"),
    )

    def make_order(order_id: str, total: str, day: int) -> Order:
        order = Order(
            id=order_id,
            order_number=f"N-{order_id}",
            total=Decimal(total),
            created_at=datetime(2026, 10, day),
        )
        order.items = [
            OrderItem(
                id=f"{order_id}-line",
                product_name="Sugar 1kg",
                quantity=2,
                unit_price=Decimal(total) / 2,
                line_total=Decimal(total),
            )
        ]
        return order

    newest, middle, oldest = (
        make_order("o3", "300.00", 3),
        make_order("o2", "400.00", 2),
        make_order("o1", "500.00", 1),
    )
    payment = MpesaTransaction(
        id="pay-1",
        amount=450,
        credit_collect_amount=450,
        credit_collected_at=datetime(2026, 10, 2),
        callback_payload={"manual_credit_collection": True, "payment_amount": "450.00"},
    )

    db = MagicMock()
    order_query = MagicMock()
    order_query.options.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        newest,
        middle,
        oldest,
    ]
    payment_query = MagicMock()
    payment_query.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        payment
    ]
    db.query.side_effect = lambda model: order_query if model is Order else payment_query

    monkeypatch.setattr(customers_api, "require_user", lambda *_: SimpleNamespace(id="u"))
    monkeypatch.setattr(customers_api, "assert_merchant_section_any_access", lambda *_: None)
    monkeypatch.setattr(customers_api, "require_merchant_account_id", lambda *_: "acct-1")
    monkeypatch.setattr(
        customers_api.CustomerService, "get_customer", lambda self, *_: customer
    )

    data = customers_api.get_customer_tab("cust-1", db=db, session={})["data"]

    assert [(s["id"], s["amount_due"], s["state"]) for s in data["sales"]] == [
        ("o3", 300.0, "unpaid"),
        ("o2", 400.0, "unpaid"),
        ("o1", 50.0, "partial"),
    ]
    assert data["opening_balance_due"] == 0.0
    assert data["sales"][0]["items"][0]["name"] == "Sugar 1kg"
    assert data["payments"][0]["amount"] == 450.0
    assert data["payments"][0]["manual"] is True
