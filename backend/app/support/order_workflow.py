"""Stage-based order workflow — one primary action per step."""

from __future__ import annotations

from typing import Any, Final, Literal

from app.services.order_completion_service import OrderCompletionService
from app.support.mpesa_order_link import (
    order_has_successful_mpesa_payment,
    order_requires_mpesa_receipt_confirmation,
)
from app.support.order_delivery_details import (
    order_has_delivery_details,
    order_needs_delivery_details,
)
from app.support.order_status import (
    AWAITING_DELIVERY_CONFIRMATION,
    AWAITING_PAYMENT,
    AWAITING_PICKUP_CONFIRMATION,
    BEING_PREPARED,
    CANCELLED,
    DELIVERED,
    FULFILLMENT_DELIVERY,
    FULFILLMENT_PICKUP,
    OUT_FOR_DELIVERY,
    PAYMENT_MPESA,
    PAYMENT_RECEIVED,
    PICKED_UP,
    PLACED,
    READY,
    REFUNDED,
    TERMINAL_STATUSES,
    forward_flow,
)

ActionKind = Literal[
    "transition",
    "confirm_mpesa_payment",
    "mpesa_stk_push",
    "confirm_handoff",
    "resend_completion_prompt",
    "cancel",
    "refund",
    "delete",
]

StepState = Literal["done", "current", "upcoming", "skipped"]

# Rider trip phases surfaced in the delivery workflow (not order.status).
_TRIP_FINDING_RIDER = "finding_rider"
_TRIP_EN_ROUTE_STORE = "en_route_to_store"
_TRIP_AT_STORE = "at_store"
_TRIP_PHASE_ORDER: Final[tuple[str, ...]] = (
    _TRIP_FINDING_RIDER,
    _TRIP_EN_ROUTE_STORE,
    _TRIP_AT_STORE,
)


def _mpesa_paid(order) -> bool:
    if order_requires_mpesa_receipt_confirmation(order):
        return order.paid_at is not None
    return order_has_successful_mpesa_payment(order)


def _order_payment_confirmed(order) -> bool:
    return getattr(order, "paid_at", None) is not None


def _has_phone(order) -> bool:
    return bool(str(getattr(order, "customer_phone", None) or "").strip())


def _is_mpesa(order) -> bool:
    return (getattr(order, "payment_method", None) or "") == PAYMENT_MPESA


def _delivery_details_step_state(
    current: str,
    flow: list[str],
    *,
    has_details: bool,
) -> StepState:
    if current in {CANCELLED, REFUNDED}:
        return "skipped"

    if current not in flow:
        return "upcoming"

    current_index = flow.index(current)
    ready_index = flow.index(READY)

    if current_index < ready_index:
        return "upcoming"
    if current == READY and not has_details:
        return "current"
    if current_index >= ready_index and has_details:
        return "done"
    if current_index > ready_index:
        return "done"
    return "upcoming"


def _rider_pipeline_step_state(
    key: str,
    *,
    status: str,
    flow: list[str],
    trip_phase: str | None,
    has_rider: bool,
    has_delivery_details: bool,
) -> StepState:
    """Resolve Finding a rider / Rider en route / Rider at store step state."""
    if status in {CANCELLED, REFUNDED}:
        return "skipped"

    if status not in flow:
        return "upcoming"

    status_index = flow.index(status)
    ready_index = flow.index(READY)
    out_index = flow.index(OUT_FOR_DELIVERY)

    # Before the order is prepared, rider steps are still upcoming.
    if status_index < ready_index:
        return "upcoming"

    # Once out for delivery (or later), all rider-to-store steps are done.
    if status_index >= out_index:
        return "done"

    # Hold rider matching until delivery details are in.
    if not has_delivery_details and not has_rider and not trip_phase:
        return "upcoming"

    # status == ready: resolve from assignment + trip phase
    phase = (trip_phase or "").strip() or None
    if phase in {_TRIP_EN_ROUTE_STORE, _TRIP_AT_STORE, "picking_up"}:
        active = (
            _TRIP_AT_STORE
            if phase in {_TRIP_AT_STORE, "picking_up"}
            else _TRIP_EN_ROUTE_STORE
        )
    elif has_rider or phase:
        active = _TRIP_EN_ROUTE_STORE
    else:
        active = _TRIP_FINDING_RIDER

    active_index = _TRIP_PHASE_ORDER.index(active)
    key_index = _TRIP_PHASE_ORDER.index(key)
    if key_index < active_index:
        return "done"
    if key_index == active_index:
        return "current"
    return "upcoming"


def workflow_steps(order) -> list[dict[str, str]]:
    """Human-readable pipeline for the order's channel + fulfillment."""
    from app.support.order_status import STATUS_LABELS

    current = str(getattr(order, "status", PLACED))
    if current in {CANCELLED, REFUNDED}:
        label = STATUS_LABELS.get(current, current.replace("_", " ").title())
        return [{"key": current, "label": label, "state": "current"}]

    fulfillment = getattr(order, "fulfillment_type", FULFILLMENT_DELIVERY)
    payment = getattr(order, "payment_method", None) or ""
    is_delivery = fulfillment == FULFILLMENT_DELIVERY
    uses_mpesa = payment == PAYMENT_MPESA

    steps: list[tuple[str, str]] = [("placed", "Created")]
    if uses_mpesa:
        steps.extend(
            [
                ("awaiting_payment", "Payment requested"),
                ("payment_received", "Payment received"),
            ],
        )
    else:
        steps.append(("payment_received", "Payment received"))
    steps.extend(
        [
            ("being_prepared", "Preparing"),
            ("ready", "Prepared"),
        ],
    )
    if is_delivery:
        steps.extend(
            [
                ("delivery_details", "Delivery details"),
                (_TRIP_FINDING_RIDER, "Finding a rider"),
                (_TRIP_EN_ROUTE_STORE, "Rider en route"),
                (_TRIP_AT_STORE, "Rider at store"),
                ("out_for_delivery", "Out for delivery"),
                ("awaiting_delivery_confirmation", "Confirming delivery"),
                ("delivered", "Delivered"),
            ],
        )
    else:
        steps.extend(
            [
                ("awaiting_pickup_confirmation", "Confirming pickup"),
                ("picked_up", "Picked up"),
            ],
        )

    flow = list(forward_flow(fulfillment))
    current_index = flow.index(current) if current in flow else -1
    has_details = order_has_delivery_details(order)
    trip_phase = getattr(order, "rider_trip_phase", None)
    has_rider = bool(getattr(order, "assigned_rider_id", None))

    rendered: list[dict[str, str]] = []
    for key, label in steps:
        if key in {_TRIP_FINDING_RIDER, _TRIP_EN_ROUTE_STORE, _TRIP_AT_STORE}:
            state = _rider_pipeline_step_state(
                key,
                status=current,
                flow=flow,
                trip_phase=trip_phase,
                has_rider=has_rider,
                has_delivery_details=has_details,
            )
        elif key not in flow and key not in {"placed", "delivery_details"}:
            continue
        elif key == "delivery_details":
            state = _delivery_details_step_state(
                current,
                flow,
                has_details=has_details,
            )
        elif key == READY and current == READY and is_delivery and not has_details:
            state = "done"
        elif key == READY and current == READY and is_delivery:
            # Prepared is complete once ready; "Finding a rider" is the live step.
            state = "done"
        elif key == current:
            state = "current"
        elif key in flow and current_index >= 0 and flow.index(key) < current_index:
            state = "done"
        elif current in TERMINAL_STATUSES and key == current:
            state = "current"
        else:
            state = "upcoming"
        rendered.append({"key": key, "label": label, "state": state})
    return rendered


def workflow_actions_for_order(order) -> list[dict[str, Any]]:
    """Return only the actions relevant to the order's current stage."""
    status = str(getattr(order, "status", PLACED))
    fulfillment = getattr(order, "fulfillment_type", FULFILLMENT_DELIVERY)
    completion = OrderCompletionService
    actions: list[dict[str, Any]] = []

    if status == PLACED:
        if _is_mpesa(order):
            actions.append(
                {
                    "kind": "transition",
                    "to_status": AWAITING_PAYMENT,
                    "label": "Request payment",
                    "variant": "primary",
                    "icon": "arrow-right",
                },
            )
        else:
            actions.append(
                {
                    "kind": "transition",
                    "to_status": PAYMENT_RECEIVED,
                    "label": "Payment received",
                    "variant": "primary",
                    "icon": "check",
                },
            )
        actions.append(
            {
                "kind": "delete",
                "label": "Delete",
                "variant": "danger",
                "icon": "trash",
            },
        )

    elif status == AWAITING_PAYMENT:
        if _is_mpesa(order) and not _order_payment_confirmed(order):
            linked_txns = getattr(order, "mpesa_transactions", None) or []
            has_txn = bool(linked_txns) or bool(
                getattr(order, "mpesa_transaction_id", None),
            )
            actions.append(
                {
                    "kind": "mpesa_stk_push",
                    "label": "Resend payment request" if has_txn else "Request payment",
                    "variant": "primary",
                    "icon": "paper-plane",
                    "disabled": not _has_phone(order),
                    "disabled_reason": "Add a customer phone number first",
                },
            )
        if not _order_payment_confirmed(order):
            if _is_mpesa(order):
                if order_has_successful_mpesa_payment(order):
                    actions.append(
                        {
                            "kind": "transition",
                            "to_status": PAYMENT_RECEIVED,
                            "label": "Payment received",
                            "variant": "primary",
                            "icon": "check",
                        },
                    )
                else:
                    actions.append(
                        {
                            "kind": "confirm_mpesa_payment",
                            "to_status": PAYMENT_RECEIVED,
                            "label": "Payment received",
                            "variant": "secondary",
                            "icon": "check",
                            "requires_mpesa_receipt": True,
                        },
                    )
            else:
                actions.append(
                    {
                        "kind": "transition",
                        "to_status": PAYMENT_RECEIVED,
                        "label": "Payment received",
                        "variant": "secondary",
                        "icon": "check",
                    },
                )

    elif status == PAYMENT_RECEIVED:
        actions.append(
            {
                "kind": "transition",
                "to_status": BEING_PREPARED,
                "label": "Start preparing",
                "variant": "primary",
                "icon": "fire-burner",
            },
        )

    elif status == BEING_PREPARED:
        actions.append(
            {
                "kind": "transition",
                "to_status": READY,
                "label": "Mark prepared",
                "variant": "primary",
                "icon": "circle-check",
            },
        )

    elif status == READY:
        if fulfillment == FULFILLMENT_DELIVERY:
            actions.append(
                {
                    "kind": "transition",
                    "to_status": OUT_FOR_DELIVERY,
                    "label": "Send for delivery",
                    "variant": "primary",
                    "icon": "truck",
                    "disabled": order_needs_delivery_details(order),
                    "disabled_reason": "Waiting for customer delivery details",
                },
            )
        elif not getattr(order, "merchant_delivery_confirmed_at", None):
            actions.append(
                {
                    "kind": "confirm_handoff",
                    "label": "Mark picked up",
                    "variant": "primary",
                    "icon": "bag-shopping",
                },
            )

    elif status == OUT_FOR_DELIVERY:
        if not getattr(order, "merchant_delivery_confirmed_at", None):
            actions.append(
                {
                    "kind": "confirm_handoff",
                    "label": "Delivered",
                    "variant": "primary",
                    "icon": "circle-check",
                },
            )

    elif status in {AWAITING_DELIVERY_CONFIRMATION, AWAITING_PICKUP_CONFIRMATION}:
        if completion.needs_merchant_confirmation(order):
            actions.append(
                {
                    "kind": "confirm_handoff",
                    "label": "Picked up"
                    if fulfillment == FULFILLMENT_PICKUP
                    else "Delivered",
                    "variant": "primary",
                    "icon": "circle-check",
                },
            )
        if completion.needs_customer_confirmation(order):
            actions.append(
                {
                    "kind": "resend_completion_prompt",
                    "label": "Resend customer confirmation",
                    "variant": "secondary",
                    "icon": "paper-plane",
                    "disabled": not bool(getattr(order, "source_conversation_id", None)),
                    "disabled_reason": "No Instagram chat linked to this order",
                },
            )

    elif status in {DELIVERED, PICKED_UP}:
        actions.append(
            {
                "kind": "refund",
                "to_status": REFUNDED,
                "label": "Mark refunded",
                "variant": "danger",
                "icon": "rotate-left",
            },
        )

    if status not in TERMINAL_STATUSES:
        actions.append(
            {
                "kind": "cancel",
                "to_status": CANCELLED,
                "label": "Cancel order",
                "variant": "danger",
                "icon": "xmark",
            },
        )

    return actions
