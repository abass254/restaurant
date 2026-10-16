"""Reports endpoints: aggregated analytics and summaries."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.session import require_user
from app.database import get_db
from app.dependencies import get_request_session
from app.services.reports_service import DEFAULT_TZ_OFFSET_MINUTES, reports_summary
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
)

router = APIRouter(prefix="/reports", tags=["reports"])

MAX_RANGE_DAYS = 366


@router.get("/summary")
def get_reports_summary(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    tz_offset_minutes: int = Query(default=DEFAULT_TZ_OFFSET_MINUTES, ge=-720, le=840),
    source: str | None = Query(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "dashboard", "orders", "pos", "inventory")
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No active shop")

    local_now = (datetime.utcnow() + timedelta(minutes=tz_offset_minutes)).date()
    start_date = start or local_now
    end_date = end or local_now

    if start_date > end_date:
        start_date, end_date = end_date, start_date
    if (end_date - start_date).days > MAX_RANGE_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pick a range of a year or less.",
        )

    data = reports_summary(
        db=db,
        account_id=account_id,
        start=start_date,
        end=end_date,
        tz_offset_minutes=tz_offset_minutes,
        source=source,
    )
    return {"data": data}
