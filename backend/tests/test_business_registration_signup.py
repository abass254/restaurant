from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Account, User, UserMembership
from app.services.registration import BusinessRegistrationService


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_signup_user_creates_restaurant_account_and_owner_membership() -> None:
    db = _session()
    user = BusinessRegistrationService(db).signup_user(
        name="Amina Owner",
        email="amina@example.com",
        password="secure-password",
        phone="+254700000000",
        shop={
            "business_name": "Green Garden Cafe",
            "business_location": "Nairobi",
            "business_category": "Cafe & Coffee",
            "store_type": "restaurant",
            "admin_phone": "+254700000000",
        },
    )

    account = db.query(Account).one()
    membership = db.query(UserMembership).one()

    assert user.account_id == account.id
    assert account.business_name == "Green Garden Cafe"
    assert account.store_type == "restaurant"
    assert account.business_category == "Cafe & Coffee"
    assert membership.user_id == user.id
    assert membership.account_id == account.id
    assert membership.role == "system_admin"
    db.close()


def test_signup_user_without_shop_remains_supported() -> None:
    db = _session()
    user = BusinessRegistrationService(db).signup_user(
        name="Retail Owner",
        email="retail@example.com",
        password="secure-password",
    )

    assert user.account_id is None
    assert db.query(Account).count() == 0
    assert db.query(UserMembership).count() == 0
    db.close()


def test_signup_user_rejects_restaurant_category_for_retail_store() -> None:
    db = _session()

    try:
        BusinessRegistrationService(db).signup_user(
            name="Invalid Owner",
            email="invalid@example.com",
            password="secure-password",
            shop={
                "business_name": "Green Garden Cafe",
                "business_location": "Nairobi",
                "business_category": "Cafe & Coffee",
                "store_type": "retail",
            },
        )
    except ValueError as exc:
        assert str(exc) == "Choose a valid category for this business type."
    else:
        raise AssertionError("Expected an invalid store/category combination to fail")

    assert db.query(User).count() == 0
    db.close()
