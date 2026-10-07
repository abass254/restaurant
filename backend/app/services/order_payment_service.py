"""Public order payment page — collect details, consent, and trigger M-PESA."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import Settings, get_settings
from app.core.order_payment_tokens import (
    OrderPaymentTokenInvalid,
    mint_order_payment_token,
    read_order_payment_token,
)
from datetime import datetime

from app.models import InstagramConversation, MpesaTransaction, Order, OrderStatusHistory
from app.services import mpesa_service
from app.services.customer_profile_service import CustomerProfileService
from app.services.order_tracking_service import OrderTrackingService
from app.services.mpesa_service import MpesaApiError, MpesaConfigurationMissing
from app.services.platform_runtime import is_dev_runtime
from app.support.mpesa_order_link import link_mpesa_transaction_to_order
from app.support.order_delivery_details import delivery_details_snapshot
from app.support.order_payments import order_uses_payment, payment_portion
from app.support.order_status import (
    AWAITING_PAYMENT,
    FULFILLMENT_DELIVERY,
    FULFILLMENT_PICKUP,
    PAYMENT_MPESA,
    PAYMENT_RECEIVED,
    PLACED,
    TERMINAL_STATUSES,
)

logger = logging.getLogger(__name__)


class OrderPaymentError(RuntimeError):
    pass


class OrderPaymentUnavailable(RuntimeError):
    pass


class OrderPaymentService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()
        self.profiles = CustomerProfileService(db)

    @staticmethod
    def payment_url(order_id: str, settings: Settings | None = None) -> str | None:
        cfg = settings or get_settings()
        base = (cfg.frontend_url or "").rstrip("/")
        if not base:
            return None
        token = mint_order_payment_token(order_id)
        return f"{base}/pay/{token}"

    def load(self, token: str) -> dict:
        order, conversation = self._order_and_conversation(token)
        account = conversation.account if conversation else None
        merchant_name = "Shop"
        platform = "instagram"
        external_id = ""
        customer = None

        if conversation and account:
            merchant_id, platform, external_id = self.profiles.identity(account, conversation)
            if account.name or account.username:
                merchant_name = (account.name or account.username or merchant_name).strip()
            if merchant_id and external_id:
                customer = self.profiles.get_profile(merchant_id, platform, external_id)
        elif order.account:
            merchant_name = (order.account.business_name or merchant_name).strip()

        suggested_name = (
            (order.customer_name or "").strip()
            or (conversation.participant_username if conversation else None)
            or (customer.display_name if customer else None)
            or ""
        ).strip().lstrip("@")

        saved_phone = None
        if customer and customer.has_usable_profile():
            saved_phone = customer.phone

        is_paid = bool(order.paid_at) or order.status in {
            PAYMENT_RECEIVED,
            *{s for s in TERMINAL_STATUSES if s not in {"cancelled", "refunded"}},
        }

        return {
            "order_number": order.order_number,
            "status": order.status,
            "merchant": {"name": merchant_name},
            "currency": order.currency or "KES",
            "total": float(order.total or 0),
            "items": [
                {
                    "product_name": line.product_name,
                    "quantity": line.quantity,
                    "line_total": float(line.line_total or 0),
                }
                for line in (order.items or [])
            ],
            "suggested_name": suggested_name,
            "saved_phone": saved_phone,
            "has_saved_profile": bool(customer and customer.has_usable_profile()),
            "is_paid": is_paid,
            "can_pay": (
                not is_paid
                and order.status not in TERMINAL_STATUSES
                and (not order.payment_method or order_uses_payment(order, PAYMENT_MPESA))
            ),
            "tracking_url": OrderTrackingService.tracking_url(order.id, self.settings),
            "platform": platform,
            "dev_mpesa_charge": 1 if is_dev_runtime(self.db) else None,
            "fulfillment_type": order.fulfillment_type or FULFILLMENT_DELIVERY,
            "delivery_details": delivery_details_snapshot(order),
            "mpesa_payment": self._mpesa_payment_snapshot(order),
        }

    @staticmethod
    def _mpesa_payment_snapshot(order: Order) -> dict | None:
        txn: MpesaTransaction | None = order.mpesa_transaction
        if not txn:
            return None

        status = (txn.status or "pending").strip().lower()
        can_retry = False
        message: str | None = None

        if status == "pending":
            message = (
                "M-PESA prompt sent to your phone. Enter your PIN to complete payment."
            )
        elif status == "cancelled":
            can_retry = True
            message = (
                "Your M-PESA payment was cancelled and did not go through. "
                "Please try again."
            )
        elif status == "failed":
            can_retry = True
            message = (
                "Your M-PESA payment did not go through. Please try again."
            )

        return {
            "status": status,
            "message": message,
            "can_retry": can_retry,
        }

    def submit(
        self,
        token: str,
        *,
        name: str,
        phone: str,
        consent: bool,
        fulfillment_type: str = FULFILLMENT_DELIVERY,
        delivery_location: str | None = None,
        delivery_instructions: str | None = None,
    ) -> dict:
        order, conversation = self._order_and_conversation(token)

        if order.status in TERMINAL_STATUSES:
            raise OrderPaymentUnavailable("This order is closed.")
        if order.paid_at or order.status == PAYMENT_RECEIVED:
            raise OrderPaymentError("This order has already been paid.")

        normalized_phone = self.profiles.extract_phone(phone or "")
        if not normalized_phone:
            raise OrderPaymentError(
                "Enter a valid M-PESA phone number (07XXXXXXXX or 2547XXXXXXXX)."
            )

        clean_name = (name or "").strip().lstrip("@")
        if len(clean_name) < 2:
            raise OrderPaymentError("Please enter your name.")

        if fulfillment_type not in {FULFILLMENT_PICKUP, FULFILLMENT_DELIVERY}:
            raise OrderPaymentError("Choose pickup or delivery.")

        order.customer_name = clean_name[:255]
        order.customer_phone = normalized_phone
        order.fulfillment_type = fulfillment_type
        if fulfillment_type == FULFILLMENT_PICKUP:
            order.delivery_address = None
            order.delivery_notes = None
        else:
            clean_location = (delivery_location or "").strip()
            if len(clean_location) < 5:
                raise OrderPaymentError("Please enter your delivery location.")
            clean_instructions = (delivery_instructions or "").strip()
            if len(clean_instructions) < 3:
                raise OrderPaymentError("Please enter delivery instructions.")
            order.delivery_address = clean_location[:2000]
            order.delivery_notes = clean_instructions[:2000]

        if not order_uses_payment(order, PAYMENT_MPESA):
            order.payment_method = PAYMENT_MPESA
            order.payment_splits = None

        mpesa_message = "Payment could not be started. Please try again."
        if conversation and conversation.account:
            merchant_id, platform, external_id = self.profiles.identity(
                conversation.account,
                conversation,
            )
            if merchant_id and external_id and consent:
                customer = self.profiles.get_or_create(merchant_id, platform, external_id)
                self.profiles.record_consent(customer, accepted=True)
                self.profiles.apply_pending_fields(
                    customer,
                    {
                        "display_name": clean_name[:255],
                        "phone": normalized_phone,
                    },
                )

        try:
            amount = max(1, int(round(float(payment_portion(order, PAYMENT_MPESA)))))
            txn = mpesa_service.stk_push(
                self.db,
                phone_number=normalized_phone,
                amount=amount,
                account_reference=order.order_number,
                transaction_desc=f"Order {order.order_number}",
                account_id=order.account_id,
            )
        except MpesaConfigurationMissing as exc:
            self.db.commit()
            raise OrderPaymentError(str(exc)) from exc
        except MpesaApiError as exc:
            self.db.commit()
            raise OrderPaymentError(str(exc)) from exc
        except Exception as exc:
            logger.warning("Order payment M-PESA push failed order=%s: %s", order.id, exc)
            self.db.commit()
            raise OrderPaymentError(
                "We could not send the M-PESA prompt. Please try again.",
            ) from exc

        now = datetime.utcnow()
        previous = order.status
        link_mpesa_transaction_to_order(self.db, order, txn)
        if order.status == PLACED:
            order.status = AWAITING_PAYMENT
            self.db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    from_status=previous,
                    to_status=AWAITING_PAYMENT,
                    note=f"M-PESA STK sent to {txn.phone_number} via payment link.",
                    created_at=now,
                ),
            )
        order.updated_at = now
        mpesa_message = (
            f"M-PESA payment request sent to {txn.phone_number}. "
            "Please enter your PIN on your phone."
        )

        self.db.commit()
        self.db.refresh(order)

        return {
            "order_number": order.order_number,
            "message": (
                "M-PESA prompt sent to your phone. Enter your PIN to complete payment."
            ),
            "mpesa_message": mpesa_message,
            "tracking_url": OrderTrackingService.tracking_url(order.id, self.settings),
            "mpesa_payment": self._mpesa_payment_snapshot(order),
        }

    def _order_and_conversation(
        self,
        token: str,
    ) -> tuple[Order, InstagramConversation | None]:
        try:
            payload = read_order_payment_token(token)
        except OrderPaymentTokenInvalid as exc:
            msg = str(exc)
            if "expired" in msg.lower():
                raise OrderPaymentUnavailable(msg) from exc
            raise OrderPaymentError(msg) from exc

        order = (
            self.db.query(Order)
            .options(
                selectinload(Order.items),
                joinedload(Order.account),
                joinedload(Order.mpesa_transaction),
            )
            .filter(Order.id == str(payload["oid"]))
            .first()
        )
        if not order:
            raise OrderPaymentUnavailable("This order is no longer available.")

        conversation = None
        if order.source_conversation_id:
            conversation = (
                self.db.query(InstagramConversation)
                .options(joinedload(InstagramConversation.account))
                .filter(InstagramConversation.id == order.source_conversation_id)
                .first()
            )
        return order, conversation
