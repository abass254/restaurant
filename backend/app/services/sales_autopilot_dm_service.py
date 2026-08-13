"""Wire SalesAutopilotService into the DM inbound pipeline."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.agent_reply_policy import conversation_live_agent_handoff
from app.services.platform_instagram import channel_auto_replies_active, supports_dm_bot
from app.services.sales_autopilot_service import CatalogPortfolioItem, SalesAutopilotService
from app.services.support_ticket_service import SupportTicketService
from app.services.agent_typing_signals import signal_agent_typing
from app.support.sales_session import STEP_HANDOFF, read_session


class SalesAutopilotDmService:
    """Process inbound DMs through the rule-based sales autopilot."""

    def __init__(self, db: Session, settings: Settings, instagram_api):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api
        self.support_tickets = SupportTicketService(db)

    def is_available(self) -> bool:
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
        del from_chip, webhook_event

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

        autopilot = SalesAutopilotService(self.db, self.settings)
        reply = autopilot.build_reply(account, conversation, message)
        if reply is None:
            return False

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        if reply.catalog_items:
            intro = (reply.catalog_intro or "Here is our catalogue:").strip()
            if intro:
                self._send_outbound(account, conversation, intro)
            self._send_outbound(
                account,
                conversation,
                self._catalog_text(reply.catalog_items),
            )
        if reply.text.strip():
            self._send_outbound(account, conversation, reply.text.strip())

        message.auto_replied = True
        self.db.commit()
        return True

    @staticmethod
    def _catalog_text(items: list[CatalogPortfolioItem]) -> str:
        lines = [
            f"{item.index}. {item.name} — KES {item.price_kes}"
            for item in items
        ]
        return "\n".join(lines)

    def _send_outbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        text: str,
    ) -> None:
        from datetime import timezone

        from app.services.messaging_service import InstagramOutboundService
        from app.support.datetime_utils import utc_now

        recipient_id = str(conversation.participant_ig_id or "")
        if not recipient_id or not text.strip():
            return

        outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
        outbound_id = outbound.send_text(account, recipient_id, text, conversation_id=conversation.id)
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
        self.db.flush()
