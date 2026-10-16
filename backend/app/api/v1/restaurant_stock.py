"""Restaurant stock accountability: menu costing, stock card, stock takes and reports."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import User
from app.services.restaurant_stock_service import (
    StockTakeError,
    cancel_stock_take,
    complete_stock_take,
    create_stock_take,
    day_bounds,
    kitchen_day_report,
    list_stock_takes,
    menu_costing,
    profit_report,
    save_counts,
    stock_card,
    stock_take_out,
    usage_report,
)
from app.services.restaurant_stock_service import get_stock_take as load_stock_take
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
    require_store_admin,
)
from app.support.store_type import require_restaurant_account

router = APIRouter(prefix="/restaurant-stock", tags=["restaurant-stock"])

# East Africa Time; dates in reports are local calendar days.
DEFAULT_TZ_OFFSET_MINUTES = 180


class StockTakeCreate(BaseModel):
    inventory_item_ids: list[str] | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)
    location: Literal["store", "kitchen"] = "store"


class CountIn(BaseModel):
    line_id: str = Field(min_length=1, max_length=64)
    counted_qty: Decimal | None = Field(default=None, ge=0, le=99_999_999.999, decimal_places=3)


class CountsRequest(BaseModel):
    counts: list[CountIn] = Field(min_length=1, max_length=1000)


def _shop(db: Session, session: dict, *sections: str) -> tuple[User, str]:
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *(sections or ("inventory", "dashboard")))
    account_id = str(active_account_id(user))
    require_restaurant_account(db, account_id)
    return user, account_id


def _range(start: date | None, end: date | None, tz_offset_minutes: int) -> tuple[datetime, datetime]:
    today = (datetime.utcnow() + timedelta(minutes=tz_offset_minutes)).date()
    end = end or today
    start = start or end - timedelta(days=6)
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Start date is after end date.")
    if (end - start).days > 366:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pick a range of a year or less.")
    return day_bounds(start, end, tz_offset_minutes)


def _not_found_or_invalid(exc: StockTakeError) -> HTTPException:
    message = str(exc)
    code = status.HTTP_404_NOT_FOUND if "not found" in message.lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
    return HTTPException(code, detail=message)


@router.get("/menu-costing")
def get_menu_costing(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session, "inventory", "pos", "dashboard")
    return {"data": menu_costing(db, account_id)}


@router.get("/items/{inventory_item_id}/movements")
def get_stock_card(
    inventory_item_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    try:
        return {"data": stock_card(db, account_id, inventory_item_id, limit=limit)}
    except StockTakeError as exc:
        raise _not_found_or_invalid(exc) from exc


@router.get("/stock-takes")
def get_stock_takes(
    location: Literal["store", "kitchen"] | None = Query(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    takes = list_stock_takes(db, account_id, location)
    return {"data": [stock_take_out(t, with_lines=False) for t in takes]}


@router.post("/stock-takes", status_code=status.HTTP_201_CREATED)
def post_stock_take(
    payload: StockTakeCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account_id = _shop(db, session)
    try:
        take = create_stock_take(
            db,
            account_id,
            user_id=user.id,
            inventory_item_ids=payload.inventory_item_ids,
            notes=payload.notes,
            location=payload.location,
        )
    except StockTakeError as exc:
        db.rollback()
        raise _not_found_or_invalid(exc) from exc
    db.commit()
    return {"message": "Stock take started.", "data": stock_take_out(load_stock_take(db, account_id, take.id))}


@router.get("/stock-takes/{take_id}")
def get_stock_take(
    take_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    try:
        return {"data": stock_take_out(load_stock_take(db, account_id, take_id))}
    except StockTakeError as exc:
        raise _not_found_or_invalid(exc) from exc


@router.post("/stock-takes/{take_id}/counts")
def post_stock_take_counts(
    take_id: str,
    payload: CountsRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _shop(db, session)
    try:
        take = save_counts(
            db, account_id, take_id, {row.line_id: row.counted_qty for row in payload.counts},
        )
    except StockTakeError as exc:
        db.rollback()
        raise _not_found_or_invalid(exc) from exc
    db.commit()
    return {"message": "Counts saved.", "data": stock_take_out(load_stock_take(db, account_id, take.id))}


@router.post("/stock-takes/{take_id}/complete")
def post_complete_stock_take(
    take_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account_id = _shop(db, session)
    require_store_admin(user, "Only the store admin can apply a stock take.")
    try:
        take = complete_stock_take(db, account_id, take_id, user_id=user.id)
    except StockTakeError as exc:
        db.rollback()
        raise _not_found_or_invalid(exc) from exc
    db.commit()
    return {"message": "Stock take applied.", "data": stock_take_out(load_stock_take(db, account_id, take.id))}


@router.post("/stock-takes/{take_id}/cancel")
def post_cancel_stock_take(
    take_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _shop(db, session)
    try:
        take = cancel_stock_take(db, account_id, take_id)
    except StockTakeError as exc:
        db.rollback()
        raise _not_found_or_invalid(exc) from exc
    db.commit()
    return {"message": "Stock take cancelled.", "data": stock_take_out(load_stock_take(db, account_id, take.id))}


@router.get("/reports/usage")
def get_usage_report(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    location: Literal["store", "kitchen"] | None = Query(default=None),
    tz_offset_minutes: int = Query(default=DEFAULT_TZ_OFFSET_MINUTES, ge=-720, le=840),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    begin, finish = _range(start, end, tz_offset_minutes)
    return {"data": usage_report(db, account_id, begin, finish, location)}


@router.get("/reports/kitchen-day")
def get_kitchen_day_report(
    day: date | None = Query(default=None, alias="date"),
    tz_offset_minutes: int = Query(default=DEFAULT_TZ_OFFSET_MINUTES, ge=-720, le=840),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    day = day or (datetime.utcnow() + timedelta(minutes=tz_offset_minutes)).date()
    begin, finish = _range(day, day, tz_offset_minutes)
    try:
        return {"data": kitchen_day_report(db, account_id, begin, finish)}
    except StockTakeError as exc:
        raise _not_found_or_invalid(exc) from exc


@router.get("/reports/profit")
def get_profit_report(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    tz_offset_minutes: int = Query(default=DEFAULT_TZ_OFFSET_MINUTES, ge=-720, le=840),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session, "dashboard", "orders", "inventory")
    begin, finish = _range(start, end, tz_offset_minutes)
    return {"data": profit_report(db, account_id, begin, finish, tz_offset_minutes)}
