"""Public order progress page — token-scoped, read-only."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session, selectinload

from app.config import Settings, get_settings
from app.core.order_tracking_tokens import (
    OrderTrackingTokenInvalid,
    mint_order_tracking_token,
    read_order_tracking_token,
)
from app.models import Account, Order
from app.services.customer_profile_service import CustomerProfileService
from app.services.order_completion_service import OrderCompletionService
from app.support.order_delivery_details import (
    delivery_details_snapshot,
    order_can_collect_delivery_details,
    order_has_delivery_details,
    order_needs_delivery_details,
)
from app.support.order_status import (
    AWAITING_DELIVERY_CONFIRMATION,
    AWAITING_PICKUP_CONFIRMATION,
    STATUS_LABELS,
    TERMINAL_STATUSES,
)
from app.support.order_workflow import workflow_steps


class OrderTrackingError(RuntimeError):
    """A 400-class problem (bad token)."""


class OrderTrackingUnavailable(RuntimeError):
    """A 410-class problem (expired link)."""


class OrderTrackingService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()

    @staticmethod
    def tracking_url(order_id: str, settings: Settings | None = None) -> str | None:
        """Return a public tracking URL for ``order_id``, or ``None`` if no base URL."""
        cfg = settings or get_settings()
        base = (cfg.frontend_url or "").rstrip("/")
        if not base:
            return None
        token = mint_order_tracking_token(order_id)
        return f"{base}/track/{token}"

    def order_for_token(self, token: str) -> Order:
        try:
            payload = read_order_tracking_token(token)
        except OrderTrackingTokenInvalid as exc:
            msg = str(exc)
            if "expired" in msg.lower():
                raise OrderTrackingUnavailable(msg) from exc
            raise OrderTrackingError(msg) from exc

        order = (
            self.db.query(Order)
            .options(
                selectinload(Order.items),
                selectinload(Order.account),
            )
            .filter(Order.id == str(payload["oid"]))
            .first()
        )
        if not order:
            raise OrderTrackingUnavailable("This order is no longer available.")
        return order

    def load(self, token: str) -> dict:
        order = self.order_for_token(token)
        account: Account | None = order.account
        merchant_name = (account.business_name if account else None) or "Shop"
        status = str(order.status or "placed")
        completion = OrderCompletionService

        return {
            "order_id": order.id,
            "order_number": order.order_number,
            "status": status,
            "status_label": STATUS_LABELS.get(
                status,
                status.replace("_", " ").title(),
            ),
            "fulfillment_type": order.fulfillment_type,
            "merchant": {"name": merchant_name},
            "currency": order.currency or "KES",
            "subtotal": float(order.subtotal or 0),
            "delivery_fee": float(order.delivery_fee or 0),
            "discount": float(order.discount or 0),
            "total": float(order.total or 0),
            "items": [
                {
                    "product_name": line.product_name,
                    "quantity": line.quantity,
                    "line_total": float(line.line_total or 0),
                }
                for line in (order.items or [])
            ],
            "workflow_steps": workflow_steps(order),
            "needs_delivery_details": order_needs_delivery_details(order),
            "can_submit_delivery_details": (
                order_can_collect_delivery_details(order)
                and order_needs_delivery_details(order)
            ),
            "delivery_details": delivery_details_snapshot(order),
            "is_terminal": status in TERMINAL_STATUSES,
            "awaiting_confirmation": status
            in {AWAITING_DELIVERY_CONFIRMATION, AWAITING_PICKUP_CONFIRMATION},
            "can_confirm_receipt": status
            in completion.customer_eligible_statuses(order)
            and not order.customer_delivery_confirmed_at
            and not order.delivery_disputed_at,
            "can_dispute_receipt": (
                not order.delivery_disputed_at
                and (
                    status in completion.customer_eligible_statuses(order)
                    or status
                    in {AWAITING_DELIVERY_CONFIRMATION, AWAITING_PICKUP_CONFIRMATION}
                )
            ),
            "merchant_confirmed": order.merchant_delivery_confirmed_at is not None,
            "customer_confirmed": order.customer_delivery_confirmed_at is not None,
            "delivery_disputed": order.delivery_disputed_at is not None,
            "placed_at": order.placed_at,
            "paid_at": order.paid_at,
            "prepared_at": order.prepared_at,
            "ready_at": order.ready_at,
            "dispatched_at": order.dispatched_at,
            "completed_at": order.completed_at,
            "cancelled_at": order.cancelled_at,
            "updated_at": order.updated_at,
        }

    def submit_delivery_details(
        self,
        token: str,
        *,
        full_name: str,
        phone_number: str,
        delivery_location: str,
        delivery_instructions: str | None = None,
    ) -> dict:
        order = self.order_for_token(token)

        if not order_can_collect_delivery_details(order):
            if order_has_delivery_details(order):
                raise OrderTrackingError("Delivery details have already been submitted.")
            raise OrderTrackingError(
                "Delivery details can only be submitted when your order is ready.",
            )

        profiles = CustomerProfileService(self.db)
        clean_name = (full_name or "").strip().lstrip("@")
        if len(clean_name) < 2:
            raise OrderTrackingError("Please enter your full name.")

        normalized_phone = profiles.extract_phone(phone_number or "")
        if not normalized_phone:
            raise OrderTrackingError(
                "Enter a valid phone number (07XXXXXXXX or 2547XXXXXXXX).",
            )

        clean_location = (delivery_location or "").strip()
        if len(clean_location) < 5:
            raise OrderTrackingError("Please enter your delivery location.")

        clean_instructions = (delivery_instructions or "").strip()
        if len(clean_instructions) < 3:
            raise OrderTrackingError("Please enter delivery instructions.")

        order.customer_name = clean_name[:255]
        order.customer_phone = normalized_phone
        order.delivery_address = clean_location[:2000]
        order.delivery_notes = clean_instructions[:2000]
        order.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(order)

        if order.status == "ready" and not order.assigned_rider_id:
            from app.services.rider_trip_service import RiderTripService

            try:
                RiderTripService(self.db).fan_out_offers_for_ready_order(order)
            except Exception:
                pass

        return self.load(token)
