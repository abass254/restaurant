"""POST /inventory for a product the shop already has returns the existing row."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from app.api.v1 import inventory
from app.api.v1.inventory import InventoryCreate


class _Query:
    def __init__(self, item):
        self.item = item

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.item


class _Db:
    def __init__(self, existing):
        self.existing = existing
        self.product = SimpleNamespace(id="prod-1", is_service=lambda: False)
        self.commits = 0
        self.added = []

    def get(self, _model, _id):
        return self.product

    def query(self, *_args):
        return _Query(self.existing)

    def commit(self):
        self.commits += 1

    def refresh(self, *_args, **_kwargs):
        pass

    def add(self, obj):
        self.added.append(obj)


@pytest.fixture(autouse=True)
def _stub_auth(monkeypatch):
    monkeypatch.setattr(inventory, "validate_csrf", lambda *_a, **_k: None)
    monkeypatch.setattr(inventory, "_auth_inventory_user", lambda *_a, **_k: SimpleNamespace(id="u1"))
    monkeypatch.setattr(inventory, "_require_shop", lambda _u: "acct")
    monkeypatch.setattr(
        inventory.InventoryItemOut,
        "from_model",
        classmethod(lambda _cls, item: {"id": item.id, "is_active": item.is_active}),
    )


def _call(db, **payload):
    response = Response()
    body = inventory.create_inventory_item(
        InventoryCreate(product_id="prod-1", **payload),
        request=None,
        response=response,
        db=db,
        session={},
    )
    return response, body


def test_existing_inactive_item_is_reactivated_and_returned():
    existing = SimpleNamespace(id="inv-1", is_active=False, updated_at=None)
    db = _Db(existing)
    response, body = _call(db, stock_quantity=Decimal("0"))
    assert response.status_code == 200
    assert body["data"] == {"id": "inv-1", "is_active": True}
    assert db.commits == 1
    assert db.added == []


def test_existing_active_item_is_returned_without_writes():
    existing = SimpleNamespace(id="inv-1", is_active=True, updated_at=None)
    db = _Db(existing)
    response, body = _call(db, stock_quantity=Decimal("0"))
    assert response.status_code == 200
    assert body["data"]["id"] == "inv-1"
    assert db.commits == 0


def test_existing_item_with_opening_quantity_still_rejected():
    existing = SimpleNamespace(id="inv-1", is_active=True, updated_at=None)
    with pytest.raises(HTTPException) as exc:
        _call(_Db(existing), stock_quantity=Decimal("5"))
    assert exc.value.status_code == 422
