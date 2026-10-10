"""Merchant PUT /products/{id}/addons attaches add-ons to a shop-owned meal."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import products
from app.api.v1.products import MealAddonLineIn, MealAddonsReplace
from app.database import Base
from app.models import Catalogue, MealAddon


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    monkeypatch.setattr(products, "validate_csrf", lambda *_a, **_k: None)
    monkeypatch.setattr(products, "require_user", lambda *_a, **_k: SimpleNamespace(id="u1"))
    monkeypatch.setattr(products, "assert_merchant_section_any_access", lambda *_a, **_k: None)
    monkeypatch.setattr(products, "active_account_id", lambda _u: "acct-1")
    session.add_all(
        [
            Catalogue(id="meal-1", name="Beef stew", slug="beef-stew", product_type="product",
                      created_by_account_id=None),
            Catalogue(id="addon-1", name="Extra chapati", slug="extra-chapati", product_type="addon"),
            Catalogue(id="addon-2", name="Kachumbari", slug="kachumbari", product_type="addon"),
            Catalogue(id="retail-1", name="Soda", slug="soda", product_type="retail"),
        ]
    )
    session.commit()
    yield session
    session.close()


def _own_meal(db):
    meal = db.get(Catalogue, "meal-1")
    meal.created_by_account_id = "acct-1"
    db.commit()


def _put(db, *lines: MealAddonLineIn):
    return products.replace_meal_addons(
        "meal-1",
        MealAddonsReplace(addons=list(lines)),
        request=None,
        db=db,
        session={},
    )


def test_replace_attaches_reorders_and_removes(db):
    _own_meal(db)
    body = _put(
        db,
        MealAddonLineIn(addon_id="addon-1", additional_price=20),
        MealAddonLineIn(addon_id="addon-2", additional_price=0),
    )
    assert [a.addon_name for a in body["data"]] == ["Extra chapati", "Kachumbari"]
    assert body["data"][0].additional_price == 20.0
    assert db.get(Catalogue, "meal-1").product_type == "meal"

    body = _put(db, MealAddonLineIn(addon_id="addon-2", additional_price=10))
    assert [a.addon_id for a in body["data"]] == ["addon-2"]
    assert body["data"][0].additional_price == 10.0
    assert db.query(MealAddon).count() == 1


def test_shared_meal_cannot_be_changed(db):
    with pytest.raises(HTTPException) as exc:
        _put(db, MealAddonLineIn(addon_id="addon-1"))
    assert exc.value.status_code == 403


def test_non_addon_items_are_rejected(db):
    _own_meal(db)
    with pytest.raises(HTTPException) as exc:
        _put(db, MealAddonLineIn(addon_id="retail-1"))
    assert exc.value.status_code == 422
