"""Instagram DM helpers for order status notifications."""

from __future__ import annotations

import json
from typing import Any

from app.models import Order
from app.support.order_status import STATUS_LABELS

ORDER_TRACK_CARD_PREFIX = "[order_track]"
ORDER_PAY_CARD_PREFIX = "[order_pay]"


def format_order_ref(order_number: str) -> str:
    """Bold order reference for Instagram DM text (Markdown-style)."""
    return f"**{order_number}**"


def build_tracking_template_element(
    order: Order,
    tracking_url: str,
) -> dict[str, Any]:
    """Generic-template card shown after a status update."""
    status = str(order.status or "placed")
    status_label = STATUS_LABELS.get(status, status.replace("_", " ").title())
    ref = order.order_number
    total = int(round(float(order.total or 0)))
    currency = order.currency or "KES"

    return {
        "title": f"Order {ref}"[:80],
        "subtitle": f"{status_label} · {currency} {total:,}"[:80],
        "default_action": {
            "type": "web_url",
            "url": tracking_url,
            "webview_height_ratio": "full",
        },
        "buttons": [
            {
                "type": "web_url",
                "url": tracking_url,
                "title": "Track order",
            },
        ],
    }


def build_tracking_stored_body(order: Order, tracking_url: str) -> str:
    """Persisted inbox payload for merchant-side rendering."""
    status = str(order.status or "placed")
    status_label = STATUS_LABELS.get(status, status.replace("_", " ").title())
    payload = {
        "order_number": order.order_number,
        "status_label": status_label,
        "tracking_url": tracking_url,
    }
    return f"{ORDER_TRACK_CARD_PREFIX}{json.dumps(payload, separators=(',', ':'))}"


def build_payment_template_element(
    order: Order,
    payment_url: str,
) -> dict[str, Any]:
    """Generic-template card for the public payment page."""
    ref = order.order_number
    total = int(round(float(order.total or 0)))
    currency = order.currency or "KES"

    return {
        "title": f"Pay order {ref}"[:80],
        "subtitle": f"{currency} {total:,} · M-PESA"[:80],
        "default_action": {
            "type": "web_url",
            "url": payment_url,
            "webview_height_ratio": "full",
        },
        "buttons": [
            {
                "type": "web_url",
                "url": payment_url,
                "title": "Pay now",
            },
        ],
    }


def build_payment_stored_body(order: Order, payment_url: str) -> str:
    """Persisted inbox payload for merchant-side rendering."""
    total = int(round(float(order.total or 0)))
    currency = order.currency or "KES"
    payload = {
        "order_number": order.order_number,
        "total": total,
        "currency": currency,
        "payment_url": payment_url,
    }
    return f"{ORDER_PAY_CARD_PREFIX}{json.dumps(payload, separators=(',', ':'))}"


def format_completion_confirm_prompt(order: Order) -> str:
    ref = format_order_ref(order.order_number)
    if order.fulfillment_type == "pickup":
        return (
            f"Your order {ref} is ready.\n\n"
            "Did you pick it up? Reply **Yes** to confirm, or **No** if you still need help."
        )
    return (
        f"Your order {ref} has been delivered.\n\n"
        "Did you receive everything? Reply **Yes** to confirm, or **No** if something is wrong."
    )


def completion_confirm_quick_replies() -> list[dict[str, str]]:
    return [
        {
            "content_type": "text",
            "title": "Yes, received",
            "payload": "delivery_yes",
        },
        {
            "content_type": "text",
            "title": "No, issue",
            "payload": "delivery_no",
        },
    ]
