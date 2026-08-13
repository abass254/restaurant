"""JSON state stored on ``InstagramConversation.sales_session``."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm.attributes import flag_modified

STEP_IDLE = "idle"
STEP_PRODUCT_SELECTED = "product_selected"
STEP_AWAITING_QUANTITY = "awaiting_quantity"
STEP_AWAITING_PHONE = "awaiting_phone"
STEP_AWAITING_PAYMENT = "awaiting_payment"
STEP_AWAITING_CONSENT = "awaiting_consent"
STEP_AWAITING_ORDER_CONFIRM = "awaiting_order_confirm"
STEP_AWAITING_COMPLETION_CONFIRM = "awaiting_completion_confirm"
STEP_TRACKING = "tracking"
STEP_HANDOFF = "handoff"

CONSENT_NONE = "none"
CONSENT_PENDING = "pending"
CONSENT_ACCEPTED = "accepted"
CONSENT_DECLINED = "declined"

# Re-export for customer model field defaults


def read_session(raw: Any | None) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def write_session(
    conversation,
    *,
    step: str | None = None,
    inventory_item_id: str | None = None,
    order_id: str | None = None,
    clear: bool = False,
) -> dict[str, Any]:
    if clear:
        conversation.sales_session = None
        flag_modified(conversation, "sales_session")
        return {}

    data = read_session(conversation.sales_session)
    if step is not None:
        data["step"] = step
    if inventory_item_id is not None:
        data["inventory_item_id"] = inventory_item_id
    if order_id is not None:
        data["order_id"] = order_id
    return merge_sales_session(conversation, **data)


def merge_sales_session(conversation, **updates: Any) -> dict[str, Any]:
    """Persist JSON session changes reliably (SQLAlchemy needs an explicit flag)."""
    data = read_session(conversation.sales_session)
    for key, value in updates.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    conversation.sales_session = data
    flag_modified(conversation, "sales_session")
    return data


def clear_sales_session_keys(conversation, *keys: str) -> dict[str, Any]:
    data = read_session(conversation.sales_session)
    for key in keys:
        data.pop(key, None)
    return merge_sales_session(conversation, **data)
