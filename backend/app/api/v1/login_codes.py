"""Merchant tools — recent login code delivery status."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.core.session import require_user
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Rider, RiderLoginCode, User, UserLoginCode, UserMembership
from app.schemas import LoginCodeOut, LoginCodesListResponse
from app.services.merchant_login_otp import _mask_email, _mask_phone
from app.services.rider_service import normalize_phone
from app.support.datetime_utils import as_utc
from app.support.merchant_permissions import active_account_id, assert_merchant_section_access
from app.support.internal_tools_access import require_internal_tools_user

router = APIRouter(prefix="/login-codes", tags=["login-codes"])


def _iso(dt: datetime | None) -> str | None:
    aware = as_utc(dt)
    return aware.isoformat() if aware else None


def _lifecycle(
    *,
    consumed_at: datetime | None,
    expires_at: datetime | None,
    now: datetime,
) -> str:
    if consumed_at is not None:
        return "used"
    exp = as_utc(expires_at)
    if exp and exp < now:
        return "expired"
    return "active"


def _merchant_user_ids(db: Session, account_id: str) -> list[str]:
    member_ids = {
        row[0]
        for row in db.query(UserMembership.user_id)
        .filter(UserMembership.account_id == account_id)
        .all()
    }
    owner_ids = {
        row[0] for row in db.query(User.id).filter(User.account_id == account_id).all()
    }
    return list(member_ids | owner_ids)


def _recipient_masked(*, channel: str | None, email: str | None, phone: str | None) -> str | None:
    if channel == "email" and email:
        return _mask_email(email)
    if phone:
        return _mask_phone(normalize_phone(phone))
    if email:
        return _mask_email(email)
    return None


@router.get("", response_model=LoginCodesListResponse)
def list_login_codes(
    audience: str = Query("all", pattern="^(all|merchant|rider)$"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)
    account_id = active_account_id(user)
    now = datetime.now(timezone.utc)
    rows: list[LoginCodeOut] = []

    if audience in ("all", "merchant"):
        user_ids = _merchant_user_ids(db, account_id)
        if user_ids:
            codes = (
                db.query(UserLoginCode)
                .options(joinedload(UserLoginCode.user))
                .filter(UserLoginCode.user_id.in_(user_ids))
                .order_by(UserLoginCode.created_at.desc())
                .limit(limit)
                .all()
            )
            for code in codes:
                subject = code.user
                rows.append(
                    LoginCodeOut(
                        id=code.id,
                        audience="merchant",
                        recipient_name=subject.name if subject else None,
                        recipient_masked=_recipient_masked(
                            channel=code.channel,
                            email=subject.email if subject else None,
                            phone=subject.phone if subject else None,
                        ),
                        channel=code.channel,
                        delivery_status=code.delivery_status or "unknown",
                        lifecycle_status=_lifecycle(
                            consumed_at=code.consumed_at,
                            expires_at=code.expires_at,
                            now=now,
                        ),
                        purpose=code.purpose,
                        created_at=_iso(code.created_at),
                        expires_at=_iso(code.expires_at),
                        consumed_at=_iso(code.consumed_at),
                    ),
                )

    if audience in ("all", "rider"):
        codes = (
            db.query(RiderLoginCode)
            .join(Rider, RiderLoginCode.rider_id == Rider.id)
            .options(joinedload(RiderLoginCode.rider))
            .filter(Rider.account_id == account_id)
            .order_by(RiderLoginCode.created_at.desc())
            .limit(limit)
            .all()
        )
        for code in codes:
            rider = code.rider
            rows.append(
                LoginCodeOut(
                    id=code.id,
                    audience="rider",
                    recipient_name=rider.name if rider else None,
                    recipient_masked=_recipient_masked(
                        channel=code.channel,
                        email=rider.email if rider else None,
                        phone=rider.phone if rider else None,
                    ),
                    channel=code.channel,
                    delivery_status=code.delivery_status or "unknown",
                    lifecycle_status=_lifecycle(
                        consumed_at=code.consumed_at,
                        expires_at=code.expires_at,
                        now=now,
                    ),
                    purpose="login",
                    created_at=_iso(code.created_at),
                    expires_at=_iso(code.expires_at),
                    consumed_at=_iso(code.consumed_at),
                ),
            )

    rows.sort(key=lambda row: row.created_at or "", reverse=True)
    return LoginCodesListResponse(data=rows[:limit])
