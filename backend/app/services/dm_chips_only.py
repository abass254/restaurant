"""Chip-only DM input — sandbox by default; opt-in for live Instagram via config."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.bot_sandbox_context import is_bot_sandbox_account, is_bot_sandbox_messaging
from app.services.platform_instagram import is_bot_preview_account, supports_dm_bot
from app.services.dm_templates import (
    GREETING_MENU_CHIP_TEXTS,
    greeting_quick_replies,
    greeting_was_sent,
    live_agent_quick_replies,
    menu_back_quick_replies,
    order_confirm_quick_replies,
)
from app.support.sales_session import (
    STEP_AWAITING_COMPLETION_CONFIRM,
    STEP_AWAITING_ORDER_CONFIRM,
    STEP_AWAITING_QUANTITY,
    STEP_HANDOFF,
    STEP_IDLE,
    read_session,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.config import Settings
    from app.models import InstagramAccount, InstagramConversation

PRODUCT_SELECT_PREFIX = "product:"
QUANTITY_PREFIX = "qty:"

GREETING_CHIP_TEXTS = frozenset(GREETING_MENU_CHIP_TEXTS)

CHIP_PAYLOADS = frozenset(
    {
        "starter_place_order",
        "starter_product_enquiry",
        "starter_live_agent",
        "order_yes",
        "order_no",
        "delivery_yes",
        "delivery_no",
        "menu",
    },
)

CHIPS_ONLY_REMINDER = (
    "Please tap one of the buttons below to continue. "
    "Free-text replies aren't accepted in this chat."
)


STARTER_PAYLOAD_TO_SEND_TEXT: dict[str, str] = {
    "starter_place_order": "I'd like to place an order.",
    "starter_product_enquiry": "I'd like to enquire about your product",
    "starter_live_agent": "I'd like to chat with a live agent.",
}


def greeting_sandbox_chips() -> list[dict[str, str]]:
    return [{"label": text, "send_text": text} for text in GREETING_MENU_CHIP_TEXTS]


def sandbox_chip_options(
    conversation: InstagramConversation,
    *,
    product_titles: list[tuple[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Chip buttons for the bot sandbox UI (maps quick-reply payloads to send text)."""
    options: list[dict[str, str]] = []
    for chip in quick_replies_for_conversation(conversation, product_titles=product_titles):
        payload = str(chip.get("payload") or chip.get("title") or "").strip()
        send_text = STARTER_PAYLOAD_TO_SEND_TEXT.get(payload, payload)
        if payload in STARTER_PAYLOAD_TO_SEND_TEXT:
            label = send_text
        else:
            label = str(chip.get("title") or send_text).strip()
        options.append({"label": label, "send_text": send_text})
    return options


def sandbox_chips_for_account(
    conversation: InstagramConversation | None,
    account: InstagramAccount,
    settings: Settings,
    catalog,
    *,
    uses_ai_agent: bool = False,
) -> list[dict[str, str]]:
    if uses_ai_agent:
        return []
    if conversation is None or not greeting_was_sent(conversation):
        return []

    merchant_id = str(account.account_id or "").strip()
    product_titles: list[tuple[str, str]] | None = None
    session = read_session(conversation.sales_session)
    if session.get("catalog_choice") in (1, 2) and merchant_id:
        items = catalog._load_items(merchant_id)  # noqa: SLF001
        product_titles = [
            (item.id, (item.product.name if item.product else "Product") or "Product")
            for item in items
            if item.product is not None
        ]

    return sandbox_chip_options(conversation, product_titles=product_titles)


def dm_chips_only_active(
    settings: Settings,
    account: InstagramAccount,
    *,
    db: Session | None = None,
) -> bool:
    """True when inbound DMs must come from chips (not free text).

    Live Instagram: follows the shop auto-reply toggle (and platform pause).
    Bot preview / sandbox: chip-only for menu/autopilot bots only — the AI
    sales agent accepts free-text messages.
    """
    del settings
    if db is not None:
        from app.services.agent_reply_policy import platform_bot_is_ai_agent

        if platform_bot_is_ai_agent(db):
            return False
    if is_bot_sandbox_messaging() or is_bot_sandbox_account(account):
        return True
    if not supports_dm_bot(account):
        return False
    if db is not None:
        from app.services.agent_reply_policy import auto_replies_handle_inbound

        return auto_replies_handle_inbound(db, account)
    return bool(getattr(account, "auto_replies_enabled", True))


def dm_offer_quick_replies(
    settings: Settings,
    account: InstagramAccount,
    *,
    db: Session | None = None,
) -> bool:
    """True when outbound autopilot messages should include tappable chips."""
    if db is not None:
        from app.services.agent_reply_policy import platform_bot_is_ai_agent

        if platform_bot_is_ai_agent(db):
            return False
    if dm_chips_only_active(settings, account, db=db):
        return True
    if is_bot_preview_account(account):
        return True
    if not supports_dm_bot(account):
        return False
    return bool(getattr(account, "auto_replies_enabled", True))


def product_titles_for_catalog(catalog, merchant_id: str) -> list[tuple[str, str]]:
    items = catalog._load_items(merchant_id)  # noqa: SLF001
    return [
        (item.id, (item.product.name if item.product else "Product") or "Product")
        for item in items
        if item.product is not None
    ]


def outbound_quick_replies(
    settings: Settings,
    account: InstagramAccount,
    conversation: InstagramConversation,
    *,
    catalog=None,
    db: Session | None = None,
) -> list[dict[str, str]] | None:
    """Context-aware chips for the current autopilot step (menu, catalog, qty, etc.)."""
    if not dm_offer_quick_replies(settings, account, db=db):
        return None

    merchant_id = str(account.account_id or "").strip()
    product_titles: list[tuple[str, str]] | None = None
    session = read_session(conversation.sales_session)
    if session.get("catalog_choice") in (1, 2) and merchant_id and catalog is not None:
        product_titles = product_titles_for_catalog(catalog, merchant_id)

    return quick_replies_for_conversation(conversation, product_titles=product_titles)


def order_confirm_quick_replies_with_menu_back() -> list[dict[str, str]]:
    chips = order_confirm_quick_replies()
    chips.extend(menu_back_quick_replies())
    return chips[:13]


def completion_confirm_quick_replies_with_menu_back() -> list[dict[str, str]]:
    from app.services.order_dm_templates import completion_confirm_quick_replies

    chips = completion_confirm_quick_replies()
    chips.extend(menu_back_quick_replies())
    return chips[:13]


def is_chip_sourced_inbound(
    *,
    body: str | None,
    event: dict | None = None,
    from_chip: bool = False,
) -> bool:
    if from_chip:
        return True
    if event:
        message = event.get("message") or {}
        if isinstance(message.get("quick_reply"), dict):
            return True
    raw = (body or "").strip()
    if not raw:
        return False
    if raw in GREETING_CHIP_TEXTS:
        return True
    if raw.lower() in CHIP_PAYLOADS:
        return True
    if raw.startswith("[tapped]"):
        return True
    if raw.startswith(PRODUCT_SELECT_PREFIX) or raw.startswith(QUANTITY_PREFIX):
        return True
    if raw in {"1", "2", "3"}:
        # Quick-reply taps are normalised to menu digits in the webhook layer.
        return True
    if raw in {"order_yes", "order_no", "delivery_yes", "delivery_no", "menu"}:
        return True
    return False


def quick_replies_for_conversation(
    conversation: InstagramConversation,
    *,
    product_titles: list[tuple[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Context-aware chip set to re-offer when free text is rejected."""
    session = read_session(conversation.sales_session)
    step = session.get("step")

    if step == STEP_HANDOFF:
        return []

    if step == STEP_AWAITING_ORDER_CONFIRM:
        return order_confirm_quick_replies_with_menu_back()

    if step == STEP_AWAITING_COMPLETION_CONFIRM:
        return completion_confirm_quick_replies_with_menu_back()

    if step == STEP_AWAITING_QUANTITY:
        return quantity_quick_replies()

    if (
        step in (None, STEP_IDLE)
        and session.get("menu_sent")
        and session.get("catalog_choice") not in (1, 2)
    ):
        return greeting_quick_replies()

    if session.get("catalog_choice") in (1, 2) and product_titles:
        return product_select_quick_replies(product_titles)

    if session.get("catalog_choice") in (1, 2) and product_titles is not None and not product_titles:
        return live_agent_quick_replies()

    return greeting_quick_replies()


def product_select_quick_replies(
    items: list[tuple[str, str]],
    *,
    max_items: int = 11,
) -> list[dict[str, str]]:
    """Build product picker chips. Each item is (item_id, display_title)."""
    chips: list[dict[str, str]] = []
    for item_id, title in items[:max_items]:
        label = (title or "Product").strip()
        if len(label) > 20:
            label = label[:19].rstrip() + "…"
        chips.append(
            {
                "content_type": "text",
                "title": label,
                "payload": f"{PRODUCT_SELECT_PREFIX}{item_id}",
            },
        )
    chips.extend(menu_back_quick_replies())
    return chips[:13]


def quantity_quick_replies(*, max_qty: int = 8) -> list[dict[str, str]]:
    chips: list[dict[str, str]] = []
    for qty in range(1, max_qty + 1):
        chips.append(
            {
                "content_type": "text",
                "title": str(qty),
                "payload": f"{QUANTITY_PREFIX}{qty}",
            },
        )
    chips.extend(menu_back_quick_replies())
    return chips[:13]


def parse_product_select_payload(text: str | None) -> str | None:
    raw = (text or "").strip()
    if raw.startswith(PRODUCT_SELECT_PREFIX):
        item_id = raw.removeprefix(PRODUCT_SELECT_PREFIX).strip()
        return item_id or None
    return None


def parse_quantity_payload(text: str | None) -> int | None:
    raw = (text or "").strip()
    if raw.startswith(QUANTITY_PREFIX):
        try:
            return int(raw.removeprefix(QUANTITY_PREFIX).strip())
        except ValueError:
            return None
    return None
