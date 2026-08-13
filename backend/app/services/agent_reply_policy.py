"""When the bot owns the thread, agents must not send manual ticket replies."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation
from app.support.sales_session import STEP_HANDOFF, read_session


def conversation_live_agent_handoff(conversation: InstagramConversation) -> bool:
    return read_session(conversation.sales_session).get("step") == STEP_HANDOFF


def conversation_free_messaging(conversation: InstagramConversation) -> bool:
    """Customer and merchant may exchange free-text messages (no bot / chips gate)."""
    return conversation_live_agent_handoff(conversation)


def platform_bot_is_ai_agent(db: Session) -> bool:
    from app.services.dm_bot_registry import normalize_dm_bot
    from app.services.platform_messaging_settings import get_platform_dm_bot

    return normalize_dm_bot(get_platform_dm_bot(db)) == "ai_agent"


def platform_uses_ai_agent(db: Session, settings: Settings) -> bool:
    if not platform_bot_is_ai_agent(db):
        return False
    from app.services.dm_chat_provider import chat_provider_available

    return bool(settings.dm_agent_enabled) and chat_provider_available(settings)


def bot_sandbox_allows_free_text(
    conversation: InstagramConversation | None,
    *,
    uses_ai_agent: bool = False,
) -> bool:
    """Bot sandbox preview: free-text when AI agent is selected or in live-agent handoff."""
    if uses_ai_agent:
        return True
    return conversation is not None and conversation_free_messaging(conversation)


def should_send_template_greeting(db: Session, settings: Settings) -> bool:
    """Canned greeting + chip menu — skipped for the AI sales agent."""
    if not settings.instagram_dm_greeting_enabled:
        return False
    return not platform_bot_is_ai_agent(db)


def auto_replies_handle_inbound(db: Session, account: InstagramAccount) -> bool:
    """True when the bot (not a human) is expected to handle customer DMs."""
    from app.services.platform_messaging_settings import auto_responses_paused

    if auto_responses_paused(db):
        return False
    return bool(getattr(account, "auto_replies_enabled", True))


def disable_auto_replies_for_live_agent(account: InstagramAccount) -> bool:
    """Turn off shop auto-replies when a customer enters live-agent handoff."""
    if not getattr(account, "auto_replies_enabled", True):
        return False
    account.auto_replies_enabled = False
    return True


def merchant_unread_count(
    conversation: InstagramConversation,
    inbound_unread: int,
    account: InstagramAccount,
    db: Session,
) -> int:
    """Unread inbound messages that should alert a merchant (badge / sidebar)."""
    if inbound_unread <= 0:
        return 0
    if auto_replies_handle_inbound(db, account) and not conversation_live_agent_handoff(conversation):
        return 0
    return inbound_unread


def conversation_needs_merchant_attention(
    conversation: InstagramConversation,
    inbound_unread: int,
    account: InstagramAccount,
    db: Session,
) -> bool:
    return merchant_unread_count(conversation, inbound_unread, account, db) > 0


def agent_manual_reply_allowed(
    account: InstagramAccount,
    conversation: InstagramConversation,
) -> bool:
    """Agents may reply manually only when auto-replies are off or the customer asked for a human."""
    if not getattr(account, "auto_replies_enabled", True):
        return True
    return conversation_live_agent_handoff(conversation)
