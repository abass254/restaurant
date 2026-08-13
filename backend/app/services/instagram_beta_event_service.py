from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import InstagramBetaEvent

logger = logging.getLogger(__name__)

EVENT_CONNECT_STARTED = "connect_started"
EVENT_CHALLENGE_REQUIRED = "challenge_required"
EVENT_CHALLENGE_SUBMITTED = "challenge_submitted"
EVENT_CONNECT_SUCCEEDED = "connect_succeeded"
EVENT_CONNECT_FAILED = "connect_failed"
EVENT_SESSION_INVALID = "session_invalid"
EVENT_OUTBOUND_SENT = "outbound_sent"
EVENT_OUTBOUND_FAILED = "outbound_failed"

STATUS_PENDING = "pending"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"


class InstagramBetaEventService:
    def __init__(self, db: Session):
        self.db = db

    def record(
        self,
        *,
        merchant_account_id: str,
        event_type: str,
        status: str,
        instagram_username: str | None = None,
        instagram_account_id: str | None = None,
        instagram_beta_account_id: str | None = None,
        message: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> InstagramBetaEvent:
        now = datetime.now(timezone.utc)
        event = InstagramBetaEvent(
            account_id=merchant_account_id,
            instagram_account_id=instagram_account_id,
            instagram_beta_account_id=instagram_beta_account_id,
            event_type=event_type,
            status=status,
            instagram_username=instagram_username,
            message=(message or "")[:500] or None,
            metadata_json=metadata or {},
            created_at=now,
            updated_at=now,
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        logger.info(
            "Instagram Beta event type=%s status=%s merchant=%s username=%s id=%s",
            event_type,
            status,
            merchant_account_id,
            instagram_username,
            event.id,
        )
        return event

    def latest_pending_challenge(
        self,
        merchant_account_id: str,
        *,
        instagram_username: str | None = None,
    ) -> InstagramBetaEvent | None:
        query = (
            self.db.query(InstagramBetaEvent)
            .filter(
                InstagramBetaEvent.account_id == merchant_account_id,
                InstagramBetaEvent.event_type == EVENT_CHALLENGE_REQUIRED,
                InstagramBetaEvent.status == STATUS_PENDING,
            )
            .order_by(InstagramBetaEvent.created_at.desc())
        )
        if instagram_username:
            query = query.filter(
                InstagramBetaEvent.instagram_username == instagram_username.lstrip("@"),
            )
        return query.first()

    def resolve_pending_challenge(
        self,
        merchant_account_id: str,
        *,
        instagram_username: str | None = None,
        succeeded: bool,
        message: str | None = None,
    ) -> None:
        pending = self.latest_pending_challenge(
            merchant_account_id,
            instagram_username=instagram_username,
        )
        if pending is None:
            return
        pending.status = STATUS_SUCCEEDED if succeeded else STATUS_FAILED
        pending.message = (message or pending.message or "")[:500] or pending.message
        pending.updated_at = datetime.now(timezone.utc)
        self.db.commit()

    def recent_events(
        self,
        merchant_account_id: str,
        *,
        limit: int = 20,
    ) -> list[InstagramBetaEvent]:
        return (
            self.db.query(InstagramBetaEvent)
            .filter(InstagramBetaEvent.account_id == merchant_account_id)
            .order_by(InstagramBetaEvent.created_at.desc())
            .limit(min(max(limit, 1), 100))
            .all()
        )

    @staticmethod
    def to_dict(event: InstagramBetaEvent) -> dict[str, Any]:
        metadata = event.metadata_json if isinstance(event.metadata_json, dict) else {}
        return {
            "id": event.id,
            "event_type": event.event_type,
            "status": event.status,
            "instagram_username": event.instagram_username,
            "message": event.message,
            "metadata": metadata,
            "created_at": event.created_at.isoformat() if event.created_at else None,
        }
