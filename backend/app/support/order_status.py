"""Order lifecycle state machine.

Two parallel concerns travel with an order:

* **Fulfillment** progression — placed → being_prepared → ready → handed off
* **Payment** progression    — placed → awaiting_payment → payment_received

The merchant rarely thinks of them as separate, so we expose them as one
linear flow with conditional branches:

```
placed
  └─ awaiting_payment
       └─ payment_received
            └─ being_prepared
                 └─ ready
                      ├─ out_for_delivery → delivered   (delivery)
                      └─ picked_up                       (pickup)
```

Merchant-facing labels follow the delivery pipeline:

Created → Payment requested → Payment received → Preparing → Prepared →
Finding a rider → Rider en route → Rider at store → Out for delivery →
Delivered

Rider proximity ("Finding a rider" through "Rider at store") is shown in
the workflow UI from ``rider_trip_phase``; the order ``status`` itself
moves ready → out_for_delivery when the rider leaves the store (or the
merchant dispatches manually).

Side states (reachable from most non-terminal states):

* ``cancelled``  — never delivered
* ``refunded``   — was delivered/picked up but later refunded

Some flows can skip stages (e.g. cash-on-pickup never goes through
``awaiting_payment``), so the machine is permissive: it allows skipping
*forward* states but never *backward* travel except via ``cancel``.
"""

from __future__ import annotations

from typing import Final, Literal

# Lifecycle states ---------------------------------------------------------

PLACED: Final = "placed"
AWAITING_PAYMENT: Final = "awaiting_payment"
PAYMENT_RECEIVED: Final = "payment_received"
BEING_PREPARED: Final = "being_prepared"
READY: Final = "ready"
OUT_FOR_DELIVERY: Final = "out_for_delivery"
AWAITING_DELIVERY_CONFIRMATION: Final = "awaiting_delivery_confirmation"
AWAITING_PICKUP_CONFIRMATION: Final = "awaiting_pickup_confirmation"
DELIVERED: Final = "delivered"
PICKED_UP: Final = "picked_up"
CANCELLED: Final = "cancelled"
REFUNDED: Final = "refunded"

OrderStatus = Literal[
    "placed",
    "awaiting_payment",
    "payment_received",
    "being_prepared",
    "ready",
    "out_for_delivery",
    "awaiting_delivery_confirmation",
    "awaiting_pickup_confirmation",
    "delivered",
    "picked_up",
    "cancelled",
    "refunded",
]

ALL_STATUSES: Final[tuple[str, ...]] = (
    PLACED,
    AWAITING_PAYMENT,
    PAYMENT_RECEIVED,
    BEING_PREPARED,
    READY,
    OUT_FOR_DELIVERY,
    AWAITING_DELIVERY_CONFIRMATION,
    AWAITING_PICKUP_CONFIRMATION,
    DELIVERED,
    PICKED_UP,
    CANCELLED,
    REFUNDED,
)

CONFIRMATION_STATUSES: Final[frozenset[str]] = frozenset(
    {AWAITING_DELIVERY_CONFIRMATION, AWAITING_PICKUP_CONFIRMATION},
)

TERMINAL_STATUSES: Final[frozenset[str]] = frozenset(
    {DELIVERED, PICKED_UP, CANCELLED, REFUNDED},
)

# Fulfillment ----------------------------------------------------------------

FULFILLMENT_PICKUP: Final = "pickup"
FULFILLMENT_DELIVERY: Final = "delivery"

FulfillmentType = Literal["pickup", "delivery"]

ALL_FULFILLMENT_TYPES: Final[tuple[str, ...]] = (FULFILLMENT_PICKUP, FULFILLMENT_DELIVERY)

# Sources --------------------------------------------------------------------

SOURCE_WALKIN: Final = "walkin"
SOURCE_PHONE_CALL: Final = "phone_call"
SOURCE_INSTAGRAM: Final = "instagram"
SOURCE_WHATSAPP: Final = "whatsapp"
SOURCE_TIKTOK: Final = "tiktok"
SOURCE_FACEBOOK: Final = "facebook"
SOURCE_RIDER_REQUEST: Final = "rider_request"

OrderSource = Literal[
    "walkin",
    "phone_call",
    "instagram",
    "whatsapp",
    "tiktok",
    "facebook",
    "rider_request",
]

ALL_SOURCES: Final[tuple[str, ...]] = (
    SOURCE_WALKIN,
    SOURCE_PHONE_CALL,
    SOURCE_INSTAGRAM,
    SOURCE_WHATSAPP,
    SOURCE_TIKTOK,
    SOURCE_FACEBOOK,
    SOURCE_RIDER_REQUEST,
)

# Sources that can be selected directly in the POS workflow (i.e. orders
# that are entered by staff). The remaining sources are reserved for
# orders that originate from an external channel's webhook/inbox.
POS_SOURCES: Final[tuple[str, ...]] = (SOURCE_WALKIN, SOURCE_PHONE_CALL)

# Payment methods ------------------------------------------------------------

PAYMENT_MPESA: Final = "mpesa"
PAYMENT_CASH: Final = "cash"
PAYMENT_CARD: Final = "card"
PAYMENT_CREDIT: Final = "credit"
PAYMENT_OTHER: Final = "other"

PaymentMethod = Literal["mpesa", "cash", "card", "credit", "other"]

ALL_PAYMENT_METHODS: Final[tuple[str, ...]] = (
    PAYMENT_MPESA,
    PAYMENT_CASH,
    PAYMENT_CARD,
    PAYMENT_CREDIT,
    PAYMENT_OTHER,
)


# --- Transition rules -------------------------------------------------------
#
# The order in this tuple is also the canonical "forward" order; legal
# transitions are any status further down the list, plus ``cancelled`` from
# anywhere non-terminal.
_FORWARD_FLOW_DELIVERY: Final[tuple[str, ...]] = (
    PLACED,
    AWAITING_PAYMENT,
    PAYMENT_RECEIVED,
    BEING_PREPARED,
    READY,
    OUT_FOR_DELIVERY,
    AWAITING_DELIVERY_CONFIRMATION,
    DELIVERED,
)

_FORWARD_FLOW_PICKUP: Final[tuple[str, ...]] = (
    PLACED,
    AWAITING_PAYMENT,
    PAYMENT_RECEIVED,
    BEING_PREPARED,
    READY,
    AWAITING_PICKUP_CONFIRMATION,
    PICKED_UP,
)


def forward_flow(fulfillment_type: str) -> tuple[str, ...]:
    """The canonical forward progression for a given fulfillment type."""
    if fulfillment_type == FULFILLMENT_PICKUP:
        return _FORWARD_FLOW_PICKUP
    return _FORWARD_FLOW_DELIVERY


def allowed_next_statuses(current: str, fulfillment_type: str) -> list[str]:
    """All statuses that ``current`` is allowed to move to.

    Terminal states have no further moves. Non-terminal states can always
    be cancelled. Forward moves can skip intermediate steps (handy when the
    merchant marks "payment_received" directly from "placed" for cash
    orders), but backwards moves are never allowed.

    ``refunded`` is reachable only from the two "completed" terminals.
    """
    if current in TERMINAL_STATUSES:
        if current in (DELIVERED, PICKED_UP):
            return [REFUNDED]
        return []

    flow = forward_flow(fulfillment_type)
    nexts: list[str] = []
    if current in flow:
        i = flow.index(current)
        nexts.extend(flow[i + 1 :])
        # Delivered / picked up require dual confirmation — not a generic transition.
        nexts = [s for s in nexts if s not in {DELIVERED, PICKED_UP}]
    # Cancel is always available for non-terminal states.
    nexts.append(CANCELLED)
    return nexts


def can_transition(current: str, target: str, fulfillment_type: str) -> bool:
    return target in allowed_next_statuses(current, fulfillment_type)


def awaiting_confirmation_status(fulfillment_type: str) -> str:
    if fulfillment_type == FULFILLMENT_PICKUP:
        return AWAITING_PICKUP_CONFIRMATION
    return AWAITING_DELIVERY_CONFIRMATION


def completion_status(fulfillment_type: str) -> str:
    if fulfillment_type == FULFILLMENT_PICKUP:
        return PICKED_UP
    return DELIVERED


def is_awaiting_completion_confirmation(status: str) -> bool:
    return status in CONFIRMATION_STATUSES


# Labels & UI hints ----------------------------------------------------------

STATUS_LABELS: Final[dict[str, str]] = {
    PLACED: "Created",
    AWAITING_PAYMENT: "Payment requested",
    PAYMENT_RECEIVED: "Payment received",
    BEING_PREPARED: "Preparing",
    READY: "Prepared",
    OUT_FOR_DELIVERY: "Out for delivery",
    AWAITING_DELIVERY_CONFIRMATION: "Confirming delivery",
    AWAITING_PICKUP_CONFIRMATION: "Confirming pickup",
    DELIVERED: "Delivered",
    PICKED_UP: "Picked up",
    CANCELLED: "Cancelled",
    REFUNDED: "Refunded",
}
