"""Public web storefront: tokenized catalogue browse + checkout.

An Instagram customer taps a DM link (`/shop/<token>`), browses the shop's
active catalogue, builds a multi-item cart, and checks out. We then create one
combined Instagram order and DM them the order reference with a tracking card —
reusing the exact pipeline the text autopilot uses. Payment is requested later
from the merchant dashboard when the order moves to the payment stage.

Security model (see ``app/core/storefront_tokens.py``): the link is signed and
short-lived, and carries a per-mint ``jti`` that must match the one stored on
the conversation. Checkout consumes that ``jti`` so the link is single-use, and
minting a fresh link rotates it (invalidating older links).
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from app.services.product_media_service import effective_item_image_url
from app.core.storefront_tokens import (
    StorefrontTokenInvalid,
    mint_storefront_token,
    new_jti,
    read_storefront_token,
    STOREFRONT_TOKEN_MAX_AGE,
)
from app.models import (
    InstagramAccount,
    InstagramConversation,
    InventoryItem,
    Order,
    OrderStatusHistory,
)
from app.services import mpesa_service
from app.services.customer_profile_service import CustomerProfileService
from app.services.order_creation import MAX_QUANTITY, StorePausedError, build_instagram_order
from app.services.inventory_stock_service import InsufficientStockError
from app.services.order_notification_service import OrderNotificationService
from app.services.order_tracking_service import OrderTrackingService
from app.support.order_status import PLACED
from app.support.sales_session import (
    STEP_TRACKING,
    read_session,
)

logger = logging.getLogger(__name__)


class StorefrontError(RuntimeError):
    """A 400-class problem (bad input, empty cart, item unavailable)."""


class StorefrontUnavailable(RuntimeError):
    """A 410-class problem (link expired, used, or replaced)."""


class StorefrontService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()
        self.profiles = CustomerProfileService(db)

    # ── Link minting (called from the sales autopilot) ──────────────────────

    def mint_link(self, conversation: InstagramConversation) -> str | None:
        """Rotate the conversation's storefront nonce and return a fresh URL.

        Returns ``None`` when no public base URL is configured (the caller then
        falls back to the in-chat text catalogue). The caller owns the commit.
        """
        base = (self.settings.frontend_url or "").rstrip("/")
        if not base:
            return None
        jti = new_jti()
        data = read_session(conversation.sales_session)
        data["storefront_jti"] = jti
        conversation.sales_session = data
        token = mint_storefront_token(conversation.id, jti)
        return f"{base}/shop/{token}"

    # ── Public read: catalogue ──────────────────────────────────────────────

    def load_catalogue(self, token: str) -> dict:
        conversation = self._conversation_from_token(token)
        account = conversation.account
        merchant_id, platform, external_id = self.profiles.identity(account, conversation)
        if not merchant_id:
            raise StorefrontUnavailable("This shop is not available right now.")

        items = self._active_inventory(merchant_id)
        customer = self.profiles.get_profile(merchant_id, platform, external_id)
        saved_phone = (
            customer.phone if customer and customer.has_usable_profile() else None
        )

        return {
            "merchant": {
                "name": (account.name or account.username or "Our shop"),
                "username": account.username,
            },
            "currency": "KES",
            "saved_phone": saved_phone,
            "expires_in": STOREFRONT_TOKEN_MAX_AGE,
            "items": [
                {
                    "id": item.id,
                    "name": (item.product.name if item.product else "Product"),
                    "brand": (item.product.brand if item.product else None),
                    "category": (item.product.category if item.product else None),
                    "unit": (item.product.unit if item.product else None),
                    "price": float(item.selling_price or 0),
                    "image_url": effective_item_image_url(item),
                }
                for item in items
            ],
        }

    # ── Public write: checkout ──────────────────────────────────────────────

    def checkout(
        self,
        token: str,
        raw_items: list[dict],
        phone: str,
    ) -> dict:
        conversation = self._conversation_from_token(token, enforce_jti=True)
        account = conversation.account
        merchant_id, platform, external_id = self.profiles.identity(account, conversation)
        if not merchant_id:
            raise StorefrontUnavailable("This shop is not available right now.")

        normalized_phone = self.profiles.extract_phone(phone or "")
        if not normalized_phone:
            raise StorefrontError(
                "Enter a valid M-PESA phone number (07XXXXXXXX or 2547XXXXXXXX)."
            )

        line_items = self._resolve_line_items(merchant_id, raw_items)
        if not line_items:
            raise StorefrontError("Your cart is empty.")

        customer = self.profiles.get_or_create(merchant_id, platform, external_id)
        try:
            order = build_instagram_order(
                self.db,
                account_id=merchant_id,
                conversation_id=conversation.id,
                line_items=line_items,
                phone=normalized_phone,
                note="Web storefront order",
                customer_name=conversation.participant_username,
                source="instagram",
            )
        except InsufficientStockError as exc:
            raise StorefrontError(str(exc)) from exc
        except StorePausedError as exc:
            raise StorefrontError(str(exc)) from exc
        self.profiles.apply_to_order(customer, order)
        self.db.flush()

        # Consume the single-use token and park the conversation on tracking so
        # the customer can reply "track" in the DM afterwards.
        session = read_session(conversation.sales_session)
        session.pop("storefront_jti", None)
        session["step"] = STEP_TRACKING
        session["order_id"] = order.id
        session["inventory_item_id"] = line_items[0][0].id
        conversation.sales_session = session

        notifier = OrderNotificationService(self.db, self.settings)
        notifier.notify_status_change(order, PLACED, force=True)

        self.db.commit()
        self.db.refresh(order)

        return {
            "order_number": order.order_number,
            "total": float(order.total or 0),
            "currency": order.currency or "KES",
            "item_count": sum(qty for _, qty in line_items),
            "tracking_url": OrderTrackingService.tracking_url(order.id, self.settings),
        }

    # ── Internals ───────────────────────────────────────────────────────────

    def _conversation_from_token(
        self,
        token: str,
        *,
        enforce_jti: bool = False,
    ) -> InstagramConversation:
        try:
            payload = read_storefront_token(token)
        except StorefrontTokenInvalid as exc:
            raise StorefrontUnavailable(str(exc)) from exc

        conversation = (
            self.db.query(InstagramConversation)
            .options(
                joinedload(InstagramConversation.account).joinedload(
                    InstagramAccount.user
                ),
            )
            .filter(InstagramConversation.id == str(payload["cid"]))
            .first()
        )
        if not conversation or not conversation.account:
            raise StorefrontUnavailable("This storefront link is no longer valid.")

        if enforce_jti:
            current = read_session(conversation.sales_session).get("storefront_jti")
            if not current or current != payload.get("jti"):
                raise StorefrontUnavailable(
                    "This link has already been used or replaced. "
                    "Reply 'catalogue' in your chat for a fresh one."
                )

        return conversation

    def _active_inventory(self, merchant_id: str) -> list[InventoryItem]:
        return (
            self.db.query(InventoryItem)
            .options(joinedload(InventoryItem.product))
            .filter(
                InventoryItem.account_id == merchant_id,
                InventoryItem.is_active.is_(True),
                InventoryItem.selling_price.isnot(None),
            )
            .order_by(
                InventoryItem.updated_at.is_(None),
                InventoryItem.updated_at.desc(),
                InventoryItem.id.desc(),
            )
            .all()
        )

    def _resolve_line_items(
        self,
        merchant_id: str,
        raw_items: list[dict],
    ) -> list[tuple[InventoryItem, int]]:
        line_items: list[tuple[InventoryItem, int]] = []
        seen: set[str] = set()
        for entry in raw_items or []:
            item_id = str((entry or {}).get("inventory_item_id") or "").strip()
            if not item_id or item_id in seen:
                continue
            try:
                quantity = int((entry or {}).get("quantity") or 0)
            except (TypeError, ValueError):
                raise StorefrontError("Invalid quantity in your cart.")
            if quantity < 1:
                continue
            quantity = min(quantity, MAX_QUANTITY)

            item = (
                self.db.query(InventoryItem)
                .options(joinedload(InventoryItem.product))
                .filter(
                    InventoryItem.id == item_id,
                    InventoryItem.account_id == merchant_id,
                    InventoryItem.is_active.is_(True),
                )
                .first()
            )
            if not item or item.selling_price is None:
                raise StorefrontError(
                    "One of the items in your cart is no longer available."
                )
            seen.add(item_id)
            line_items.append((item, quantity))
        return line_items

    def _trigger_mpesa(self, order: Order) -> str:
        try:
            amount = max(1, int(round(float(order.total or 0))))
            txn = mpesa_service.stk_push(
                self.db,
                phone_number=str(order.customer_phone or ""),
                amount=amount,
                account_reference=order.order_number,
                transaction_desc=f"Order {order.order_number}",
                account_id=order.account_id,
            )
            now = datetime.utcnow()
            previous = order.status
            from app.support.mpesa_order_link import link_mpesa_transaction_to_order

            link_mpesa_transaction_to_order(self.db, order, txn)
            if order.status == PLACED:
                order.status = AWAITING_PAYMENT
                self.db.add(
                    OrderStatusHistory(
                        order_id=order.id,
                        from_status=previous,
                        to_status=AWAITING_PAYMENT,
                        note=f"M-PESA STK sent to {txn.phone_number}.",
                        created_at=now,
                    ),
                )
            order.updated_at = now
            self.db.flush()
            return (
                f"M-PESA payment request sent to {txn.phone_number}. "
                "Please enter your PIN on your phone."
            )
        except Exception as exc:  # noqa: BLE001 - surface a friendly message
            logger.warning("Storefront M-PESA push failed order=%s: %s", order.id, exc)
            return (
                "We could not send the M-PESA prompt automatically. "
                "Please contact us to pay."
            )
