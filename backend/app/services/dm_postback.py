"""Shared Instagram DM postback parsing and ingestion."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.conversation_resolver import find_conversation_for_participant, find_duplicate_message
from app.services.dm_templates import is_menu_back_request, menu_choice_from_text
from app.support.datetime_utils import utc_now


def synthetic_body_from_postback_event(event: dict) -> str | None:
    postback = event.get("postback") or {}
    title = str(postback.get("title") or "").strip()
    payload = str(postback.get("payload") or "").strip()
    synthetic = title or payload
    choice = menu_choice_from_text(synthetic) or menu_choice_from_text(payload)
    if choice is not None:
        synthetic = str(choice)
    elif payload in {"order_yes", "order_no", "delivery_yes", "delivery_no"}:
        synthetic = payload
    elif is_menu_back_request(payload) or is_menu_back_request(title):
        synthetic = "menu"
    elif not synthetic:
        return None
    return synthetic


def parse_postback_timestamp(event: dict) -> datetime:
    timestamp = event.get("timestamp")
    if timestamp in (None, ""):
        return datetime.now(timezone.utc)
    value = int(timestamp)
    if value <= 0:
        return datetime.now(timezone.utc)
    if value < 1_000_000_000_000:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def ingest_postback_message(
    db: Session,
    account: InstagramAccount,
    event: dict,
    synthetic: str,
) -> tuple[InstagramConversation, InstagramMessage] | None:
    sender_id = str((event.get("sender") or {}).get("id") or "")
    if not sender_id:
        return None

    timestamp = parse_postback_timestamp(event)
    conversation = find_conversation_for_participant(account, sender_id)
    if conversation:
        conversation.last_message_at = timestamp
        conversation.updated_at = utc_now()
    else:
        conversation = InstagramConversation(
            instagram_account_id=account.id,
            participant_ig_id=sender_id,
            instagram_conversation_id=f"webhook_{sender_id}",
            last_message_at=timestamp,
            created_at=timestamp,
            updated_at=timestamp,
        )
        db.add(conversation)
        db.flush()
        account.conversations.append(conversation)

    postback = event.get("postback") or {}
    mid = str(postback.get("mid") or f"pb_{uuid.uuid4().hex}")
    existing = find_duplicate_message(
        conversation,
        mid=mid,
        body=synthetic,
        sent_at=timestamp,
        direction="inbound",
    )
    if existing is not None:
        return conversation, existing

    message = InstagramMessage(
        instagram_conversation_id=conversation.id,
        instagram_message_id=mid,
        direction="inbound",
        sender_ig_id=sender_id,
        body=synthetic,
        sent_at=timestamp,
        auto_replied=False,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(message)
    db.flush()
    conversation.messages.append(message)
    db.commit()
    return conversation, message
