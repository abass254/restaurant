"""Summarize Instagram/Meta webhook payloads for audit log columns."""

from __future__ import annotations

from typing import Any


def summarize_webhook_payload(payload: dict[str, Any]) -> dict[str, str | None]:
    if not payload:
        return {
            "event_type": None,
            "sender_id": None,
            "recipient_id": None,
            "preview": None,
        }

    sample = payload.get("sample")
    if isinstance(sample, dict):
        field = str(sample.get("field") or "sample")
        value = sample.get("value")
        if not isinstance(value, dict):
            value = {}
        return _summarize_messaging_value(field, value)

    event_type: str | None = None
    sender_id: str | None = None
    recipient_id: str | None = None
    preview: str | None = None

    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue

        for event in entry.get("messaging") or []:
            if not isinstance(event, dict):
                continue
            parsed = _parse_messaging_event(event)
            event_type = parsed["event_type"] or event_type
            sender_id = parsed["sender_id"] or sender_id
            recipient_id = parsed["recipient_id"] or recipient_id
            preview = parsed["preview"] or preview

        for change in entry.get("changes") or []:
            if not isinstance(change, dict):
                continue
            field = str(change.get("field") or "change")
            value = change.get("value")
            if not isinstance(value, dict):
                value = {}
            parsed = _summarize_messaging_value(field, value)
            event_type = parsed["event_type"] or event_type
            sender_id = parsed["sender_id"] or sender_id
            recipient_id = parsed["recipient_id"] or recipient_id
            preview = parsed["preview"] or preview

    return {
        "event_type": event_type,
        "sender_id": sender_id,
        "recipient_id": recipient_id,
        "preview": preview,
    }


def _summarize_messaging_value(field: str, value: dict[str, Any]) -> dict[str, str | None]:
    if field == "messaging_postbacks" or value.get("postback"):
        postback = value.get("postback")
        if not isinstance(postback, dict):
            postback = value
        return {
            "event_type": "messaging_postbacks",
            "sender_id": str((value.get("sender") or {}).get("id") or "") or None,
            "recipient_id": str((value.get("recipient") or {}).get("id") or "") or None,
            "preview": str(postback.get("title") or postback.get("payload") or "postback"),
        }

    message = value.get("message")
    if not isinstance(message, dict):
        messages = value.get("messages")
        if isinstance(messages, list) and messages:
            first = messages[0]
            message = first if isinstance(first, dict) else None

    text = str((message or {}).get("text") or "") if isinstance(message, dict) else ""
    sender_id = str((value.get("sender") or {}).get("id") or value.get("sender_id") or "") or None
    recipient_id = (
        str((value.get("recipient") or {}).get("id") or value.get("recipient_id") or "") or None
    )

    return {
        "event_type": "messages" if field == "messages" else field,
        "sender_id": sender_id,
        "recipient_id": recipient_id,
        "preview": text or None,
    }


def _parse_messaging_event(event: dict[str, Any]) -> dict[str, str | None]:
    if event.get("read"):
        read = event.get("read")
        mid = read.get("mid") if isinstance(read, dict) else None
        return {
            "event_type": "read",
            "sender_id": str((event.get("sender") or {}).get("id") or "") or None,
            "recipient_id": str((event.get("recipient") or {}).get("id") or "") or None,
            "preview": f"read: {mid}" if mid else "(read receipt)",
        }

    if event.get("message_edit"):
        return {
            "event_type": "message_edit",
            "sender_id": str((event.get("sender") or {}).get("id") or "") or None,
            "recipient_id": str((event.get("recipient") or {}).get("id") or "") or None,
            "preview": "(message edit)",
        }

    if event.get("postback"):
        postback = event.get("postback") or {}
        if not isinstance(postback, dict):
            postback = {}
        return {
            "event_type": "messaging_postbacks",
            "sender_id": str((event.get("sender") or {}).get("id") or "") or None,
            "recipient_id": str((event.get("recipient") or {}).get("id") or "") or None,
            "preview": str(postback.get("title") or postback.get("payload") or "postback"),
        }

    message = event.get("message")
    text = str((message or {}).get("text") or "") if isinstance(message, dict) else ""
    preview = text or None
    if preview is None and isinstance(message, dict) and message.get("is_echo"):
        preview = "(echo)"

    return {
        "event_type": "messages",
        "sender_id": str((event.get("sender") or {}).get("id") or "") or None,
        "recipient_id": str((event.get("recipient") or {}).get("id") or "") or None,
        "preview": preview,
    }
