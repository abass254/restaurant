from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    DataDeletionRequest,
    InstagramAccount,
    InstagramCommentEvent,
    InstagramConversation,
    Order,
    WebhookEvent,
)
from app.services.instagram_api import InstagramApiService

logger = logging.getLogger(__name__)


class InstagramDataPurgeService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        instagram_api: InstagramApiService,
    ):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def find_accounts_by_meta_user_id(self, meta_user_id: str) -> list[InstagramAccount]:
        user_id = str(meta_user_id or "").strip()
        if not user_id:
            return []

        return (
            self.db.query(InstagramAccount)
            .filter(
                or_(
                    InstagramAccount.instagram_user_id == user_id,
                    InstagramAccount.instagram_scoped_id == user_id,
                    InstagramAccount.instagram_webhook_ig_id == user_id,
                ),
            )
            .all()
        )

    def purge_account(
        self,
        account: InstagramAccount,
        *,
        revoke_webhooks: bool = True,
        source: str = "manual",
    ) -> None:
        self._try_revoke_webhooks(account, revoke_webhooks=revoke_webhooks)
        self._delete_webhook_events_for_account(account)
        self._prepare_account_for_deletion(account)
        self.db.delete(account)
        self.db.flush()
        logger.info(
            "Purged Instagram data account=%s username=%s source=%s",
            account.id,
            account.username,
            source,
        )

    def _prepare_account_for_deletion(self, account: InstagramAccount) -> None:
        """Break FK cycles and remove rows without ORM cascades before account delete."""
        account_id = account.id
        conversation_ids = [
            row[0]
            for row in self.db.query(InstagramConversation.id)
            .filter(InstagramConversation.instagram_account_id == account_id)
            .all()
        ]

        (
            self.db.query(InstagramCommentEvent)
            .filter(InstagramCommentEvent.instagram_account_id == account_id)
            .delete(synchronize_session=False)
        )

        if not conversation_ids:
            return

        # Conversation.current_support_ticket_id <-> SupportTicket.instagram_conversation_id
        # creates a circular dependency during ORM cascade deletes.
        (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.id.in_(conversation_ids))
            .update(
                {InstagramConversation.current_support_ticket_id: None},
                synchronize_session=False,
            )
        )
        (
            self.db.query(Order)
            .filter(Order.source_conversation_id.in_(conversation_ids))
            .update({Order.source_conversation_id: None}, synchronize_session=False)
        )
        self.db.flush()

    def purge_by_meta_user_id(
        self,
        meta_user_id: str,
        *,
        source: str = "meta_callback",
    ) -> str | None:
        accounts = self.find_accounts_by_meta_user_id(meta_user_id)
        if not accounts:
            return None

        confirmation_code = secrets.token_urlsafe(16)
        account_ids = [account.id for account in accounts]
        for account in list(accounts):
            self.purge_account(account, source=source)

        request = DataDeletionRequest(
            confirmation_code=confirmation_code,
            meta_user_id=str(meta_user_id),
            instagram_account_ids=account_ids,
            source=source,
            status="completed",
            completed_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(request)
        self.db.commit()
        return confirmation_code

    def record_noop_deletion(self, meta_user_id: str) -> str:
        """Record a deletion request when no linked account exists."""
        confirmation_code = secrets.token_urlsafe(16)
        request = DataDeletionRequest(
            confirmation_code=confirmation_code,
            meta_user_id=str(meta_user_id),
            instagram_account_ids=[],
            source="meta_data_deletion",
            status="completed",
            completed_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(request)
        self.db.commit()
        return confirmation_code

    def invalidate_account_tokens(self, account: InstagramAccount) -> None:
        account.user_access_token = ""
        account.page_access_token = None
        account.granted_permissions = None
        account.token_expires_at = None
        account.updated_at = datetime.now(timezone.utc)
        self.db.commit()

    def _try_revoke_webhooks(
        self,
        account: InstagramAccount,
        *,
        revoke_webhooks: bool,
    ) -> None:
        if not revoke_webhooks:
            return

        user_id = str(account.instagram_user_id or "").strip()
        token = account.access_token() if account.user_access_token else ""
        if not user_id or not token:
            return

        try:
            self.instagram_api.unsubscribe_from_webhooks(user_id, token)
        except Exception:
            logger.warning(
                "Failed to revoke webhook subscription for account=%s",
                account.username,
                exc_info=True,
            )

    def _delete_webhook_events_for_account(self, account: InstagramAccount) -> None:
        ids = {
            value
            for value in (
                account.instagram_user_id,
                account.instagram_scoped_id,
                account.instagram_webhook_ig_id,
            )
            if value
        }
        if not ids:
            return

        (
            self.db.query(WebhookEvent)
            .filter(
                or_(
                    WebhookEvent.sender_id.in_(ids),
                    WebhookEvent.recipient_id.in_(ids),
                ),
            )
            .delete(synchronize_session=False)
        )
