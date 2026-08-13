"""Delivery contact + address requirements between Ready and Dispatch."""

from __future__ import annotations

from app.support.order_status import FULFILLMENT_DELIVERY, READY


def order_has_delivery_details(order) -> bool:
    """True when a delivery order has the minimum fields to dispatch.

    Instructions (``delivery_notes``) are helpful but optional — requiring them
    blocked rider offers for otherwise complete drop-offs.
    """
    if getattr(order, "fulfillment_type", None) != FULFILLMENT_DELIVERY:
        return True

    name = str(getattr(order, "customer_name", None) or "").strip()
    phone = str(getattr(order, "customer_phone", None) or "").strip()
    address = str(getattr(order, "delivery_address", None) or "").strip()
    return bool(name and phone and address)


def order_needs_delivery_details(order) -> bool:
    return (
        getattr(order, "fulfillment_type", None) == FULFILLMENT_DELIVERY
        and not order_has_delivery_details(order)
    )


def order_can_collect_delivery_details(order) -> bool:
    """Customer may submit delivery info once the order is ready for handoff."""
    return (
        getattr(order, "fulfillment_type", None) == FULFILLMENT_DELIVERY
        and str(getattr(order, "status", "")) == READY
    )


def delivery_details_snapshot(order) -> dict[str, str | None]:
    return {
        "full_name": (getattr(order, "customer_name", None) or "").strip() or None,
        "phone_number": (getattr(order, "customer_phone", None) or "").strip() or None,
        "delivery_location": (getattr(order, "delivery_address", None) or "").strip() or None,
        "delivery_instructions": (getattr(order, "delivery_notes", None) or "").strip() or None,
    }
