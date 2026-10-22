"""Kitchen staff clock-in and stock-confirmed clock-out."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, User
from app.services.kitchen_shift_service import KitchenShiftError, clock_in, clock_out, shift_state
from app.services.order_stock_service import kitchen_issuing_on
from app.support.merchant_permissions import active_account_id, assert_merchant_section_any_access
from app.support.store_type import require_restaurant_account

router = APIRouter(prefix="/kitchen-sessions", tags=["kitchen-sessions"])


class StockConfirmation(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(ge=0, le=99_999_999.999, decimal_places=3)


class ClockInRequest(BaseModel):
    items: list[StockConfirmation] = Field(max_length=1000)


class StockCount(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(ge=0, le=99_999_999.999, decimal_places=3)


class ClockOutRequest(BaseModel):
    items: list[StockCount] = Field(max_length=1000)
    note: str | None = Field(default=None, max_length=1000)
    orders_cleared: bool


def _shop(db: Session, session: dict) -> tuple[User, Account]:
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "dashboard", "orders")
    account = require_restaurant_account(db, str(active_account_id(user)))
    if not kitchen_issuing_on(account):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Turn on store and kitchen in Settings before starting a kitchen shift.",
        )
    return user, account


@router.get("")
def get_shift(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account = _shop(db, session)
    return {"data": shift_state(db, account.id)}


@router.post("/clock-in", status_code=status.HTTP_201_CREATED)
def post_clock_in(
    payload: ClockInRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    confirmations: dict[str, Decimal] = {}
    for row in payload.items:
        if row.inventory_item_id in confirmations:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Each kitchen item can be confirmed once.")
        confirmations[row.inventory_item_id] = row.quantity
    try:
        clock_in(db, account, user.id, confirmations)
        db.commit()
    except KitchenShiftError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"message": "Kitchen shift started.", "data": shift_state(db, account.id)}


@router.post("/clock-out")
def post_clock_out(
    payload: ClockOutRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    counts: dict[str, Decimal] = {}
    for row in payload.items:
        if row.inventory_item_id in counts:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Each kitchen item can be counted once.")
        counts[row.inventory_item_id] = row.quantity
    try:
        clock_out(db, account.id, user.id, counts, payload.note, payload.orders_cleared)
        db.commit()
    except KitchenShiftError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"message": "Kitchen shift closed and stock reconciled.", "data": shift_state(db, account.id)}
