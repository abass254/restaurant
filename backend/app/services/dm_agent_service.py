"""LLM-powered Instagram DM agent with deterministic commerce tools."""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.agent_reply_policy import conversation_live_agent_handoff, platform_bot_is_ai_agent
from app.services.dm_chips_only import parse_product_select_payload, parse_quantity_payload
from app.support.quantity_parse import parse_quantity
from app.services.ai_agent_config import effective_agent_settings
from app.services.dm_agent_context import build_conversation_context
from app.services.dm_agent_tools import AGENT_TOOL_DEFINITIONS, DmAgentTools, merchant_script, resolve_shop_display_name
from app.services.dm_chat_provider import (
    ChatMessage,
    DmChatDisabled,
    DmChatError,
    chat_completion,
    chat_provider_available,
    user_facing_agent_error,
)
from app.services.dm_templates import (
    format_live_agent_reply,
    format_order_confirm_prompt,
    format_order_declined_message,
    format_order_placed_message,
    GREETING_CHIP_MENU_CHOICES,
    is_order_confirm_no,
    is_order_confirm_yes,
    STARTER_PAYLOAD_CHOICES,
)
from app.services.platform_instagram import channel_auto_replies_active, supports_dm_bot
from app.services.support_ticket_service import SupportTicketService
from app.services.agent_typing_signals import signal_agent_typing
from app.support.dm_order_intent import parse_suggestion_pick, resolve_pending_order_item_id
from app.support.datetime_utils import utc_now
from app.support.sales_session import (
    STEP_AWAITING_ORDER_CONFIRM,
    STEP_AWAITING_QUANTITY,
    STEP_HANDOFF,
    STEP_IDLE,
    merge_sales_session,
    read_session,
)

logger = logging.getLogger(__name__)

_CHIP_LABELS = frozenset(GREETING_CHIP_MENU_CHOICES) | frozenset(STARTER_PAYLOAD_CHOICES)
_ERROR_REPLY_DEDUP_WINDOW = timedelta(seconds=90)


def format_customer_message(text: str | None, *, from_chip: bool = False) -> str:
    """Pass customer input to the model with minimal context — judgment stays with the AI."""
    raw = (text or "").strip()
    if not raw:
        return ""
    product_item_id = parse_product_select_payload(raw)
    if product_item_id:
        return f"[Customer tapped a catalogue product] inventory_item_id={product_item_id}"
    if from_chip or raw in _CHIP_LABELS:
        return f"[Quick-reply selected] {raw}"
    return raw


_DEFAULT_OPENING_LINE = (
    "Introduce yourself as DukAI and welcome them to the shop in a warm, natural way "
    "that matches how the customer greeted you."
)


def _merchant_instructions_block(script: dict[str, str]) -> str:
    parts: list[str] = []
    tone = (script.get("tone") or "").strip()
    if tone:
        parts.append(f"Tone: {tone}.")
    opening = (script.get("opening_line") or "").strip()
    guidelines = (script.get("response_guidelines") or "").strip()
    payment_rule = (script.get("payment_rule_line") or "").strip()
    default_payment = (
        "Do not handle payment or post-placement processing — the shop sends those automatically."
    )
    if opening and opening != _DEFAULT_OPENING_LINE:
        parts.append(opening)
    if guidelines:
        parts.append(guidelines)
    if payment_rule and payment_rule != default_payment:
        parts.append(payment_rule)
    if not parts:
        return ""
    return "Merchant instructions:\n" + "\n\n".join(parts) + "\n\n"


def build_system_prompt(account: InstagramAccount, *, db: Session | None = None) -> str:
    script = merchant_script(account)
    shop_name = resolve_shop_display_name(account, db)
    instructions_block = _merchant_instructions_block(script)
    return (
        f"You are DukAI, the sales assistant agent for {shop_name}.\n"
        f"{instructions_block}"
        "Mission:\n"
        "- Help the customer choose a product or service and place an order. "
        "Every helpful reply should move toward a clear next step (pick an option, "
        "see photos, confirm quantity, or place the order).\n"
        "- Do NOT end turns with dead-end lines like \"let me know if you need anything\" "
        "or \"feel free to ask\" — ask a concrete closing question instead.\n"
        "\n"
        "Rules:\n"
        "- Your name is DukAI. Customer-facing role title: \"sales assistant agent\" "
        "(not \"AI sales assistant for … on Instagram DM\").\n"
        "- Your scope ends at order placement and early amendments. You help with greetings, "
        "discovery, recommendations, objections, placing orders (start_order → confirm_order), "
        "and changing quantity on an open order via amend_order when allowed. "
        "Payment, M-PESA, Pay now links, and fulfillment updates are handled automatically "
        "by the shop after placement — never initiate those yourself or ask for phone numbers "
        "for payment.\n"
        "- Sales playbook:\n"
        "  1) Uncover the need (what they want, budget, occasion) in one short question if unclear.\n"
        "  2) Recommend 1–3 options with a brief why (use recommend_products or search_products).\n"
        "  3) Handle objections with tool facts only — price, stock, description, alternatives.\n"
        "  4) Ask clearly to order or book (\"Want me to place this for you?\" / "
        "\"Shall I book it?\").\n"
        "- Soft urgency only when true: mention low stock or store pause from live context "
        "or tools — never invent scarcity, discounts, or wait times.\n"
        "- Services are sellable catalogue items like products. Use the same tools; "
        "say \"book\" when product_type is service, otherwise \"order\".\n"
        "- If the store is paused / not accepting orders, say so honestly and help with "
        "enquiries or tracking instead of start_order.\n"
        "- Quantity changes on an existing order:\n"
        "  • If live context shows an active order and the customer wants a different quantity "
        "(e.g. \"I want 5 instead\" or \"2 more\"), call amend_order with the new total "
        "quantity (for \"2 more\" on a qty-1 order, amend to 3) — do NOT silently start a new order.\n"
        "  • amend_order only works while status is placed or awaiting_payment.\n"
        "  • If amend_order returns not_amendable (e.g. being prepared): explain honestly that "
        "the order is already in progress. Offer to place a new order for the extra pieces "
        "and/or escalate_to_human. Never claim the existing order was updated.\n"
        "  • Always tell the customer the real tool error (insufficient_stock, store_paused, "
        "not_amendable, placement_failed) — never a vague \"there was an issue\".\n"
        "- Greetings and small talk (hello, hi, wagwan, habari, uko aje, sasa, etc.):\n"
        "  • Match the customer's language and tone — English, Swahili, slang, or mixed is fine.\n"
        "  • If they ask how you are, answer briefly and warmly before offering help.\n"
        "  • On the first message in a thread, introduce yourself as DukAI and welcome them "
        f"to {shop_name}.\n"
        "  • Do NOT repeat the same canned English intro on every greeting — vary wording "
        "and mirror how they greeted you.\n"
        "  • If you already introduced yourself in this conversation, skip the full intro "
        "and respond naturally.\n"
        "  • Then briefly ask how you can help (products, services, orders, delivery). "
        "Do NOT mention payment, M-PESA, phone numbers, or checkout.\n"
        "- Before placing: use start_order once to prepare, then ask the customer to confirm the summary.\n"
        "- When the customer confirms (yes, ok, sure, ndio, sawa, etc.) call confirm_order immediately. "
        "Never call start_order again for the same pending order.\n"
        "- If confirm_order fails, retry confirm_order or apologize briefly — do NOT ask the customer "
        "to confirm again.\n"
        "- start_order: prefer inventory_item_id from catalogue taps, session, or available_products. "
        "Always pass the customer's stated quantity (never default to 1 when they said 2+). "
        "If they say \"2 pens\" / \"two\" / \"mbili\", quantity must be 2. "
        "If the customer gives a number (e.g. \"1\") after viewing the catalogue, that is the list "
        "position — not the quantity. Ask which product if unclear.\n"
        "- If start_order returns product_not_found or no_products_listed, only mention products "
        "from available_products in the tool result — never invent names.\n"
        "- After confirm_order succeeds: give the order reference and total, and say the shop "
        "will follow up with next steps. Do NOT ask for phone numbers or payment details.\n"
        "- Interpret every message yourself — quick-reply buttons, menu numbers (1/2/3), "
        "and free-text. Decide the best next step from context.\n"
        "- Always use tools for product prices, stock, and orders. Never invent prices or stock levels.\n"
        "- Product discovery:\n"
        "  • Vague requests or \"what do you recommend\" → call recommend_products "
        "(or search_products / send_product_catalog with query), then suggest 2–4 options with why.\n"
        "  • Never guess a single product when several could match — ask the customer to choose.\n"
        "  • start_order needs inventory_item_id once the customer picks a specific product.\n"
        "  • Mention category, price, and a short benefit when suggesting options.\n"
        "- Shop facts (location, open/paused, delivery rate): use live context or get_shop_info — "
        "never invent addresses or fees.\n"
        "- Product photos:\n"
        "  • When the customer asks to see photos/pictures of a specific product "
        "(e.g. \"can I see photos?\", \"show me pictures of it\") and you already discussed one, "
        "call send_product_photos with that product's inventory_item_id from search results or session.\n"
        "  • Never use send_product_catalog for photo requests about one product — that shows "
        "unrelated items.\n"
        "  • send_product_catalog is only for browsing multiple products.\n"
        "- Keep replies short and friendly (2-4 sentences). English and Swahili are both fine.\n"
        "- Voice: write like a real shop attendant on Instagram DMs — warm and direct, not a "
        "call-centre script. Avoid stiff phrases like \"Certainly!\", \"I'd be happy to\", "
        "\"sent over our product catalog\", or \"Please don't hesitate\".\n"
        "- To show products visually, call send_product_catalog (pass query when filtering). "
        "That tool sends the carousel for you — stay silent afterward. Never say you sent a "
        "catalogue unless catalog_sent is true in the tool result.\n"
        "- To send photos of one product the customer asked about, call send_product_photos — "
        "stay silent afterward when photos_sent is true.\n"
        "- track_order, get_customer_orders, get_order_by_number, and amend_order: use for "
        "order status, history, and quantity changes. Live context may already list an "
        "active order — mention it proactively.\n"
        "- get_inventory_summary: broad stock and category overview. recommend_products / "
        "search_products / list_products for specific items. get_product_details for full info.\n"
        "- Escalate to a human only when the customer clearly wants one or you cannot resolve their need.\n"
        "- Do not mention tools or function calls to the customer."
    )


class DmAgentService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        instagram_api,
    ):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api
        self.tools = DmAgentTools(db, settings, instagram_api)
        self.support_tickets = SupportTicketService(db)

    def _agent_settings(self) -> Settings:
        return effective_agent_settings(self.settings, self.db)

    def is_available(self) -> bool:
        agent = self._agent_settings()
        return bool(agent.dm_agent_enabled) and chat_provider_available(agent)

    def process_inbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        *,
        from_chip: bool = False,
        webhook_event: dict | None = None,
    ) -> bool:
        if not self.is_available():
            if platform_bot_is_ai_agent(self.db):
                signal_agent_typing(
                    account,
                    conversation,
                    settings=self.settings,
                    instagram_api=self.instagram_api,
                    duration_seconds=1.5,
                )
                self._send_outbound(
                    account,
                    conversation,
                    (
                        "The AI sales agent is not configured yet. "
                        "Ask your platform admin to enable the DM agent and add an LLM API key."
                    ),
                )
                message.auto_replied = True
                self.db.commit()
                return True
            return False
        if not supports_dm_bot(account):
            return False
        if not message.is_inbound() or message.auto_replied:
            return False
        if not channel_auto_replies_active(self.db, account):
            return False
        if not conversation.is_ticket_open():
            return False

        session = read_session(conversation.sales_session)
        if session.get("step") == STEP_HANDOFF or conversation_live_agent_handoff(conversation):
            self.db.commit()
            return True

        ticket = self.support_tickets.get_current_ticket(conversation)
        if ticket is not None and ticket.is_open():
            self.support_tickets.record_customer_reply(ticket)

        product_item_id = parse_product_select_payload(message.body)
        if product_item_id:
            from app.services.catalog.catalog_types import normalize_ref, platform_inventory_item_id

            item_ref = normalize_ref(product_item_id)
            merge_sales_session(
                conversation,
                catalog_pending_item_ref=item_ref,
                catalog_pending_item_id=platform_inventory_item_id(item_ref),
                step=STEP_AWAITING_QUANTITY,
            )
            self.db.flush()

        quantity_from_chip = parse_quantity_payload(message.body)
        if quantity_from_chip is not None:
            merge_sales_session(
                conversation,
                catalog_pending_quantity=quantity_from_chip,
            )
            self.db.flush()
        else:
            # Free-text qty ("2", "two pens", "I want 3") — chips only cover
            # structured payloads, so without this start_order often stays at 1.
            free_qty = parse_quantity(message.body)
            if free_qty is not None:
                merge_sales_session(
                    conversation,
                    catalog_pending_quantity=free_qty,
                )
                self.db.flush()

        text = format_customer_message(message.body, from_chip=from_chip)
        session = read_session(conversation.sales_session)

        if self._handle_deterministic_product_pick(
            account,
            conversation,
            message,
            session,
            raw_text=(message.body or "").strip(),
        ):
            return True

        if self._handle_deterministic_order_confirm(
            account,
            conversation,
            message,
            session,
            raw_text=(message.body or "").strip(),
        ):
            return True

        outbound_before = sum(
            1 for row in conversation.messages if row.direction == "outbound"
        )

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=3.0,
        )
        try:
            reply = self._run_agent_loop(
                account,
                conversation,
                message,
                text,
                from_chip=from_chip,
            )
        except (DmChatDisabled, DmChatError) as exc:
            logger.warning("DM agent unavailable: %s", exc)
            signal_agent_typing(
                    account,
                    conversation,
                    settings=self.settings,
                    instagram_api=self.instagram_api,
                    duration_seconds=1.5,
                )
            error_text = user_facing_agent_error(exc)
            if self._should_send_error_reply(conversation, error_text):
                self._send_outbound(
                    account,
                    conversation,
                    error_text,
                )
            message.auto_replied = True
            self.db.commit()
            return True

        outbound_after = sum(
            1 for row in conversation.messages if row.direction == "outbound"
        )
        if outbound_after > outbound_before:
            if (reply or "").strip():
                logger.info(
                    "DM agent suppressed duplicate reply conversation=%s outbound_added=%s",
                    conversation.id,
                    outbound_after - outbound_before,
                )
            message.auto_replied = True
            self.db.commit()
            return True

        if reply:
            self._send_outbound(account, conversation, reply)
        message.auto_replied = True
        self.db.commit()
        return True

    def _recent_customer_texts(
        self,
        conversation: InstagramConversation,
        *,
        limit: int = 6,
    ) -> list[str]:
        rows = sorted(
            conversation.messages,
            key=lambda row: row.sent_at or row.created_at,
        )
        texts: list[str] = []
        for row in reversed(rows):
            if not row.is_inbound():
                continue
            body = (row.body or "").strip()
            if body:
                texts.append(body)
            if len(texts) >= limit:
                break
        return list(reversed(texts))

    def _resolve_pending_item_id(
        self,
        conversation: InstagramConversation,
        session: dict[str, Any],
    ) -> str:
        return resolve_pending_order_item_id(
            session,
            recent_customer_messages=self._recent_customer_texts(conversation),
        )

    def _handle_deterministic_product_pick(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        session: dict[str, Any],
        *,
        raw_text: str,
    ) -> bool:
        """Start an order when the customer picks option 1/2/3 from suggestions."""
        if is_order_confirm_yes(raw_text) or is_order_confirm_no(raw_text):
            return False

        pick_index = parse_suggestion_pick(raw_text)
        if pick_index is None:
            return False

        suggested = session.get("last_suggested_item_refs") or session.get("last_suggested_item_ids") or []
        if not isinstance(suggested, list) or not (1 <= pick_index <= len(suggested)):
            return False

        item_ref = str(suggested[pick_index - 1])
        pending_qty = max(1, int(session.get("catalog_pending_quantity") or 1))
        signal_agent_typing(
                    account,
                    conversation,
                    settings=self.settings,
                    instagram_api=self.instagram_api,
                    duration_seconds=1.5,
                )
        result = self.tools.execute(
            "start_order",
            {"catalog_item_ref": item_ref, "quantity": pending_qty},
            account=account,
            conversation=conversation,
            message=message,
        )
        if not result.get("ok"):
            return False

        reply = format_order_confirm_prompt(
            str(result.get("product_name") or "your item"),
            int(result.get("unit_price_kes") or 0),
            int(result.get("quantity") or 1),
        )
        self._send_outbound(account, conversation, reply)
        message.auto_replied = True
        self.db.commit()
        return True

    def _ensure_order_ready_for_confirm(
        self,
        conversation: InstagramConversation,
        session: dict[str, Any],
    ) -> str:
        pending_item_id = self._resolve_pending_item_id(conversation, session)
        if not pending_item_id:
            return ""

        if (
            session.get("step") == STEP_AWAITING_ORDER_CONFIRM
            and str(session.get("catalog_pending_item_id") or "") == pending_item_id
        ):
            return pending_item_id

        merge_sales_session(
            conversation,
            catalog_pending_item_id=pending_item_id,
            catalog_pending_quantity=max(1, int(session.get("catalog_pending_quantity") or 1)),
            last_discussed_item_id=pending_item_id,
            step=STEP_AWAITING_ORDER_CONFIRM,
        )
        self.db.flush()
        return pending_item_id

    def _handle_deterministic_order_confirm(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        session: dict[str, Any],
        *,
        raw_text: str,
    ) -> bool:
        """Place or decline pending orders without an LLM round-trip."""
        pending_item_id = self._resolve_pending_item_id(conversation, session)
        if not pending_item_id:
            return False

        if is_order_confirm_no(raw_text):
            merge_sales_session(
                conversation,
                step=STEP_IDLE,
                catalog_pending_item_id=None,
                catalog_pending_quantity=None,
                customer_order_confirmed=None,
            )
            signal_agent_typing(
                    account,
                    conversation,
                    settings=self.settings,
                    instagram_api=self.instagram_api,
                    duration_seconds=1.5,
                )
            self._send_outbound(account, conversation, format_order_declined_message())
            message.auto_replied = True
            self.db.commit()
            return True

        if not is_order_confirm_yes(raw_text):
            return False

        if not self._ensure_order_ready_for_confirm(conversation, session):
            return False

        merge_sales_session(conversation, customer_order_confirmed=True)
        self.db.flush()

        outbound_before = sum(
            1 for row in conversation.messages if row.direction == "outbound"
        )
        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        result = self.tools.execute(
            "confirm_order",
            {},
            account=account,
            conversation=conversation,
            message=message,
        )
        if result.get("ok"):
            merge_sales_session(conversation, customer_order_confirmed=None)
            self.db.flush()
        elif result.get("error") == "placement_failed":
            merge_sales_session(conversation, customer_order_confirmed=True)
            self.db.flush()

        outbound_after = sum(
            1 for row in conversation.messages if row.direction == "outbound"
        )
        reply = self._reply_for_confirm_order_result(result)
        if reply and outbound_after <= outbound_before:
            self._send_outbound(account, conversation, reply)
        message.auto_replied = True
        self.db.commit()
        return True

    @staticmethod
    def _reply_for_confirm_order_result(result: dict[str, Any]) -> str | None:
        if result.get("ok"):
            if result.get("customer_notified"):
                return None
            return format_order_placed_message(
                str(result.get("order_number") or ""),
                str(result.get("product_name") or "your item"),
                int(result.get("total_kes") or 0),
            )
        error = str(result.get("error") or "")
        if error == "insufficient_stock":
            available = int(result.get("available") or 0)
            product = str(result.get("product_name") or "that item")
            return (
                f"Sorry — we only have {available} of {product} left in stock. "
                "Tell me a smaller quantity or pick another product."
            )
        if error == "product_unavailable":
            return "Sorry — that item is no longer available. What else can I help you find?"
        if error in {"placement_failed", "no_pending_order"}:
            return (
                "Thanks for confirming your order. We're placing it now — "
                "our team will message you shortly with your order reference."
            )
        return None

    def _run_agent_loop(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        customer_text: str,
        *,
        from_chip: bool = False,
    ) -> str:
        history = self._conversation_history(
            conversation,
            customer_text,
            from_chip=from_chip,
        )
        system_prompt = build_system_prompt(account, db=self.db)
        context_block = build_conversation_context(
            self.db,
            account,
            conversation,
            orders=self.tools.orders,
            catalog=self.tools.catalog,
        )
        if context_block:
            system_prompt = f"{system_prompt}\n\n{context_block}"
        messages: list[ChatMessage] = [
            ChatMessage(role="system", content=system_prompt),
            *history,
        ]
        max_rounds = max(1, int(self.settings.dm_agent_max_tool_rounds))
        suppress_reply = False
        agent = self._agent_settings()

        for _ in range(max_rounds):
            completion = chat_completion(agent, messages, AGENT_TOOL_DEFINITIONS)
            if completion.tool_calls:
                assistant_tool_calls = []
                for call in completion.tool_calls:
                    assistant_tool_calls.append(
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.arguments),
                            },
                        },
                    )
                messages.append(
                    ChatMessage(
                        role="assistant",
                        content=completion.content or "",
                        tool_calls=assistant_tool_calls,
                    ),
                )
                for call in completion.tool_calls:
                    result = self.tools.execute(
                        call.name,
                        call.arguments,
                        account=account,
                        conversation=conversation,
                        message=message,
                    )
                    if call.name == "send_product_catalog" and (
                        result.get("catalog_sent")
                        or result.get("empty_store")
                        or result.get("no_matches")
                    ):
                        suppress_reply = True
                    if call.name == "send_product_photos" and (
                        result.get("photos_sent") or result.get("no_images")
                    ):
                        suppress_reply = True
                    if result.get("handoff"):
                        return format_live_agent_reply()
                    messages.append(
                        ChatMessage(
                            role="tool",
                            name=call.name,
                            tool_call_id=call.id,
                            content=json.dumps(result),
                        ),
                    )
                if suppress_reply:
                    return ""
                continue

            if completion.content and completion.content.strip():
                return completion.content.strip()

        if suppress_reply:
            return ""

        completion = chat_completion(agent, messages, [])
        if completion.content and completion.content.strip():
            return completion.content.strip()
        shop_name = resolve_shop_display_name(account, self.db)
        return (
            f"Hey — I'm DukAI from {shop_name}. What can I help you find today?"
        )

    def _conversation_history(
        self,
        conversation: InstagramConversation,
        current_text: str,
        *,
        from_chip: bool = False,
    ) -> list[ChatMessage]:
        limit = max(4, int(self.settings.dm_agent_max_history))
        rows = sorted(
            conversation.messages,
            key=lambda row: row.sent_at or row.created_at,
        )
        chat: list[ChatMessage] = []
        for row in rows[-limit:]:
            body = (row.body or "").strip()
            if not body or body.startswith("[product_"):
                continue
            role = "user" if row.is_inbound() else "assistant"
            if role == "user":
                body = format_customer_message(body, from_chip=body in _CHIP_LABELS)
            chat.append(ChatMessage(role=role, content=body))
        if not chat or chat[-1].role != "user" or chat[-1].content != current_text:
            chat.append(ChatMessage(role="user", content=current_text))
        return chat

    def resume_autopilot_after_handoff(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        *,
        notify_customer: bool = True,
    ) -> bool:
        from app.services.agent_reply_policy import (
            auto_replies_handle_inbound,
            conversation_live_agent_handoff,
        )
        from app.support.sales_session import STEP_IDLE, merge_sales_session

        if not conversation_live_agent_handoff(conversation):
            return False

        merge_sales_session(conversation, step=STEP_IDLE)

        ticket = self.support_tickets.get_current_ticket(conversation)
        if ticket is not None:
            self.support_tickets.log_event(
                ticket,
                "autopilot_resumed",
                "Customer returned to DukAI auto-replies",
            )

        should_notify = notify_customer and auto_replies_handle_inbound(self.db, account)
        if should_notify and conversation.participant_ig_id:
            signal_agent_typing(
                account,
                conversation,
                settings=self.settings,
                instagram_api=self.instagram_api,
                duration_seconds=2.0,
            )
            self._send_outbound(
                account,
                conversation,
                "You're back with DukAI. How can I help you today?",
            )

        self.db.commit()
        return True

    def resume_all_handoff_conversations(self, account: InstagramAccount) -> int:
        conversations = (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.instagram_account_id == account.id)
            .all()
        )
        resumed = 0
        for conversation in conversations:
            if self.resume_autopilot_after_handoff(account, conversation):
                resumed += 1
        return resumed

    def _send_outbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        text: str,
        *,
        quick_replies: list[dict[str, str]] | None = None,
    ) -> None:
        from app.services.messaging_service import InstagramOutboundService

        recipient_id = str(conversation.participant_ig_id or "")
        if not recipient_id:
            return

        outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
        outbound_id = outbound.send_text(
            account,
            recipient_id,
            text,
            quick_replies=quick_replies,
            conversation_id=conversation.id,
        )
        now = utc_now()
        self.db.add(
            InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=outbound_id,
                direction="outbound",
                sender_ig_id=account.instagram_user_id,
                sender_username=account.username,
                body=text,
                sent_at=now,
                auto_replied=False,
                created_at=now,
                updated_at=now,
            ),
        )

    def _should_send_error_reply(self, conversation: InstagramConversation, error_text: str) -> bool:
        normalized_error = (error_text or "").strip()
        if not normalized_error:
            return False
        now = utc_now()
        outbound_rows = [
            row
            for row in conversation.messages
            if row.direction == "outbound" and (row.body or "").strip() == normalized_error
        ]
        if not outbound_rows:
            return True
        latest = max(outbound_rows, key=lambda row: row.sent_at or row.created_at or now)
        latest_timestamp = latest.sent_at or latest.created_at
        if latest_timestamp is None:
            return True
        return now - latest_timestamp >= _ERROR_REPLY_DEDUP_WINDOW
