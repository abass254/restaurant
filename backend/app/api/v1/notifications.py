"""Merchant in-app notification feed."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import MerchantNotification, User
from app.services.merchant_notification_service import MerchantNotificationService
from app.services.platform_instagram import require_merchant_account_id
from sqlalchemy.orm import Session

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    created_at: datetime | None = None

    @classmethod
    def from_model(cls, row: MerchantNotification) -> NotificationOut:
        return cls(
            id=row.id,
            kind=row.kind,
            title=row.title,
            body=row.body,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            created_at=row.created_at,
        )


class MarkReadRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=50)
    all: bool = False


def _parse_since(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone(tz=None).replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


@router.get("")
def list_notifications(
    since: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
) -> dict:
    user = require_user(db, session)
    account_id = require_merchant_account_id(user)
    service = MerchantNotificationService(db)
    rows = service.list_unread(account_id, since=_parse_since(since), limit=limit)
    return {"data": {"notifications": [NotificationOut.from_model(row) for row in rows]}}


@router.patch("/read")
def mark_notifications_read(
    payload: MarkReadRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
) -> dict:
    validate_csrf(request, session)
    user: User = require_user(db, session)
    account_id = require_merchant_account_id(user)
    service = MerchantNotificationService(db)

    if payload.all:
        count = service.mark_all_read(account_id)
    else:
        count = service.mark_read(account_id, payload.ids)

    return {"data": {"marked": count}}
