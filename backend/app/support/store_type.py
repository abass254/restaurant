"""Retail vs restaurant shop checks.

Restaurant shops get purchase orders, the stock ledger on sales, recipe costing
and stock takes. Retail shops keep their original stock flows untouched.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Account

RESTAURANT = "restaurant"


def is_restaurant(account: Account | None) -> bool:
    return (getattr(account, "store_type", None) or "").strip().lower() == RESTAURANT


def is_restaurant_account(db: Session, account_id: str | None) -> bool:
    if not account_id:
        return False
    return is_restaurant(db.get(Account, str(account_id)))


def require_restaurant_account(db: Session, account_id: str) -> Account:
    account = db.get(Account, str(account_id))
    if not is_restaurant(account):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="This feature is only available for restaurant shops.",
        )
    return account
