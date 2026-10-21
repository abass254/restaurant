"""Shop expenses and daily errands endpoints."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.session import require_user
from app.database import get_db
from app.dependencies import get_request_session
from app.schemas import ExpenseCreate, ExpenseListResponse, ExpenseOut
from app.services.expense_service import (
    create_expense as svc_create_expense,
    delete_expense as svc_delete_expense,
    list_expenses as svc_list_expenses,
)
from app.services.reports_service import DEFAULT_TZ_OFFSET_MINUTES, day_bounds
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
)

router = APIRouter(prefix="/expenses", tags=["expenses"])


def _to_expense_out(exp) -> ExpenseOut:
    return ExpenseOut(
        id=exp.id,
        account_id=exp.account_id,
        user_id=exp.user_id,
        user_name=exp.user.name if exp.user else None,
        title=exp.title,
        category=exp.category,
        amount=float(exp.amount),
        payment_method=exp.payment_method,
        spent_at=exp.spent_at.isoformat() if exp.spent_at else "",
        notes=exp.notes,
        created_at=exp.created_at.isoformat() if exp.created_at else None,
    )


@router.get("", response_model=ExpenseListResponse)
def get_expenses(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    category: str | None = Query(default=None),
    tz_offset_minutes: int = Query(default=DEFAULT_TZ_OFFSET_MINUTES, ge=-720, le=840),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "dashboard", "pos", "orders", "inventory")
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No active shop")

    start_dt: datetime | None = None
    end_dt: datetime | None = None
    if start and end:
        start_dt, end_dt = day_bounds(start, end, tz_offset_minutes)
    elif start:
        start_dt, end_dt = day_bounds(start, start, tz_offset_minutes)

    rows = svc_list_expenses(
        db=db,
        account_id=account_id,
        start=start_dt,
        end=end_dt,
        category=category,
    )

    items = [_to_expense_out(r) for r in rows]
    total_amount = sum(item.amount for item in items)
    return ExpenseListResponse(data=items, total_amount=total_amount, count=len(items))


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
def record_expense(
    payload: ExpenseCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "dashboard", "pos", "orders", "inventory")
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No active shop")

    expense = svc_create_expense(
        db=db,
        account_id=account_id,
        user_id=user.id,
        data=payload,
    )
    return _to_expense_out(expense)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "dashboard", "pos", "orders", "inventory")
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No active shop")

    deleted = svc_delete_expense(db, account_id, expense_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return None
