from __future__ import annotations

import re
from urllib.parse import urljoin
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.config import Settings
from app.models import (
    InstagramAccount,
    InstagramConversation,
    InstagramMessage,
    InventoryItem,
    Order,
    OrderItem,
    OrderStatusHistory,
)
from app.services import mpesa_service
from app.services.customer_profile_service import CustomerProfileService
from app.services.dm_templates import format_menu_reminder
from app.services.inventory_stock_service import InsufficientStockError
from app.services.order_creation import StorePausedError, build_instagram_order
from app.services.order_notification_service import OrderNotificationService
from app.services.product_media_service import effective_item_image_url
from app.support.order_status import (
    AWAITING_PAYMENT,
    PAYMENT_MPESA,
    PAYMENT_RECEIVED,
    PLACED,
)
from app.support.sales_session import (
    STEP_AWAITING_CONSENT,
    STEP_AWAITING_PAYMENT,
    STEP_AWAITING_PHONE,
    STEP_AWAITING_QUANTITY,
    STEP_HANDOFF,
    STEP_IDLE,
    STEP_PRODUCT_SELECTED,
    STEP_TRACKING,
    read_session,
    write_session,
)

PHONE_RE = re.compile(r"(?:\+?254|0)?[71]\d{8}")
BUY_INTENT_RE = re.compile(
    r"\b(buy|order|take|purchase|nitake|nataka|naitaka|i want|i need)\b",
    re.IGNORECASE,
)
INFO_INTENT_RE = re.compile(
    r"\b(price|cost|how much|available|stock|details|info|catalog|menu|enquire|enquiry|inquire|inquiry)\b",
    re.IGNORECASE,
)
TRACK_INTENT_RE = re.compile(r"\b(track|status|where is my order|order ref)\b", re.IGNORECASE)
CONFIRM_RE = re.compile(r"^(yes|y|yeah|ok|okay|sure|1|ndio|sawa)\b", re.IGNORECASE)
# Standalone small integer (1–999). `\b` boundaries keep this from matching a
# digit inside a phone number like 0712345678.
QUANTITY_RE = re.compile(r"\b([1-9][0-9]{0,2})\b")
WORD_QUANTITIES = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "a": 1, "an": 1, "single": 1, "moja": 1, "mbili": 2, "tatu": 3,
}
MAX_QUANTITY = 999
DECLINE_RE = re.compile(r"^(no|n|nope|2|hapana|new|start over|fresh)\b", re.IGNORECASE)
MENU_RE = re.compile(r"^(menu|main menu|back|home|start|0)\b", re.IGNORECASE)
HUMAN_RE = re.compile(r"\b(human|agent|person|team|representative|customer care|support)\b", re.IGNORECASE)
# Postback payload prefix for "Order this" buttons on product cards. The
# inventory item id is appended after the prefix, e.g. "SHOP_SELECT:abc123".
SHOP_SELECT_PREFIX = "SHOP_SELECT:"


@dataclass
class CatalogPortfolioItem:
    index: int
    name: str
    price_kes: int
    image_url: str | None


@dataclass
class SalesAutopilotReply:
    """`text` is the closing line (or full message when no catalogue images)."""

    text: str
    catalog_intro: str | None = None
    catalog_items: list[CatalogPortfolioItem] | None = None


class SalesAutopilotService:
    """Sell → M-PESA payment → confirm → track until delivered, with consent-based profiles."""

    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        from app.config import get_settings

        self.settings = settings or get_settings()
        self.profiles = CustomerProfileService(db)
        self.order_notify = OrderNotificationService(db, self.settings)

    def build_reply(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        inbound: InstagramMessage,
    ) -> SalesAutopilotReply | None:
        text = (inbound.body or "").strip()
        if not text:
            return None
        text_lower = text.lower()

        account = (
            self.db.query(InstagramAccount)
            .options(joinedload(InstagramAccount.user))
            .filter(InstagramAccount.id == account.id)
            .first()
        ) or account

        merchant_id = str(account.account_id or "")
        if not merchant_id:
            merchant_id, platform, external_id = self.profiles.identity(account, conversation)
        else:
            platform = account.platform or "instagram"
            external_id = str(conversation.participant_ig_id or "")
        if not merchant_id:
            return None

        customer = self.profiles.get_or_create(merchant_id, platform, external_id)
        script = self._script(account)
        session = read_session(conversation.sales_session)
        step = session.get("step", STEP_IDLE)
        now = datetime.utcnow()

        session["last_customer_message_at"] = now.isoformat()
        conversation.sales_session = session
        step = session.get("step", STEP_IDLE)

        resume_reply = self._handle_resume_choice(session, text, conversation)
        if resume_reply:
            return SalesAutopilotReply(text=resume_reply)

        if MENU_RE.match(text):
            session.pop("handoff_active", None)
            session.pop("handoff_requested_at", None)
            write_session(conversation, step=STEP_IDLE)
            return SalesAutopilotReply(text=self._main_menu(conversation))

        if self._is_menu_selection(text_lower, "4") or HUMAN_RE.search(text):
            return SalesAutopilotReply(text=self._activate_handoff(session))

        if session.get("handoff_active"):
            return None

        consent_reply = self._handle_consent_flow(
            customer,
            conversation,
            text,
            step,
            display_name=conversation.participant_username,
        )
        if consent_reply:
            return consent_reply

        if TRACK_INTENT_RE.search(text):
            return SalesAutopilotReply(text=self._with_menu_hint(self._track_order_message(conversation)))

        payment_reply = self._handle_awaiting_payment(session, text)
        if payment_reply:
            return payment_reply

        inventory = self._top_inventory(merchant_id, limit=8)

        is_first_inbound = self._is_first_inbound(conversation, inbound)

        if step == STEP_IDLE and customer.has_usable_profile() and self._is_light_greeting(text):
            write_session(conversation, step=STEP_IDLE)
            welcome = self.profiles.welcome_back_message(customer)
            if welcome:
                return SalesAutopilotReply(text=self._with_menu_hint(welcome))

        selected = self._select_inventory_item(text, inventory)
        buy_intent = bool(BUY_INTENT_RE.search(text)) or step in {
            STEP_PRODUCT_SELECTED,
            STEP_AWAITING_PHONE,
        }
        asks_info = bool(INFO_INTENT_RE.search(text))
        if self._is_menu_selection(text_lower, "2"):
            asks_info = True
        if self._is_menu_selection(text_lower, "1"):
            buy_intent = True
        if self._is_menu_selection(text_lower, "3"):
            write_session(conversation, step=STEP_TRACKING)
            return SalesAutopilotReply(
                text=self._with_menu_hint(self._track_order_message(conversation)),
            )
        if "product" in text_lower and ("enquire" in text_lower or "inquire" in text_lower):
            asks_info = True
        phone = self.profiles.extract_phone(text) or (
            customer.phone if customer.has_usable_profile() else None
        )

        if step == STEP_PRODUCT_SELECTED and CONFIRM_RE.match(text) and session.get("inventory_item_id"):
            selected = self._item_by_id(session["inventory_item_id"], merchant_id)
            buy_intent = True
            if customer.has_usable_profile() and customer.phone:
                phone = customer.phone

        if selected and buy_intent and phone:
            return self._complete_purchase(
                account,
                conversation,
                customer,
                selected,
                phone,
                text,
            )

        if selected and buy_intent and not phone:
            write_session(
                conversation,
                step=STEP_AWAITING_PHONE,
                inventory_item_id=selected.id,
            )
            amount = int(round(float(selected.selling_price or 0)))
            saved_hint = ""
            if customer.has_usable_profile():
                saved_hint = (
                    f"\nOr reply **YES** to pay with your saved number "
                    f"ending {(customer.phone or '')[-4:]}."
                )
            return SalesAutopilotReply(
                text=(
                    f"Great — {selected.product.name} is KES {amount}.\n"
                    "Send your M-PESA number (`07XXXXXXXX` or `2547XXXXXXXX`) "
                    "and we will send a payment prompt.\n"
                    "We only prepare your order after payment is confirmed."
                    f"{saved_hint}"
                    "\n\nReply `menu` anytime to go back."
                ),
            )

        if selected and (asks_info or step == STEP_IDLE):
            write_session(conversation, step=STEP_PRODUCT_SELECTED, inventory_item_id=selected.id)
            return SalesAutopilotReply(text=self._with_menu_hint(self._product_pitch(selected, customer)))

        if asks_info:
            if not inventory:
                return SalesAutopilotReply(text=self._with_menu_hint(self._catalog_unavailable_reply()))
            return self._build_catalog_reply(inventory)

        if is_first_inbound and step == STEP_IDLE:
            return SalesAutopilotReply(text=self._main_menu(conversation))

        if buy_intent:
            if not inventory:
                return SalesAutopilotReply(
                    text=(
                        f"{script['opening_line']}\n"
                        "I am checking what is available right now.\n"
                        "Tell me what product you want (for example: iPhone 15 case), "
                        "and I will confirm price and availability."
                        "\n\nReply `menu` anytime to go back."
                    ),
                )
            reply = self._build_catalog_reply(inventory)
            reply.text = self._with_menu_hint(
                reply.text + "\n\nReply with the product name you want and I will continue your order."
            )
            return reply

        if step == STEP_IDLE:
            return SalesAutopilotReply(text=format_menu_reminder(conversation))
        return None

    def select_item_for_order(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        inventory_item_id: str,
    ) -> SalesAutopilotReply | None:
        """Select a product from an "Order this" card tap and pitch it.

        Returns ``None`` when the item can no longer be found so the caller can
        tell the customer it is unavailable.
        """
        account = (
            self.db.query(InstagramAccount)
            .options(joinedload(InstagramAccount.user))
            .filter(InstagramAccount.id == account.id)
            .first()
        ) or account

        merchant_id = str(account.account_id or "")
        if not merchant_id:
            merchant_id, platform, external_id = self.profiles.identity(account, conversation)
        else:
            platform = account.platform or "instagram"
            external_id = str(conversation.participant_ig_id or "")
        if not merchant_id:
            return None

        item = self._item_by_id(inventory_item_id, merchant_id)
        if item is None or not item.is_active:
            return None

        customer = self.profiles.get_or_create(merchant_id, platform, external_id)
        write_session(conversation, step=STEP_PRODUCT_SELECTED, inventory_item_id=item.id)
        return SalesAutopilotReply(text=self._with_menu_hint(self._product_pitch(item, customer)))

    def _main_menu(self, conversation: InstagramConversation) -> str:
        username = (conversation.participant_username or "").strip().lstrip("@")
        handle = f"@{username}" if username else "there"
        return (
            f"Hello {handle}! Thanks so much for reaching out — we're really glad you're here.\n"
            "How can we assist you today?\n\n"
            "Tap an option below to continue."
        )

    def _with_menu_hint(self, text: str) -> str:
        if "reply `menu` anytime" in text.lower():
            return text
        return f"{text}\n\nReply `menu` anytime to go back."

    def _parse_session_time(self, value: object) -> datetime | None:
        if not isinstance(value, str) or not value.strip():
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _mark_conversation_timed_out(self, session: dict, current_step: str) -> None:
        session["ended_due_to_inactivity"] = True
        session["resume_step"] = current_step
        if session.get("inventory_item_id"):
            session["resume_inventory_item_id"] = session.get("inventory_item_id")
        if session.get("order_id"):
            session["resume_order_id"] = session.get("order_id")
        session["step"] = STEP_IDLE
        session.pop("inventory_item_id", None)
        session.pop("order_id", None)

    def _handle_resume_choice(
        self,
        session: dict,
        text: str,
        conversation: InstagramConversation,
    ) -> str | None:
        if not session.get("pending_resume_choice"):
            return None

        if CONFIRM_RE.match(text):
            session.pop("pending_resume_choice", None)
            session.pop("ended_due_to_inactivity", None)
            session.pop("session_ended_notified", None)
            step = str(session.pop("resume_step", STEP_IDLE) or STEP_IDLE)
            conversation.sales_session = session
            session["step"] = step
            if session.get("resume_inventory_item_id"):
                session["inventory_item_id"] = session.pop("resume_inventory_item_id")
            if session.get("resume_order_id"):
                session["order_id"] = session.pop("resume_order_id")

            conversation.sales_session = session
            if step == STEP_AWAITING_PAYMENT and session.get("order_id"):
                return self._with_menu_hint(
                    "Welcome back. We resumed your previous order conversation.\n"
                    "Reply `pay` to check payment status, or `track` to get the latest status."
                )
            return self._with_menu_hint("Welcome back. We resumed your previous conversation.")

        if DECLINE_RE.match(text):
            session.clear()
            session["step"] = STEP_IDLE
            session["last_customer_message_at"] = datetime.utcnow().isoformat()
            conversation.sales_session = session
            return "No problem — we have started a fresh conversation.\n\n" + self._main_menu_from_text()

        conversation.sales_session = session
        return (
            "Would you like to proceed from where we left off, or start a new conversation?\n"
            "Reply **YES** to continue, or **NO** to start fresh."
        )

    def _main_menu_from_text(self) -> str:
        return "How can we assist you today? Tap an option below to continue."

    def _activate_handoff(self, session: dict) -> str:
        session["handoff_active"] = True
        session["handoff_requested_at"] = datetime.utcnow().isoformat()
        session["step"] = STEP_HANDOFF
        return (
            "You are now connected to a member of our team.\n"
            "We have paused automated replies on this chat so a human can assist you.\n"
            "Reply `menu` anytime if you want to continue with the bot."
        )

    def _is_first_inbound(
        self,
        conversation: InstagramConversation,
        inbound: InstagramMessage,
    ) -> bool:
        inbound_count = 0
        for message in conversation.messages:
            if message.direction != "inbound":
                continue
            if message.id == inbound.id:
                continue
            inbound_count += 1
            if inbound_count >= 1:
                return False
        return True

    def _first_message_pitch(self, account: InstagramAccount, inventory: list[InventoryItem]) -> str:
        script = self._script(account)
        top_picks = self._inventory_cards_text(inventory, limit=3)
        return (
            f"{script['opening_line']}\n"
            "Great to have you here. I can help you pick and order in minutes.\n\n"
            "Top picks right now:\n"
            f"{top_picks}\n\n"
            "Reply with a product name to order, or ask for price/availability."
        )

    def _handle_consent_flow(
        self,
        customer,
        conversation: InstagramConversation,
        text: str,
        step: str,
        *,
        display_name: str | None,
    ) -> SalesAutopilotReply | None:
        if step != STEP_AWAITING_CONSENT and customer.consent_status != "pending":
            return None

        decision = self.profiles.parse_consent_reply(text)
        if decision is None:
            if step == STEP_AWAITING_CONSENT:
                return SalesAutopilotReply(
                    text="Please reply **YES** to save your details, or **NO** to continue without saving.",
                )
            return None

        accepted = decision == "accepted"
        if accepted:
            pending = read_session(conversation.sales_session).get("pending_profile") or {}
            if pending:
                self.profiles.apply_pending_fields(customer, pending)
        self.profiles.record_consent(customer, accepted)
        write_session(conversation, clear=True)
        if accepted:
            self.db.commit()
            return SalesAutopilotReply(
                text=(
                    "Thank you — your details are saved for next time.\n"
                    "Future orders will be faster. What would you like to buy today?"
                ),
            )
        self.db.commit()
        return SalesAutopilotReply(
            text="No problem — we won't save your details. How else can we help you?",
        )

    def _handle_awaiting_payment(self, session: dict, text: str) -> SalesAutopilotReply | None:
        order_id = session.get("order_id")
        if not order_id or session.get("step") == STEP_AWAITING_CONSENT:
            return None
        if not re.search(r"\b(pay|payment|mpesa|paid|prompt|pin|status)\b", text, re.IGNORECASE):
            return None
        order = self.db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return None
        if order.status == PAYMENT_RECEIVED:
            return SalesAutopilotReply(
                text=(
                    f"Payment for {order.order_number} is already confirmed. "
                    "We will keep you updated as your order moves along."
                ),
            )
        if order.status == AWAITING_PAYMENT:
            return SalesAutopilotReply(
                text=(
                    f"Order {order.order_number} is still waiting for M-PESA payment.\n"
                    "Check your phone for the prompt and enter your PIN.\n"
                    "Reply **TRACK** anytime for live status."
                ),
            )
        return None

    def _complete_purchase(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        customer,
        item: InventoryItem,
        phone: str,
        note: str,
    ) -> SalesAutopilotReply:
        fields = self.profiles.merge_from_message(
            customer,
            note,
            display_name=conversation.participant_username,
        )
        if phone:
            fields["phone"] = phone

        try:
            order = self._create_order(account, conversation, customer, item, phone, note)
        except InsufficientStockError as exc:
            product_name = (item.product.name if item.product else "that item").strip()
            return SalesAutopilotReply(
                text=(
                    f"Sorry — we only have {exc.available} of {product_name} left in stock. "
                    "Please choose a smaller quantity or another product."
                ),
            )
        except StorePausedError:
            return SalesAutopilotReply(
                text=(
                    "This shop is temporarily not accepting orders. "
                    "Please try again shortly — sorry for the inconvenience."
                ),
            )

        self.order_notify.notify_status_change(order, PLACED, force=True)

        write_session(
            conversation,
            step=STEP_TRACKING,
            order_id=order.id,
            inventory_item_id=item.id,
        )

        reply = (
            f"Your order has been placed.\n"
            f"Ref: {order.order_number}\n"
            f"Total: KES {int(round(float(order.total or 0)))}\n\n"
            "We will message you with a link to track your order shortly, "
            "then at every step until delivery."
        )

        if self.profiles.needs_consent_prompt(customer, fields):
            self.profiles.mark_consent_asked(customer)
            session_data = read_session(conversation.sales_session)
            session_data["pending_profile"] = fields
            session_data["step"] = STEP_AWAITING_CONSENT
            session_data["order_id"] = order.id
            conversation.sales_session = session_data
            reply += f"\n\n{self.profiles.ask_consent_message(self._script(account)['consent_prompt'])}"

        self.db.commit()
        return SalesAutopilotReply(text=reply)

    def _track_order_message(self, conversation: InstagramConversation) -> str:
        order = (
            self.db.query(Order)
            .filter(Order.source_conversation_id == conversation.id)
            .order_by(Order.created_at.desc())
            .first()
        )
        if not order:
            return (
                "I could not find an active order on this chat.\n"
                "Place an order first, or share your order number (e.g. ORD-000123)."
            )
        from app.support.order_status import STATUS_LABELS

        label = STATUS_LABELS.get(order.status, order.status)
        lines = [
            f"Order {order.order_number}",
            f"Status: {label}",
            f"Total: KES {int(round(float(order.total or 0)))}",
        ]
        if order.status == AWAITING_PAYMENT:
            lines.append("Waiting for M-PESA payment — check your phone for the prompt.")
        elif order.status == PAYMENT_RECEIVED:
            lines.append("Payment received — we are preparing your order.")
        elif order.status in {"delivered", "picked_up"}:
            lines.append("This order is complete. Thank you!")
        elif order.status in {
            "awaiting_delivery_confirmation",
            "awaiting_pickup_confirmation",
        }:
            lines.append(
                "Waiting for both you and the shop to confirm — reply here or use your tracking link."
            )
        else:
            lines.append("We will notify you here whenever the status changes.")
        return "\n".join(lines)

    def _top_inventory(self, account_id: str, limit: int) -> list[InventoryItem]:
        return (
            self.db.query(InventoryItem)
            .filter(InventoryItem.account_id == account_id, InventoryItem.is_active.is_(True))
            .order_by(InventoryItem.updated_at.desc().nullslast())
            .limit(limit)
            .all()
        )

    def _item_by_id(self, item_id: str, account_id: str) -> InventoryItem | None:
        return (
            self.db.query(InventoryItem)
            .filter(InventoryItem.id == item_id, InventoryItem.account_id == account_id)
            .first()
        )

    def _select_inventory_item(self, text: str, inventory: list[InventoryItem]) -> InventoryItem | None:
        lowered = text.lower()
        exact: list[InventoryItem] = []
        partial: list[InventoryItem] = []
        for item in inventory:
            if item.product is None:
                continue
            name = (item.product.name or "").strip().lower()
            if not name:
                continue
            if name in lowered:
                exact.append(item)
                continue
            tokens = [part for part in re.split(r"[^a-z0-9]+", name) if len(part) >= 4]
            if any(token in lowered for token in tokens):
                partial.append(item)
        return (exact or partial or [None])[0]

    def _is_light_greeting(self, text: str) -> bool:
        return bool(re.match(r"^(hi|hello|hey|habari|good\s*(morning|afternoon|evening))[\s!.?]*$", text, re.I))

    def _build_catalog_reply(self, inventory: list[InventoryItem]) -> SalesAutopilotReply:
        items: list[CatalogPortfolioItem] = []
        index = 1
        for item in inventory[:5]:
            if item.product is None:
                continue
            price = int(round(float(item.selling_price or 0)))
            items.append(
                CatalogPortfolioItem(
                    index=index,
                    name=item.product.name,
                    price_kes=price,
                    image_url=self._product_image_url(item),
                ),
            )
            index += 1

        if not items:
            return SalesAutopilotReply(
                text=self._with_menu_hint(self._catalog_unavailable_reply()),
            )

        return SalesAutopilotReply(
            catalog_intro="Here is our catalogue:",
            catalog_items=items,
            text=self._with_menu_hint(
                "What would you like to inquire about or buy from this list?"
            ),
        )

    def _catalog_pitch(self, inventory: list[InventoryItem]) -> str:
        """Plain-text fallback when image sends are unavailable."""
        bullets = self._inventory_portfolio_text(inventory, limit=5)
        return (
            "Here is our catalogue:\n"
            f"{bullets}\n\n"
            "What would you like to inquire about or buy from this list?"
        )

    def _inventory_cards_text(self, inventory: list[InventoryItem], *, limit: int) -> str:
        cards: list[str] = []
        for item in inventory[:limit]:
            if item.product is None:
                continue
            price = int(round(float(item.selling_price or 0)))
            line = f"- {item.product.name} — KES {price}"
            image = self._product_image_url(item)
            if image:
                line += f"\n  Photo: {image}"
            cards.append(line)
        return "\n".join(cards) if cards else "- Ask for our latest offers"

    def _inventory_portfolio_text(self, inventory: list[InventoryItem], *, limit: int) -> str:
        sections: list[str] = []
        index = 1
        for item in inventory[:limit]:
            if item.product is None:
                continue
            price = int(round(float(item.selling_price or 0)))
            section = f"Photo {index}\n{index}. {item.product.name}, which is KES {price}."
            image = self._product_image_url(item)
            if image:
                section += f"\n{image}"
            sections.append(section)
            index += 1
        return "\n\n".join(sections) if sections else "No products are available right now."

    @staticmethod
    def _is_menu_selection(text: str, option: str) -> bool:
        return bool(re.match(rf"^\s*{re.escape(option)}\s*$", text))

    def _catalog_unavailable_reply(self) -> str:
        return (
            "Thanks for checking in. Our live catalog is being updated right now.\n"
            "Tell me the exact item you need (for example: iPhone 15 case), "
            "and I will confirm price and availability immediately."
        )

    def _engagement_nudge(self, inventory: list[InventoryItem]) -> str:
        if inventory:
            cards = self._inventory_cards_text(inventory, limit=3)
            return (
                "Great question. Here are some options you can order right now:\n"
                f"{cards}\n\n"
                "Reply with the product name and I will help you place the order."
            )
        return self._catalog_unavailable_reply()

    def _product_image_url(self, item: InventoryItem) -> str | None:
        relative = effective_item_image_url(item)
        if not relative:
            return None
        if relative.startswith("http://") or relative.startswith("https://"):
            return relative
        if relative.startswith("/"):
            return urljoin(self.settings.frontend_url.rstrip("/") + "/", relative.lstrip("/"))
        return relative

    def _product_pitch(self, item: InventoryItem, customer) -> str:
        product_name = item.product.name if item.product else "this item"
        price = int(round(float(item.selling_price or 0)))
        extra = ""
        if customer.has_usable_profile():
            extra = (
                f"\nYou have a saved profile — reply **YES** to order with your number "
                f"ending {(customer.phone or '')[-4:]}, or send a new M-PESA number."
            )
        else:
            extra = (
                "\nReply with your M-PESA number when ready, or say **BUY** to continue."
            )
        return (
            f"{product_name} — KES {price}. In stock and ready to ship.\n"
            f"{extra.strip()}"
        )

    def _next_order_number(self) -> str:
        seq = int((self.db.query(func.count(Order.id)).scalar() or 0) + 1)
        while True:
            candidate = f"ORD-{seq:06d}"
            if not self.db.query(Order.id).filter(Order.order_number == candidate).first():
                return candidate
            seq += 1

    def _create_order(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        customer,
        item: InventoryItem,
        phone: str,
        note: str,
    ) -> Order:
        source = account.platform if account.platform in {"instagram", "whatsapp"} else "instagram"
        order = build_instagram_order(
            self.db,
            account_id=str(item.account_id),
            conversation_id=conversation.id,
            line_items=[(item, 1)],
            phone=phone,
            note=note,
            customer_name=conversation.participant_username,
            source=source,
        )
        self.profiles.apply_to_order(customer, order)
        self.db.flush()
        self.db.refresh(order)
        return order

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
        except Exception as exc:
            return (
                "We could not send the M-PESA prompt automatically. "
                f"Please contact us to pay. ({exc})"
            )

    def _script(self, account: InstagramAccount) -> dict[str, str]:
        defaults = {
            "tone": "professional",
            "opening_line": (
                "Introduce yourself as DukAI and offer to help with products, orders, or delivery."
            ),
            "payment_rule_line": (
                "After order confirmation, payment is via M-PESA — send the payment prompt or link then."
            ),
            "consent_prompt": (
                "Before we continue — may we save your details for faster checkout next time? "
                "Reply YES to agree, or NO to skip."
            ),
        }
        checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
        script = checks.get("sales_autopilot_script") if isinstance(checks, dict) else {}
        if not isinstance(script, dict):
            return defaults
        merged = dict(defaults)
        for key in defaults:
            value = script.get(key)
            if isinstance(value, str) and value.strip():
                merged[key] = value.strip()
        return merged
