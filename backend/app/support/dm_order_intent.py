"""Parse customer order intent from free-text DM messages."""

from __future__ import annotations

import re
from typing import Any

OPTION_PICK_RE = re.compile(
    r"(?:\b(?:option|choice|item|number|no\.?|pick|select|take|want)\s*)(\d+)"
    r"|(?:\blets?\s+go\s+with\s+)(\d+)"
    r"|(?:\bgo\s+with\s+)(?:option\s*)?(\d+)",
    re.IGNORECASE,
)


def parse_suggestion_pick(text: str | None) -> int | None:
    """Return 1-based index when the customer picks from a numbered list."""
    raw = (text or "").strip()
    if not raw:
        return None
    match = OPTION_PICK_RE.search(raw)
    if match:
        for group in match.groups():
            if group:
                return int(group)
    if re.fullmatch(r"\d+\.?", raw):
        return int(raw.rstrip("."))
    return None


def resolve_pending_order_item_id(
    session: dict[str, Any],
    *,
    recent_customer_messages: list[str] | None = None,
) -> str:
    """Best catalogue ref or inventory item id for an in-progress order, if known."""
    pending_ref = str(session.get("catalog_pending_item_ref") or "").strip()
    if pending_ref:
        return pending_ref

    pending = str(session.get("catalog_pending_item_id") or "").strip()
    if pending:
        return pending

    discussed_ref = str(session.get("last_discussed_item_ref") or "").strip()
    if discussed_ref:
        return discussed_ref

    discussed = str(session.get("last_discussed_item_id") or "").strip()
    if discussed:
        return discussed

    suggested_refs = session.get("last_suggested_item_refs") or []
    if isinstance(suggested_refs, list) and len(suggested_refs) == 1:
        return str(suggested_refs[0] or "").strip()

    suggested = session.get("last_suggested_item_ids") or []
    if isinstance(suggested, list) and len(suggested) == 1:
        return str(suggested[0] or "").strip()

    refs = suggested_refs if isinstance(suggested_refs, list) and suggested_refs else suggested
    if isinstance(refs, list) and refs and recent_customer_messages:
        for text in reversed(recent_customer_messages):
            pick_index = parse_suggestion_pick(text)
            if pick_index is not None and 1 <= pick_index <= len(refs):
                return str(refs[pick_index - 1] or "").strip()

    return ""
