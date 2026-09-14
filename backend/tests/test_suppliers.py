"""Tests for shop suppliers."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.services.rider_service import normalize_phone
from app.services.supplier_service import SupplierService, SupplierServiceError


def test_create_supplier_rejects_empty_name() -> None:
    service = SupplierService(MagicMock())
    with pytest.raises(SupplierServiceError, match="name is required"):
        service.create_supplier("acct-1", name="  ", phone="+254700000001")


def test_create_supplier_rejects_duplicate_phone() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = MagicMock()
    service = SupplierService(db)
    with pytest.raises(SupplierServiceError, match="already exists"):
        service.create_supplier("acct-1", name="Nairobi Distributors", phone="0700000001")


def test_create_supplier_persists_normalized_phone() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    captured = {}

    def capture_add(obj) -> None:
        captured["supplier"] = obj
        obj.id = "sup-1"

    db.add.side_effect = capture_add

    service = SupplierService(db)
    supplier = service.create_supplier(
        "acct-1",
        name=" Nairobi Distributors ",
        phone="0700 000 001",
        notes="Weekly delivery",
    )

    assert supplier is captured["supplier"]
    assert captured["supplier"].name == "Nairobi Distributors"
    assert captured["supplier"].phone == normalize_phone("0700000001")
    assert captured["supplier"].notes == "Weekly delivery"
    db.commit.assert_called_once()


def test_update_supplier_rejects_empty_name() -> None:
    db = MagicMock()
    existing = MagicMock()
    existing.id = "sup-1"
    existing.phone = normalize_phone("0700000001")
    db.query.return_value.filter.return_value.first.return_value = existing

    service = SupplierService(db)
    with pytest.raises(SupplierServiceError, match="name is required"):
        service.update_supplier("acct-1", "sup-1", name="  ")


def test_delete_supplier_removes_row() -> None:
    db = MagicMock()
    existing = MagicMock()
    existing.id = "sup-1"
    db.query.return_value.filter.return_value.first.return_value = existing

    service = SupplierService(db)
    service.delete_supplier("acct-1", "sup-1")
    db.delete.assert_called_once_with(existing)
    db.commit.assert_called_once()
