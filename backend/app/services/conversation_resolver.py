from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import InstagramAccount, InstagramConversation, InstagramMessage


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def find_conversation_for_participant(
    account: InstagramAccount,
    participant_id: str,
) -> InstagramConversation | None:
    if not participant_id:
        return None

    for conversation in account.conversations:
        if conversation.participant_ig_id == participant_id:
            return conversation

    webhook_key = f"webhook_{participant_id}"
    for conversation in account.conversations:
        if conversation.instagram_conversation_id == webhook_key:
            if conversation.participant_ig_id != participant_id:
                conversation.participant_ig_id = participant_id
            return conversation

    for conversation in account.conversations:
        for message in conversation.messages:
            if message.direction == "inbound" and message.sender_ig_id == participant_id:
                if conversation.participant_ig_id != participant_id:
                    conversation.participant_ig_id = participant_id
                return conversation

    return None


def find_duplicate_message(
    conversation: InstagramConversation,
    *,
    mid: str,
    body: str,
    sent_at: datetime,
    direction: str,
    tolerance_seconds: int = 3,
    ignore_direction: bool = False,
) -> InstagramMessage | None:
    for message in conversation.messages:
        if message.instagram_message_id == mid:
            return message

    target = _as_utc(sent_at)
    body_norm = (body or "").strip()
    for message in conversation.messages:
        if not ignore_direction and message.direction != direction:
            continue
        if (message.body or "").strip() != body_norm:
            continue
        existing_at = _as_utc(message.sent_at)
        if _message_times_match(target, existing_at, tolerance_seconds):
            return message

    return None


def _canonical_conversation(
    left: InstagramConversation,
    right: InstagramConversation,
) -> InstagramConversation:
    def score(conversation: InstagramConversation) -> tuple[int, int, float, str]:
        api_id = conversation.instagram_conversation_id or ""
        is_webhook = 0 if api_id.startswith("webhook_") or api_id.startswith("sim_") else 1
        created_at = _as_utc(conversation.created_at) or datetime.min.replace(tzinfo=timezone.utc)
        # Prefer older conversations as canonical when other dimensions tie.
        return (is_webhook, len(conversation.messages), -created_at.timestamp(), str(conversation.id))

    return left if score(left) >= score(right) else right


def _message_times_match(left_at: datetime | None, right_at: datetime | None, tolerance_seconds: int = 3) -> bool:
    if left_at is None or right_at is None:
        return True
    return abs((left_at - right_at).total_seconds()) <= tolerance_seconds


def _messages_overlap(left: InstagramConversation, right: InstagramConversation) -> bool:
    for left_message in left.messages:
        left_at = _as_utc(left_message.sent_at)
        left_body = (left_message.body or "").strip()
        if not left_body:
            continue
        for right_message in right.messages:
            if left_body != (right_message.body or "").strip():
                continue
            right_at = _as_utc(right_message.sent_at)
            if _message_times_match(left_at, right_at):
                return True
    return False


def _inbound_senders(conversation: InstagramConversation) -> set[str]:
    return {
        str(message.sender_ig_id)
        for message in conversation.messages
        if message.direction == "inbound" and message.sender_ig_id
    }


def conversations_same_thread(
    left: InstagramConversation,
    right: InstagramConversation,
) -> bool:
    if left.id == right.id:
        return False

    left_participant = left.participant_ig_id or ""
    right_participant = right.participant_ig_id or ""
    if left_participant and right_participant and left_participant == right_participant:
        return True

    left_senders = _inbound_senders(left)
    right_senders = _inbound_senders(right)
    if left_senders & right_senders:
        return True

    if left_participant and left_participant in right_senders:
        return True
    if right_participant and right_participant in left_senders:
        return True

    return _messages_overlap(left, right)


def merge_conversations(
    db: Session,
    canonical: InstagramConversation,
    duplicate: InstagramConversation,
) -> InstagramConversation:
    if canonical.id == duplicate.id:
        return canonical

    for message in list(duplicate.messages):
        existing = find_duplicate_message(
            canonical,
            mid=message.instagram_message_id,
            body=message.body or "",
            sent_at=message.sent_at or message.created_at or datetime.now(timezone.utc),
            direction=message.direction,
            ignore_direction=True,
        )
        if existing:
            if existing.instagram_message_id.startswith(("fake_", "out_")) and not message.instagram_message_id.startswith(
                ("fake_", "out_"),
            ):
                existing.instagram_message_id = message.instagram_message_id
            db.delete(message)
            continue
        message.instagram_conversation_id = canonical.id

    if duplicate.last_message_at and (
        canonical.last_message_at is None or duplicate.last_message_at > canonical.last_message_at
    ):
        canonical.last_message_at = duplicate.last_message_at

    if not canonical.participant_ig_id and duplicate.participant_ig_id:
        canonical.participant_ig_id = duplicate.participant_ig_id
    if not canonical.participant_username and duplicate.participant_username:
        canonical.participant_username = duplicate.participant_username

    db.delete(duplicate)
    db.flush()
    return canonical


def merge_duplicate_conversations(db: Session, account: InstagramAccount) -> int:
    merged = 0
    conversations = list(account.conversations)
    for index, left in enumerate(conversations):
        if left not in account.conversations:
            continue
        for right in conversations[index + 1 :]:
            if right not in account.conversations:
                continue
            if not conversations_same_thread(left, right):
                continue
            canonical = _canonical_conversation(left, right)
            duplicate = right if canonical.id == left.id else left
            merge_conversations(db, canonical, duplicate)
            merged += 1
            left = canonical
    return merged
