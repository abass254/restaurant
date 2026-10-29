from __future__ import annotations

from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.inventory import delete_inventory_item
from app.database import Base
from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    PreparedMenuStock,
    StockMovement,
    User,
    UserMembership,
)

ACCOUNT_ID = "acct-test-1"
USER_ID = "usr-test-1"


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()

    account = Account(
        id=ACCOUNT_ID,
        business_name="Test Restaurant",
        business_location="Nairobi",
        business_category="Restaurant",
    )
    user = User(id=USER_ID, name="Chef", email="chef@test.com", password="hash")
    membership = UserMembership(
        id="mem-1",
        user_id=USER_ID,
        account_id=ACCOUNT_ID,
        role="system_admin",
        is_active=True,
    )
    session.add_all([account, user, membership])
    session.commit()

    yield session
    session.close()


def test_delete_inventory_item_removes_item_and_prepared_stock(db):
    product = Catalogue(
        id="prod-beef-stew",
        name="Beef Stew",
        slug="beef-stew",
        product_type="meal",
        created_by_account_id=ACCOUNT_ID,
    )
    item = InventoryItem(
        id="inv-beef-stew",
        account_id=ACCOUNT_ID,
        product_id="prod-beef-stew",
        selling_price=450,
        is_active=True,
    )
    db.add_all([product, item])
    db.commit()
    prepared = PreparedMenuStock(
        id="prep-1",
        inventory_item_id="inv-beef-stew",
        serving_unit="plates",
        quantity=5,
    )
    db.add(prepared)
    db.commit()

    request = MagicMock()
    request.headers = {"authorization": "Bearer token"}
    request.cookies = {}
    session_data = {"user_id": USER_ID, "active_account_id": ACCOUNT_ID}

    res = delete_inventory_item("inv-beef-stew", request=request, db=db, session=session_data)
    assert res == {"message": "Removed from inventory."}

    # Verify inventory item is deleted
    assert db.query(InventoryItem).filter_by(id="inv-beef-stew").first() is None
    # Verify prepared stock is cleaned up
    assert db.query(PreparedMenuStock).filter_by(inventory_item_id="inv-beef-stew").first() is None
    # Verify catalog product owned by this account with no other references was deleted
    assert db.query(Catalogue).filter_by(id="prod-beef-stew").first() is None


def test_delete_inventory_item_with_stock_movement_raises_400(db):
    product = Catalogue(
        id="prod-rice",
        name="Rice",
        slug="rice",
        product_type="meal",
        created_by_account_id=ACCOUNT_ID,
    )
    item = InventoryItem(
        id="inv-rice",
        account_id=ACCOUNT_ID,
        product_id="prod-rice",
        selling_price=100,
        is_active=True,
    )
    movement = StockMovement(
        id="mov-1",
        account_id=ACCOUNT_ID,
        inventory_item_id="inv-rice",
        direction="out",
        quantity=1,
        reason="sale",
    )
    db.add_all([product, item, movement])
    db.commit()

    request = MagicMock()
    request.headers = {"authorization": "Bearer token"}
    request.cookies = {}
    session_data = {"user_id": USER_ID, "active_account_id": ACCOUNT_ID}

    with pytest.raises(HTTPException) as exc_info:
        delete_inventory_item("inv-rice", request=request, db=db, session=session_data)
    assert exc_info.value.status_code == 400
    assert "Cannot delete this item" in exc_info.value.detail

