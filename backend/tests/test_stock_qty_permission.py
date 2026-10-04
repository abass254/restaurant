"""Who may change inventory quantities: owners always, staff via the setting."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1 import inventory
from app.support import merchant_permissions


class _FakeDb:
    def __init__(self, account):
        self.account = account

    def get(self, _model, _account_id):
        return self.account


def _user():
    return SimpleNamespace(is_super_admin=lambda: False, is_system_admin=lambda: False)


@pytest.fixture
def as_member(monkeypatch):
    def apply(owner: bool):
        monkeypatch.setattr(merchant_permissions, "get_active_membership", lambda _u: object())
        monkeypatch.setattr(merchant_permissions, "is_membership_owner", lambda _u: owner)

    return apply


def test_owner_can_adjust_even_when_setting_off(as_member):
    as_member(owner=True)
    user = _user()
    db = _FakeDb(SimpleNamespace(allow_item_quantity_adjustment=False))
    inventory._require_stock_qty_allowed(db, user, "acct")


def test_staff_can_adjust_when_setting_on(as_member):
    as_member(owner=False)
    user = _user()
    db = _FakeDb(SimpleNamespace(allow_item_quantity_adjustment=True))
    inventory._require_stock_qty_allowed(db, user, "acct")


def test_staff_blocked_when_setting_off(as_member):
    as_member(owner=False)
    user = _user()
    db = _FakeDb(SimpleNamespace(allow_item_quantity_adjustment=False))
    with pytest.raises(HTTPException) as exc:
        inventory._require_stock_qty_allowed(db, user, "acct")
    assert exc.value.status_code == 403
