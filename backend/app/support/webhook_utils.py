from __future__ import annotations

from app.models import WebhookEvent


def count_tester_like(events: list[WebhookEvent], account_ig_id: str) -> int:
    count = 0
    for event in events:
        if not event.signature_valid or not event.sender_id:
            continue
        if event.sender_id == account_ig_id:
            continue
        payload = event.payload or {}
        if "sample" not in payload:
            count += 1
    return count
