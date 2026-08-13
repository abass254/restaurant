"""Shared Instagram DM copy and placeholder rendering."""

from __future__ import annotations

import re

from app.models import InstagramConversation, InstagramMessage

DEFAULT_GREETING_TRIGGER = "hello"
DEFAULT_GREETING_INTRO = (
    "Hello {username}! Thanks for reaching out. "
    "I'm your AI shopping assistant — I can help you browse products, place an order, "
    "or track a delivery. How can I help you today?"
)
DEFAULT_GREETING_CHIP_PROMPT = "Tap an option below or just type your question."
DEFAULT_GREETING_REPLY = f"{DEFAULT_GREETING_INTRO}\n\n{DEFAULT_GREETING_CHIP_PROMPT}"

MENU_OPTIONS_BODY = (
    "1. Place an order with us\n"
    "2. Enquire about a product or price\n"
    "3. Chat with a live agent"
)

STARTER_PAYLOAD_CHOICES: dict[str, int] = {
    "starter_place_order": 1,
    "starter_product_enquiry": 2,
    "starter_live_agent": 3,
}

GREETING_CHIP_MENU_CHOICES: dict[str, int] = {
    "I'd like to place an order.": 1,
    "I'd like to enquire about your product": 2,
    "I'd like to chat with a live agent.": 3,
}

GREETING_MENU_CHIP_TEXTS: tuple[str, ...] = (
    "I'd like to place an order.",
    "I'd like to enquire about your product",
    "I'd like to chat with a live agent.",
)

MENU_BACK_RE = re.compile(r"^(menu|main menu|back|home|start|0)\b", re.IGNORECASE)
MENU_CHOICE_RE = re.compile(r"^\s*([123])\s*$")


def greeting_menu_options() -> str:
    return MENU_OPTIONS_BODY


def greeting_was_sent(conversation: InstagramConversation | None) -> bool:
    if conversation is None:
        return False
    session = conversation.sales_session or {}
    if isinstance(session, dict) and session.get("menu_sent"):
        return True
    for existing in conversation.messages:
        if existing.direction != "outbound":
            continue
        body = (existing.body or "").strip()
        if "How can we assist you today?" in body:
            return True
        if "How can I help you today?" in body:
            return True
        if "AI shopping assistant" in body:
            return True
        if "Thanks so much for reaching out" in body:
            return True
    return False


def format_menu_reminder(
    conversation: InstagramConversation | None = None,
    message: InstagramMessage | None = None,
) -> str:
    """Re-send menu options when the customer texts outside the menu context."""
    del conversation, message
    return "Please choose one of the options below."


def menu_choice_from_text(text: str | None) -> int | None:
    raw = (text or "").strip()
    if not raw:
        return None
    if raw in STARTER_PAYLOAD_CHOICES:
        return STARTER_PAYLOAD_CHOICES[raw]
    if raw in GREETING_CHIP_MENU_CHOICES:
        return GREETING_CHIP_MENU_CHOICES[raw]
    match = MENU_CHOICE_RE.match(raw)
    if match:
        return int(match.group(1))
    lowered = raw.lower()
    if re.match(r"^(one|order|buy|purchase|place)\b", lowered):
        return 1
    if re.match(r"^(two|enquir|inquir|price|product|catalog)\b", lowered):
        return 2
    if re.match(r"^(three|agent|human|support)\b", lowered):
        return 3
    if "place an order" in lowered or "place order" in lowered:
        return 1
    if "enquire" in lowered or "inquire" in lowered or "product or price" in lowered:
        return 2
    if is_live_agent_request(lowered):
        return 3
    return None


def is_live_agent_request(text: str | None) -> bool:
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    if lowered in STARTER_PAYLOAD_CHOICES:
        return STARTER_PAYLOAD_CHOICES[lowered] == 3
    if "live agent" in lowered or "chat with a live agent" in lowered:
        return True
    return bool(re.search(r"\b(human|agent|representative|customer care)\b", lowered))


def greeting_quick_replies() -> list[dict[str, str]]:
    """Tappable chips on the first bot greeting (Meta quick-reply title max ~20 chars)."""
    return [
        {
            "content_type": "text",
            "title": "Place an order",
            "payload": "starter_place_order",
        },
        {
            "content_type": "text",
            "title": "Product enquiry",
            "payload": "starter_product_enquiry",
        },
        {
            "content_type": "text",
            "title": "Live agent",
            "payload": "starter_live_agent",
        },
    ]


def live_agent_quick_replies() -> list[dict[str, str]]:
    return [
        {
            "content_type": "text",
            "title": "Live agent",
            "payload": "starter_live_agent",
        },
    ]


EMPTY_STORE_MESSAGE = (
    "Hey — we're still loading products here, so there's nothing to browse yet. "
    "Check back soon, or say if you'd like to chat with someone on the team."
)


def format_empty_store_message(shop_name: str | None = None) -> str:
    shop = (shop_name or "the shop").strip() or "the shop"
    return (
        f"Hey — we're still loading products for {shop}, so there's nothing to browse yet. "
        "Check back soon, or say if you'd like to chat with someone on the team."
    )


def format_no_catalog_matches_message(query: str) -> str:
    term = (query or "").strip() or "that"
    return (
        f"I looked for \"{term}\" but we don't have anything matching that right now. "
        "Try another word, ask to see everything we stock, or say if you'd like the team."
    )


def format_catalog_follow_up(*, filtered: bool = False, item_count: int = 0) -> str:
    if filtered:
        return (
            "Here are the closest matches — tap one, or tell me which you'd like."
        )
    if item_count == 1:
        return "That's what we have right now — tap it or tell me if you'd like to order."
    return "That's what we've got in stock — tap one or tell me what you'd like."


def format_live_agent_reply() -> str:
    return "You are now chatting with our live agent."


def format_dukai_resume_reply(conversation: InstagramConversation | None = None) -> str:
    del conversation
    return (
        "You're now chatting with DukAI, your helper.\n\n"
        "Tap an option below to continue."
    )


def is_menu_back_request(text: str | None) -> bool:
    return bool(MENU_BACK_RE.match((text or "").strip()))


def menu_back_quick_replies() -> list[dict[str, str]]:
    return [
        {
            "content_type": "text",
            "title": "Main menu",
            "payload": "menu",
        },
    ]


ORDER_CONFIRM_YES_RE = re.compile(
    r"^(yes|y|yeah|yep|ok|okay|sure|confirm|1|ndio|sawa|order_yes)\b",
    re.IGNORECASE,
)
ORDER_CONFIRM_NO_RE = re.compile(
    r"^(no|n|nope|cancel|2|hapana|order_no|not now|maybe later)\b",
    re.IGNORECASE,
)


def is_order_confirm_yes(text: str | None) -> bool:
    raw = (text or "").strip().lower()
    if raw in {"order_yes", "yes, place order"}:
        return True
    if raw.startswith(("yes", "yeah", "yep", "ok", "okay", "sure", "confirm", "ndio", "sawa")):
        return True
    return bool(ORDER_CONFIRM_YES_RE.match(raw))


def is_order_confirm_no(text: str | None) -> bool:
    raw = (text or "").strip().lower()
    if raw in {"order_no", "no thanks"}:
        return True
    if raw.startswith(("no", "nope", "cancel", "hapana", "not now", "maybe later")):
        return True
    return bool(ORDER_CONFIRM_NO_RE.match(raw))


def format_order_confirm_prompt(
    product_name: str,
    price_kes: int,
    quantity: int = 1,
) -> str:
    qty = max(1, quantity)
    total = price_kes * qty
    if qty > 1:
        summary = f"**{qty} × {product_name}**"
    else:
        summary = f"**{product_name}**"
    return (
        f"{summary}\n\n"
        f"Total is **KES {total:,}**. Proceed with order?\n\n"
        "Tap **Yes** or **No** below."
    )


def format_quantity_prompt(
    product_name: str,
    price_kes: int,
    *,
    unit: str | None = None,
) -> str:
    unit_hint = f" per {unit.strip()}" if unit and unit.strip() else ""
    return (
        f"**{product_name}** — KES {price_kes:,}{unit_hint}.\n\n"
        "How many would you like? Tap a number below."
    )


def format_quantity_retry_message(*, max_available: int | None = None) -> str:
    if max_available is not None and max_available > 0:
        return (
            f"We only have **{max_available}** available right now. "
            "Please reply with a smaller quantity."
        )
    return "Please reply with how many you want (for example **1**, **2**, or **3**)."


def order_confirm_quick_replies() -> list[dict[str, str]]:
    return [
        {
            "content_type": "text",
            "title": "Yes",
            "payload": "order_yes",
        },
        {
            "content_type": "text",
            "title": "No",
            "payload": "order_no",
        },
    ]


def format_order_placed_message(order_number: str, product_name: str, total_kes: int) -> str:
    return (
        "Thank you for your order.\n\n"
        f"Your order reference is **{order_number}**.\n"
        f"Item: {product_name}\n"
        f"Total: KES {total_kes:,}\n\n"
        "Our team will follow up shortly regarding payment and delivery."
    )


def format_order_declined_message() -> str:
    return "No problem — pick another product from the catalogue, or tap **Main menu** to start over."


def format_root_menu() -> str:
    return "How can we assist you today? Tap an option below to continue."


def format_catalog_footer(choice: int) -> str:
    if choice == 1:
        return "Tap a product below to continue."
    return "Tap a product below or ask your question."

DEFAULT_TICKET_CLOSE_MESSAGE = (
    "We haven't heard back from you, so we'll go ahead and close this chat for now.\n\n"
    "If you still need help, just send us another message anytime — "
    "we'll be happy to pick things up right where we left off."
)

DEFAULT_AGENT_TICKET_CLOSED_MESSAGE = (
    "This support ticket has been closed.\n\n"
    "If you still need help, just send a new message and we will reopen the chat."
)

DEFAULT_HOLD_REPLY = "lets wait for further instruction"


def is_completion_confirm_yes(text: str | None) -> bool:
    raw = (text or "").strip().lower()
    if raw in {"delivery_yes", "yes, received"}:
        return True
    return is_order_confirm_yes(text)


def is_completion_confirm_no(text: str | None) -> bool:
    raw = (text or "").strip().lower()
    if raw in {"delivery_no", "no, issue"}:
        return True
    return is_order_confirm_no(text)


def is_ticket_close_message(text: str | None) -> bool:
    return (text or "").strip() == DEFAULT_TICKET_CLOSE_MESSAGE.strip()

_PLACEHOLDER_RE = re.compile(r"\{(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\}")


def render_reply_text(
    template: str,
    conversation: InstagramConversation | None,
    message: InstagramMessage | None,
) -> str:
    raw_username = ""
    if conversation is not None:
        raw_username = (conversation.participant_username or "").strip().lstrip("@")
    if not raw_username and message is not None:
        raw_username = (message.sender_username or "").strip().lstrip("@")

    values = {
        "username": f"@{raw_username}" if raw_username else "there",
        "menu_options": greeting_menu_options(),
    }

    def _replace(match: "re.Match[str]") -> str:
        return values.get(match.group("name"), match.group(0))

    return _PLACEHOLDER_RE.sub(_replace, template or "")
