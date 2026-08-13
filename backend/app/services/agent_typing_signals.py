from __future__ import annotations

import logging

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation
from app.services.instagram_api import InstagramApiService
from app.services.messaging_service import InstagramOutboundService
from app.services.typing_state import set_agent_typing

logger = logging.getLogger(__name__)


def signal_agent_typing(
    account: InstagramAccount,
    conversation: InstagramConversation,
    *,
    settings: Settings,
    instagram_api: InstagramApiService,
    duration_seconds: float = 4.0,
) -> None:
    """Show the agent typing indicator in the inbox and on Instagram."""
    set_agent_typing(conversation.id, duration_seconds=duration_seconds)

    recipient_id = str(getattr(conversation, "participant_ig_id", None) or "")
    if not recipient_id or getattr(account, "platform", None) != "instagram":
        return

    try:
        outbound = InstagramOutboundService(settings, instagram_api)
        outbound.send_typing_on(account, recipient_id)
    except Exception as exc:
        logger.warning(
            "Instagram typing_on failed conversation=%s recipient=%s error=%s",
            conversation.id,
            recipient_id,
            exc,
        )
