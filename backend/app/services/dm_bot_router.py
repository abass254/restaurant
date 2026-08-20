"""Route inbound DMs to the AI sales agent."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.dm_bot_registry import DEFAULT_DM_BOT
from app.services.dm_postback import ingest_postback_message, synthetic_body_from_postback_event
from app.services.platform_instagram import channel_auto_replies_active


class DmBotRouter:
    """Dispatch post-greeting DMs to the AI sales agent."""

    def __init__(
        self,
        db: Session,
        settings: Settings,
        dm_agent,
        *,
        dm_tickets=None,
    ):
        self.db = db
        self.settings = settings
        self.dm_agent = dm_agent
        self.dm_tickets = dm_tickets

    def selected_bot(self) -> str:
        return DEFAULT_DM_BOT

    def uses_ai_agent(self) -> bool:
        return True

    def is_available(self) -> bool:
        # Route to the AI handler even when the LLM is not configured — it
        # replies with a setup message instead of falling back to menu chips.
        return True

    def process_inbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        *,
        from_chip: bool = False,
        webhook_event: dict | None = None,
    ) -> bool:
        return self.dm_agent.process_inbound(
            account,
            conversation,
            message,
            from_chip=from_chip,
            webhook_event=webhook_event,
        )

    def handle_postback(self, account: InstagramAccount, event: dict) -> bool:
        """Route Instagram postbacks through the AI sales agent."""
        synthetic = synthetic_body_from_postback_event(event)
        if synthetic is None:
            return False

        ingested = ingest_postback_message(self.db, account, event, synthetic)
        if ingested is None:
            return False

        conversation, message = ingested
        if not channel_auto_replies_active(self.db, account):
            return True

        if self.dm_tickets is not None:
            ticket_open_handled = self.dm_tickets.process_inbound(account, conversation, message)
            if ticket_open_handled:
                message.auto_replied = False
                self.db.commit()
                return self.process_inbound(
                    account,
                    conversation,
                    message,
                    from_chip=True,
                    webhook_event=event,
                )

        return self.process_inbound(
            account,
            conversation,
            message,
            from_chip=True,
            webhook_event=event,
        )

    def send_chips_only_reminder(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        del account, conversation, message
        return
