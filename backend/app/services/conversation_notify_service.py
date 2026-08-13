from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.instagram_api import InstagramApiService
from app.services.messaging_service import InstagramOutboundService

logger = logging.getLogger(__name__)


class ConversationNotifyService:
    """Send outbound chat messages tied to a conversation thread."""

    def __init__(self, db: Session, settings: Settings, instagram_api: InstagramApiService | None = None):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api or InstagramApiService(settings)

    def send_to_conversation(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        text: str,
        *,
        quick_replies: list[dict[str, str]] | None = None,
    ) -> bool:
        recipient_id = conversation.participant_ig_id
        if not recipient_id or not (text or "").strip():
            return False

        try:
            outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
            outbound_id = outbound.send_text(
                account,
                recipient_id,
                text.strip(),
                quick_replies=quick_replies,
                conversation_id=conversation.id,
            )
        except Exception as exc:
            logger.warning(
                "Could not send conversation notification account=%s conv=%s: %s",
                account.id,
                conversation.id,
                exc,
            )
            return False

        now = datetime.now(timezone.utc)
        self.db.add(
            InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=outbound_id or f"notify_{uuid.uuid4().hex}",
                direction="outbound",
                sender_ig_id=account.instagram_user_id,
                sender_username=account.username,
                body=text.strip(),
                sent_at=now,
                auto_replied=False,
                created_at=now,
                updated_at=now,
            ),
        )
        conversation.last_message_at = now
        conversation.updated_at = now
        self.db.commit()
        return True

    def send_generic_to_conversation(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        elements: list[dict[str, Any]],
        stored_body: str,
    ) -> bool:
        recipient_id = conversation.participant_ig_id
        if not recipient_id or not elements:
            return False

        try:
            outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
            outbound_id = outbound.send_generic_template(
                account,
                recipient_id,
                elements,
                conversation_id=conversation.id,
            )
        except Exception as exc:
            logger.warning(
                "Could not send generic template account=%s conv=%s: %s",
                account.id,
                conversation.id,
                exc,
            )
            return False

        now = datetime.now(timezone.utc)
        self.db.add(
            InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=outbound_id or f"notify_{uuid.uuid4().hex}",
                direction="outbound",
                sender_ig_id=account.instagram_user_id,
                sender_username=account.username,
                body=stored_body,
                sent_at=now,
                auto_replied=False,
                created_at=now,
                updated_at=now,
            ),
        )
        conversation.last_message_at = now
        conversation.updated_at = now
        self.db.commit()
        return True

    def send_for_order(
        self,
        order_id: str,
        text: str,
    ) -> bool:
        conversation = self._conversation_for_order(order_id)
        if not conversation or not conversation.account:
            return False
        return self.send_to_conversation(conversation.account, conversation, text)

    def send_tracking_card_for_order(self, order_id: str) -> bool:
        from app.models import Order
        from app.services.order_dm_templates import (
            build_tracking_stored_body,
            build_tracking_template_element,
        )
        from app.services.order_tracking_service import OrderTrackingService

        order = self.db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return False

        tracking_url = OrderTrackingService.tracking_url(order.id, self.settings)
        if not tracking_url:
            return False

        conversation = self._conversation_for_order(order_id)
        if not conversation or not conversation.account:
            return False

        element = build_tracking_template_element(order, tracking_url)
        stored_body = build_tracking_stored_body(order, tracking_url)
        return self.send_generic_to_conversation(
            conversation.account,
            conversation,
            [element],
            stored_body,
        )

    def send_payment_card_for_order(self, order_id: str) -> bool:
        from app.models import Order
        from app.services.order_dm_templates import (
            build_payment_stored_body,
            build_payment_template_element,
        )
        from app.services.order_payment_service import OrderPaymentService

        order = self.db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return False

        payment_url = OrderPaymentService.payment_url(order.id, self.settings)
        if not payment_url:
            return False

        conversation = self._conversation_for_order(order_id)
        if not conversation or not conversation.account:
            return False

        element = build_payment_template_element(order, payment_url)
        stored_body = build_payment_stored_body(order, payment_url)
        return self.send_generic_to_conversation(
            conversation.account,
            conversation,
            [element],
            stored_body,
        )

    def _conversation_for_order(self, order_id: str) -> InstagramConversation | None:
        from app.models import Order

        order = (
            self.db.query(Order)
            .filter(Order.id == order_id)
            .first()
        )
        if not order or not order.source_conversation_id:
            return None

        return (
            self.db.query(InstagramConversation)
            .options(joinedload(InstagramConversation.account).joinedload(InstagramAccount.user))
            .filter(InstagramConversation.id == order.source_conversation_id)
            .first()
        )
