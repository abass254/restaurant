"""Restaurant store-to-kitchen issuing: requests, issues, returns and switching it on."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, User
from app.services.kitchen_issue_service import (
    KitchenIssueError,
    KitchenIssueNotFound,
    cancel_issue,
    create_issue,
    disable_kitchen_issuing,
    enable_kitchen_issuing,
    get_issue,
    issue_out,
    kitchen_item_out,
    kitchen_supplies,
    list_issues,
    release_issue,
    return_to_store,
    record_kitchen_used,
    suggest_issue,
)
from app.services.order_stock_service import kitchen_issuing_on
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
    require_store_admin,
)
from app.support.store_type import is_restaurant, require_restaurant_account

router = APIRouter(prefix="/kitchen-issues", tags=["kitchen-issues"])

Qty = Field(ge=0, le=99_999_999.999, decimal_places=3)


class ItemQty(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Qty


class IssueCreate(BaseModel):
    lines: list[ItemQty] = Field(min_length=1, max_length=500)
    issue_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    issue_now: bool = False


class IssueLineQty(BaseModel):
    line_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Qty


class IssueRelease(BaseModel):
    lines: list[IssueLineQty] | None = Field(default=None, max_length=500)


class ReturnRequest(BaseModel):
    lines: list[ItemQty] = Field(min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=500)


class UsedRequest(BaseModel):
    lines: list[ItemQty] = Field(min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=500)
    reason: Literal["adjustment", "wastage"] = "adjustment"


class EnableRequest(BaseModel):
    opening_counts: list[ItemQty] = Field(default_factory=list, max_length=1000)


def _shop(db: Session, session: dict) -> tuple[User, Account]:
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "dashboard")
    account = require_restaurant_account(db, str(active_account_id(user)))
    return user, account


def _error(exc: KitchenIssueError) -> HTTPException:
    code = status.HTTP_404_NOT_FOUND if isinstance(exc, KitchenIssueNotFound) else status.HTTP_422_UNPROCESSABLE_ENTITY
    return HTTPException(code, detail=str(exc))


def _stock(db: Session, account: Account) -> dict:
    if is_restaurant(account) and not account.kitchen_issuing_enabled:
        account.kitchen_issuing_enabled = True
        db.flush()
    items = kitchen_supplies(db, account.id)
    return {
        "enabled": True,
        "items": [kitchen_item_out(item) for item in items],
    }


@router.get("")
def get_issues(
    status_filter: Literal["requested", "issued", "cancelled"] | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account = _shop(db, session)
    rows = list_issues(db, account.id, status=status_filter)
    return {"data": [issue_out(row, with_lines=False) for row in rows]}


@router.get("/stock")
def get_kitchen_stock(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account = _shop(db, session)
    return {"data": _stock(db, account)}


@router.get("/suggest")
def get_suggestion(
    days: int = Query(default=7, ge=1, le=60),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account = _shop(db, session)
    if not kitchen_issuing_on(account):
        raise _error(KitchenIssueError("Turn on store and kitchen in Settings first."))
    return {"data": suggest_issue(db, account.id, days=days)}


@router.post("", status_code=status.HTTP_201_CREATED)
def post_issue(
    payload: IssueCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    try:
        issue = create_issue(
            db,
            account,
            [(row.inventory_item_id, row.quantity) for row in payload.lines],
            user_id=user.id,
            issue_date=payload.issue_date,
            notes=payload.notes,
            issue_now=payload.issue_now,
        )
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    message = "Issued to the kitchen." if payload.issue_now else "Request sent to the store."
    return {"message": message, "data": issue_out(get_issue(db, account.id, issue.id))}


@router.post("/return")
def post_return(
    payload: ReturnRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    try:
        return_to_store(
            db,
            account,
            [(row.inventory_item_id, row.quantity) for row in payload.lines],
            user_id=user.id,
            note=payload.note,
        )
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    return {"message": "Returned to the store.", "data": _stock(db, account)}


@router.post("/used")
def post_used(
    payload: UsedRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    try:
        record_kitchen_used(
            db,
            account,
            [(row.inventory_item_id, row.quantity) for row in payload.lines],
            user_id=user.id,
            note=payload.note,
            reason=payload.reason,
        )
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    return {"message": "Recorded kitchen usage.", "data": _stock(db, account)}


@router.post("/enable")
def post_enable(
    payload: EnableRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    require_store_admin(user, "Only the store admin can turn on store and kitchen.")
    counts: dict[str, Decimal] = {}
    for row in payload.opening_counts:
        counts[row.inventory_item_id] = counts.get(row.inventory_item_id, Decimal("0")) + row.quantity
    try:
        enable_kitchen_issuing(db, account, counts, user_id=user.id)
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    return {"message": "Store and kitchen turned on.", "data": _stock(db, account)}


@router.post("/disable")
def post_disable(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    require_store_admin(user, "Only the store admin can turn off store and kitchen.")
    try:
        disable_kitchen_issuing(db, account, user_id=user.id)
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    return {"message": "Store and kitchen turned off.", "data": _stock(db, account)}


@router.get("/{issue_id}")
def get_one(
    issue_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account = _shop(db, session)
    try:
        return {"data": issue_out(get_issue(db, account.id, issue_id))}
    except KitchenIssueError as exc:
        raise _error(exc) from exc


@router.post("/{issue_id}/issue")
def post_release(
    issue_id: str,
    payload: IssueRelease,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account = _shop(db, session)
    quantities = {row.line_id: row.quantity for row in payload.lines} if payload.lines else None
    try:
        release_issue(db, account, issue_id, quantities, user_id=user.id)
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    return {"message": "Issued to the kitchen.", "data": issue_out(get_issue(db, account.id, issue_id))}


@router.post("/{issue_id}/cancel")
def post_cancel(
    issue_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account = _shop(db, session)
    try:
        cancel_issue(db, account.id, issue_id)
    except KitchenIssueError as exc:
        db.rollback()
        raise _error(exc) from exc
    db.commit()
    return {"message": "Request cancelled.", "data": issue_out(get_issue(db, account.id, issue_id))}
