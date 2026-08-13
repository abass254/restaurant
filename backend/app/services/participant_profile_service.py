from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import InstagramAccount, InstagramConversation
from app.services.instagram_api import InstagramApiService

logger = logging.getLogger(__name__)

_IN_FLIGHT_PROFILE_FETCHES: set[str] = set()
_PROFILE_FETCH_LOCK = threading.Lock()


def enrich_participant_profile(
    db: Session,
    instagram_api: InstagramApiService,
    account: InstagramAccount,
    conversation: InstagramConversation,
) -> None:
    """Fetch username + profile_pic from Instagram for a DM participant."""
    participant_id = str(conversation.participant_ig_id or "")
    if not participant_id or account.platform != "instagram":
        return

    try:
        data = instagram_api.get_user_profile(participant_id, account.access_token())
    except Exception as exc:
        logger.info(
            "Instagram profile lookup failed participant=%s error=%s",
            participant_id,
            exc,
        )
        return

    username = str(data.get("username") or "").strip().lstrip("@")
    if username:
        conversation.participant_username = username

    profile_pic = str(data.get("profile_pic") or "").strip()
    if profile_pic:
        conversation.participant_profile_pic_url = profile_pic

    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()


def schedule_participant_profile_enrichment(
    conversation_id: str,
    account_id: str,
) -> None:
    with _PROFILE_FETCH_LOCK:
        if conversation_id in _IN_FLIGHT_PROFILE_FETCHES:
            return
        _IN_FLIGHT_PROFILE_FETCHES.add(conversation_id)

    thread = threading.Thread(
        target=_run_profile_enrichment,
        args=(conversation_id, account_id),
        daemon=True,
        name=f"ig-profile-{conversation_id[:8]}",
    )
    thread.start()


def _run_profile_enrichment(conversation_id: str, account_id: str) -> None:
    from app.config import get_settings
    from app.database import SessionLocal

    settings = get_settings()
    if settings.instagram_fake_messaging:
        return

    db = SessionLocal()
    try:
        account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
        conversation = (
            db.query(InstagramConversation)
            .filter(InstagramConversation.id == conversation_id)
            .first()
        )
        if account is None or conversation is None:
            return
        enrich_participant_profile(
            db,
            InstagramApiService(settings),
            account,
            conversation,
        )
    except Exception:
        logger.exception("Background profile enrichment failed conversation=%s", conversation_id)
    finally:
        with _PROFILE_FETCH_LOCK:
            _IN_FLIGHT_PROFILE_FETCHES.discard(conversation_id)
        db.close()
