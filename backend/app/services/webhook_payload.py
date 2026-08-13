from __future__ import annotations

from typing import Any


class InstagramWebhookPayload:
    @classmethod
    def describe_skipped(cls, payload: dict[str, Any]) -> str:
        parts: list[str] = []
        if payload.get("object") != "instagram":
            parts.append(f"object={payload.get('object')!r}")
        for entry in payload.get("entry") or []:
            if not isinstance(entry, dict):
                continue
            for event in entry.get("messaging") or []:
                if not isinstance(event, dict):
                    continue
                keys = [k for k in event if k not in ("sender", "recipient", "timestamp")]
                if keys:
                    parts.append("messaging:" + ",".join(keys))
            for change in entry.get("changes") or []:
                if isinstance(change, dict) and change.get("field"):
                    parts.append(f"changes:{change['field']}")
        return ", ".join(parts) if parts else "empty or unrecognized payload"

    @classmethod
    def comment_events(cls, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Normalize Instagram ``comments`` webhook changes."""
        if isinstance(payload.get("sample"), dict):
            sample_events = cls._comment_events_from_sample(payload["sample"])
            if sample_events:
                return sample_events

        if payload.get("object") != "instagram":
            return []

        events: list[dict[str, Any]] = []
        for entry in payload.get("entry") or []:
            if not isinstance(entry, dict):
                continue
            entry_id = str(entry.get("id") or "")
            for change in entry.get("changes") or []:
                if not isinstance(change, dict):
                    continue
                if str(change.get("field") or "") != "comments":
                    continue
                value = change.get("value")
                if not isinstance(value, dict):
                    continue
                normalized = cls._normalize_comment_value(value)
                if normalized is None:
                    continue
                events.append(
                    {
                        "account_hint": entry_id or None,
                        "comment": normalized,
                    },
                )
        return events

    @classmethod
    def _comment_events_from_sample(cls, sample: dict[str, Any]) -> list[dict[str, Any]]:
        if str(sample.get("field") or "") != "comments":
            return []
        value = sample.get("value")
        if not isinstance(value, dict):
            return []
        normalized = cls._normalize_comment_value(value)
        if normalized is None:
            return []
        recipient_id = str((value.get("from") or {}).get("id") or "")
        return [{"account_hint": recipient_id or None, "comment": normalized}]

    @classmethod
    def _normalize_comment_value(cls, value: dict[str, Any]) -> dict[str, Any] | None:
        comment_id = str(value.get("id") or "").strip()
        text = str(value.get("text") or "").strip()
        if not comment_id or not text:
            return None

        media = value.get("media") if isinstance(value.get("media"), dict) else {}
        post_id = str(media.get("id") or value.get("media_id") or "").strip()
        if not post_id:
            return None

        sender = value.get("from") if isinstance(value.get("from"), dict) else {}
        commenter_id = str(sender.get("id") or value.get("from_id") or "").strip()
        commenter_username = str(sender.get("username") or "").strip() or None
        parent_id = str(value.get("parent_id") or "").strip() or None

        return {
            "comment_id": comment_id,
            "post_id": post_id,
            "text": text,
            "commenter_id": commenter_id,
            "commenter_username": commenter_username,
            "parent_comment_id": parent_id,
            "timestamp": value.get("timestamp"),
        }

    @classmethod
    def messaging_events(cls, payload: dict[str, Any]) -> list[dict[str, Any]]:
        if isinstance(payload.get("sample"), dict):
            return cls._from_sample(payload["sample"])

        if payload.get("object") != "instagram":
            return []

        events: list[dict[str, Any]] = []
        for entry in payload.get("entry") or []:
            if not isinstance(entry, dict):
                continue

            entry_id = str(entry.get("id") or "")
            for event in entry.get("messaging") or []:
                if not isinstance(event, dict):
                    continue
                has_message = "message" in event
                has_postback = "postback" in event
                has_sender_action = bool(event.get("sender_action"))
                if not has_message and not has_postback and not has_sender_action:
                    continue
                recipient_id = str((event.get("recipient") or {}).get("id") or "")
                hint = entry_id or recipient_id or None
                events.append({"account_hint": hint, "event": event})

            for change in entry.get("changes") or []:
                if not isinstance(change, dict):
                    continue
                field = str(change.get("field") or "")
                value = change.get("value")
                if not isinstance(value, dict):
                    continue
                recipient_id = str((value.get("recipient") or {}).get("id") or "")
                hint = entry_id or recipient_id or None
                if field == "messages":
                    events.append(
                        {
                            "account_hint": hint,
                            "event": cls._value_to_messaging_event(value),
                        },
                    )
                if field == "messaging_postbacks":
                    events.append(
                        {
                            "account_hint": hint,
                            "event": cls._value_to_postback_event(value),
                        },
                    )
        return events

    @classmethod
    def _from_sample(cls, sample: dict[str, Any]) -> list[dict[str, Any]]:
        field = str(sample.get("field") or "")
        value = sample.get("value")
        if not isinstance(value, dict):
            return []
        recipient_id = str((value.get("recipient") or {}).get("id") or "")
        hint = recipient_id or None
        if field == "messages":
            return [{"account_hint": hint, "event": cls._value_to_messaging_event(value)}]
        if field == "messaging_postbacks":
            return [{"account_hint": hint, "event": cls._value_to_postback_event(value)}]
        return []

    @classmethod
    def _value_to_messaging_event(cls, value: dict[str, Any]) -> dict[str, Any]:
        message = value.get("message")
        if not isinstance(message, dict) and isinstance(value.get("messages"), list):
            first = value["messages"][0] if value["messages"] else None
            message = first if isinstance(first, dict) else None

        sender = value.get("sender") if isinstance(value.get("sender"), dict) else {}
        if "id" not in sender and value.get("sender_id"):
            sender = {**sender, "id": str(value["sender_id"])}

        recipient = value.get("recipient") if isinstance(value.get("recipient"), dict) else {}
        if "id" not in recipient and value.get("recipient_id"):
            recipient = {**recipient, "id": str(value["recipient_id"])}

        return {
            "sender": sender,
            "recipient": recipient,
            "timestamp": value.get("timestamp"),
            "message": message,
        }

    @classmethod
    def _value_to_postback_event(cls, value: dict[str, Any]) -> dict[str, Any]:
        return {
            "sender": value.get("sender") or {},
            "recipient": value.get("recipient") or {},
            "timestamp": value.get("timestamp"),
            "postback": value.get("postback") or value,
        }
