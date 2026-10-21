from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload

from app.models import ShopExpense
from app.schemas import ExpenseCreate, ExpenseUpdate


def list_expenses(
    db: Session,
    account_id: str,
    start: datetime | None = None,
    end: datetime | None = None,
    category: str | None = None,
    limit: int = 200,
) -> list[ShopExpense]:
    query = (
        db.query(ShopExpense)
        .options(joinedload(ShopExpense.user))
        .filter(ShopExpense.account_id == account_id)
    )
    if start:
        query = query.filter(ShopExpense.spent_at >= start)
    if end:
        query = query.filter(ShopExpense.spent_at <= end)
    if category:
        query = query.filter(ShopExpense.category == category)

    return query.order_by(ShopExpense.spent_at.desc()).limit(limit).all()


def create_expense(
    db: Session,
    account_id: str,
    user_id: str | None,
    data: ExpenseCreate,
) -> ShopExpense:
    now = datetime.utcnow()
    spent_at = data.spent_at or now
    expense = ShopExpense(
        account_id=account_id,
        user_id=user_id,
        title=data.title.strip(),
        category=(data.category or "errand").strip().lower(),
        amount=Decimal(str(data.amount)),
        payment_method=(data.payment_method or "cash").strip().lower(),
        spent_at=spent_at,
        notes=data.notes.strip() if data.notes else None,
        created_at=now,
        updated_at=now,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


def delete_expense(db: Session, account_id: str, expense_id: str) -> bool:
    expense = (
        db.query(ShopExpense)
        .filter(ShopExpense.id == expense_id, ShopExpense.account_id == account_id)
        .first()
    )
    if not expense:
        return False
    db.delete(expense)
    db.commit()
    return True
