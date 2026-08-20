from __future__ import annotations

from typing import Any

from fastapi import Depends, Request
from sqlalchemy.orm import Session, joinedload

from app.config import Settings, get_settings
from app.core.session import get_session
from app.database import get_db
from app.models import User
from app.services.auth_service import InstagramAuthService
from app.services.auto_reply_service import AutoReplyService
from app.services.comment_agent_service import CommentAgentService
from app.services.conversation_starter_service import ConversationStarterService
from app.services.dm_agent_service import DmAgentService
from app.services.dm_bot_router import DmBotRouter
from app.services.dm_ticket_service import DmTicketService
from app.services.instagram_account_link import InstagramAccountLinkService
from app.services.instagram_api import InstagramApiService
from app.services.instagram_connection import InstagramConnectionService
from app.services.messaging_service import (
    InstagramMessagingService,
    SimulatedInboundMessageService,
)
from app.services.onboarding_service import OnboardingRequirementService
from app.services.registration import BusinessRegistrationService
from app.services.webhook_service import InstagramWebhookService


def load_user(db: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    return (
        db.query(User)
        .options(joinedload(User.account), joinedload(User.instagram_account))
        .filter(User.id == user_id)
        .first()
    )


class ServiceContainer:
    def __init__(self, db: Session, settings: Settings):
        self.db = db
        self.settings = settings
        self.instagram_api = InstagramApiService(settings)
        self.auto_reply = AutoReplyService(db, settings, self.instagram_api)
        self.dm_tickets = DmTicketService(db, settings, self.instagram_api)
        self.dm_agent = DmAgentService(db, settings, self.instagram_api)
        self.comment_agent = CommentAgentService(db, settings, self.instagram_api)
        self.dm_bots = DmBotRouter(
            db,
            settings,
            self.dm_agent,
            dm_tickets=self.dm_tickets,
        )
        self.messaging = InstagramMessagingService(
            db,
            settings,
            self.instagram_api,
            self.auto_reply,
        )
        self.simulator = SimulatedInboundMessageService(
            db,
            self.auto_reply,
            self.dm_tickets,
            self.dm_bots,
        )
        self.starters = ConversationStarterService(db, settings, self.instagram_api)
        self.connection = InstagramConnectionService(db, settings, self.instagram_api)
        self.onboarding = OnboardingRequirementService(db, settings, self.instagram_api)
        self.linker = InstagramAccountLinkService(db, settings, self.instagram_api)
        self.registration = BusinessRegistrationService(db, settings)
        self.auth = InstagramAuthService(settings, self.instagram_api, self.linker)
        self.webhooks = InstagramWebhookService(
            db,
            self.auto_reply,
            self.starters,
            self.dm_tickets,
            self.dm_bots,
            self.comment_agent,
        )


def get_services(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ServiceContainer:
    return ServiceContainer(db, settings)


def get_request_session(request: Request) -> dict[str, Any]:
    return get_session(request)
