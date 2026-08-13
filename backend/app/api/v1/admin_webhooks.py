"""Super-admin webhook event log endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.v1.admin_auth import require_super_admin
from app.database import get_db
from app.models import User, WebhookEvent
from app.support.webhook_event_summary import summarize_webhook_payload

router = APIRouter(tags=["admin-webhooks"])


class AdminWebhookEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    received_at: datetime
    signature_valid: bool
    signature_secret: str | None
    http_status: int
    object: str | None
    event_type: str | None
    sender_id: str | None
    recipient_id: str | None
    preview: str | None
    processing_result: str | None
    payload: dict | list | str | int | float | bool | None = None


class AdminWebhookEventsResponse(BaseModel):
    data: list[AdminWebhookEventOut]
    total: int


def _event_to_out(event: WebhookEvent, *, include_payload: bool = False) -> AdminWebhookEventOut:
    event_type = event.event_type
    sender_id = event.sender_id
    recipient_id = event.recipient_id
    preview = event.preview

    if isinstance(event.payload, dict) and (
        not event_type or not preview
    ):
        summary = summarize_webhook_payload(event.payload)
        event_type = event_type or summary["event_type"]
        sender_id = sender_id or summary["sender_id"]
        recipient_id = recipient_id or summary["recipient_id"]
        preview = preview or summary["preview"]

    return AdminWebhookEventOut(
        id=event.id,
        received_at=event.received_at,
        signature_valid=event.signature_valid,
        signature_secret=event.signature_secret,
        http_status=event.http_status,
        object=event.object,
        event_type=event_type,
        sender_id=sender_id,
        recipient_id=recipient_id,
        preview=preview,
        processing_result=event.processing_result,
        payload=event.payload if include_payload else None,
    )


@router.get("/webhook-events", response_model=AdminWebhookEventsResponse)
def list_webhook_events(
    q: str = "",
    http_status: int | None = Query(None, ge=100, le=599),
    limit: int = Query(100, ge=1, le=500),
    _: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> AdminWebhookEventsResponse:
    query = db.query(WebhookEvent).order_by(WebhookEvent.received_at.desc())

    if http_status is not None:
        query = query.filter(WebhookEvent.http_status == http_status)

    rows = query.limit(limit * 3 if q.strip() else limit).all()

    needle = q.strip().lower()
    if needle:
        filtered: list[WebhookEvent] = []
        for row in rows:
            summary = _event_to_out(row)
            haystack = " ".join(
                part
                for part in [
                    summary.event_type or "",
                    summary.preview or "",
                    summary.sender_id or "",
                    summary.recipient_id or "",
                    summary.processing_result or "",
                    summary.object or "",
                    summary.signature_secret or "",
                ]
                if part
            ).lower()
            if needle in haystack:
                filtered.append(row)
            if len(filtered) >= limit:
                break
        rows = filtered
    else:
        rows = rows[:limit]

    data = [_event_to_out(row) for row in rows]
    return AdminWebhookEventsResponse(data=data, total=len(data))


@router.get("/webhook-events/{event_id}", response_model=AdminWebhookEventOut)
def get_webhook_event(
    event_id: str,
    _: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> AdminWebhookEventOut:
    event = db.query(WebhookEvent).filter(WebhookEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Webhook event not found.")
    return _event_to_out(event, include_payload=True)
