from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, User
from app.services.auto_reply_service import AutoReplyService
from app.services.conversation_starter_service import ConversationStarterService
from app.services.instagram_api import InstagramApiService
from app.services.instagram_connection import InstagramConnectionService
from app.services.instagram_permissions import InstagramPermissions
from app.services.onboarding_service import OnboardingRequirementService
from app.services.instagram_beta_api import (
    InstagramBetaChallengeRequired,
    InstagramBetaLoginError,
    InstagramBetaService,
)
from app.services.instagram_beta_event_service import (
    EVENT_CHALLENGE_REQUIRED,
    EVENT_CHALLENGE_SUBMITTED,
    EVENT_CONNECT_FAILED,
    EVENT_CONNECT_STARTED,
    EVENT_CONNECT_SUCCEEDED,
    InstagramBetaEventService,
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_SUCCEEDED,
)
from app.services.platform_instagram import (
    get_merchant_instagram_account,
    get_merchant_channel_account,
    instagram_user_id_taken_by_other_merchant,
    require_merchant_account_id,
)

logger = logging.getLogger(__name__)


class InstagramAccountLinkService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        instagram_api: InstagramApiService,
    ):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api
        self.connection = InstagramConnectionService(db, settings, instagram_api)
        self.starters = ConversationStarterService(db, settings, instagram_api)
        self.auto_reply = AutoReplyService(db, settings, instagram_api)
        self.onboarding = OnboardingRequirementService(db, settings, instagram_api)

    def link_from_oauth(
        self,
        user: User,
        token_payload: dict,
        profile: dict,
        *,
        long_lived: dict | None = None,
    ) -> InstagramAccount:
        short_token = token_payload["access_token"]
        scoped_user_id = str(token_payload.get("user_id") or "")
        permissions = InstagramPermissions.from_token_payload(token_payload)
        if long_lived is None:
            long_lived = self.instagram_api.exchange_for_long_lived_token(short_token)
        token = long_lived["access_token"]
        professional_id = str(profile.get("user_id") or profile.get("id") or scoped_user_id)
        account_type = profile.get("account_type")
        if account_type:
            account_type = str(account_type).upper().replace(" ", "_")

        return self._upsert_channel_account(
            user,
            platform="instagram",
            attributes={
                "login_provider": "instagram",
                "instagram_scoped_id": scoped_user_id or None,
                "instagram_user_id": professional_id or None,
                "username": profile.get("username"),
                "name": profile.get("name"),
                "account_type": account_type,
                "granted_permissions": permissions
                or ",".join(self.settings.instagram_scopes),
                "user_access_token": token,
                "page_access_token": None,
                "facebook_page_id": None,
                "facebook_page_name": None,
                "token_expires_at": long_lived.get("expires_at"),
            },
        )

    def link_manual(
        self,
        user: User,
        username: str,
        display_name: str | None = None,
        platform: str = "instagram",
    ) -> InstagramAccount:
        """Manual placeholder link for any supported channel."""
        normalized = username.lstrip("@")
        slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-") or "account"
        whatsapp_webhook_id = None
        if platform == "whatsapp":
            whatsapp_webhook_id = (self.settings.whatsapp_phone_number_id or "").strip() or None
        return self._upsert_channel_account(
            user,
            platform=platform,
            attributes={
                "login_provider": "manual",
                "instagram_scoped_id": None,
                "instagram_user_id": f"manual_{platform}_{slug}",
                "instagram_webhook_ig_id": whatsapp_webhook_id,
                "username": normalized,
                "name": display_name or normalized,
                "account_type": "BUSINESS",
                "granted_permissions": ",".join(self.settings.instagram_scopes),
                "user_access_token": "manual-placeholder-token",
                "page_access_token": None,
                "facebook_page_id": None,
                "facebook_page_name": None,
                "token_expires_at": None,
                "onboarding_complete": False,
                "onboarding_checks": {
                    "manual_connection": True,
                    "messages_permission": False,
                },
            },
            run_onboarding=False,
        )

    def link_instagram_beta(
        self,
        user: User,
        password: str,
        *,
        username: str | None = None,
        verification_code: str | None = None,
    ) -> InstagramAccount:
        if not self.settings.instagram_beta_enabled:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Instagram Beta is not enabled on this environment.",
            )

        merchant_account_id = require_merchant_account_id(user)
        official = get_merchant_instagram_account(self.db, merchant_account_id)
        if official is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Connect your official Instagram account via Meta before enabling Instagram Beta.",
            )
        if not official.username:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Your connected Instagram account has no username. Reconnect via Meta first.",
            )

        normalized = (username or official.username).lstrip("@").strip()
        if not normalized:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Instagram username is required.",
            )
        if official.username.lower() != normalized.lower():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Instagram Beta must use your connected Instagram account "
                    f"(@{official.username.lstrip('@')})."
                ),
            )

        events = InstagramBetaEventService(self.db)
        events.record(
            merchant_account_id=merchant_account_id,
            event_type=EVENT_CONNECT_STARTED,
            status=STATUS_PENDING,
            instagram_username=normalized,
            instagram_account_id=official.id,
            message="Instagram Beta connect started.",
        )
        if verification_code:
            events.record(
                merchant_account_id=merchant_account_id,
                event_type=EVENT_CHALLENGE_SUBMITTED,
                status=STATUS_PENDING,
                instagram_username=normalized,
                instagram_account_id=official.id,
                message="Verification code submitted.",
                metadata={"has_verification_code": True},
            )

        beta_service = InstagramBetaService()
        try:
            login = beta_service.login(
                normalized,
                password,
                verification_code=verification_code,
            )
        except InstagramBetaChallengeRequired as exc:
            challenge_event = events.record(
                merchant_account_id=merchant_account_id,
                event_type=EVENT_CHALLENGE_REQUIRED,
                status=STATUS_PENDING,
                instagram_username=normalized,
                instagram_account_id=official.id,
                message=str(exc),
                metadata={"challenge_type": exc.challenge_type},
            )
            raise HTTPException(
                status.HTTP_428_PRECONDITION_REQUIRED,
                detail={
                    "code": "instagram_beta_challenge_required",
                    "message": str(exc),
                    "challenge_type": exc.challenge_type,
                    "event_id": challenge_event.id,
                },
            ) from exc
        except InstagramBetaLoginError as exc:
            events.resolve_pending_challenge(
                merchant_account_id,
                instagram_username=normalized,
                succeeded=False,
                message=str(exc),
            )
            events.record(
                merchant_account_id=merchant_account_id,
                event_type=EVENT_CONNECT_FAILED,
                status=STATUS_FAILED,
                instagram_username=normalized,
                instagram_account_id=official.id,
                message=str(exc),
                metadata={"error_type": exc.error_type},
            )
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        events.resolve_pending_challenge(
            merchant_account_id,
            instagram_username=normalized,
            succeeded=True,
            message="Verification accepted.",
        )
        encrypted_session = beta_service.encrypt_session(login["session_json"])
        account = self._upsert_channel_account(
            user,
            platform="instagram_beta",
            attributes={
                "login_provider": "instagram_beta",
                "instagram_scoped_id": None,
                "instagram_user_id": login["instagram_user_id"],
                "username": login["username"],
                "name": login["name"],
                "account_type": official.account_type,
                "granted_permissions": "instagram_beta_session",
                "user_access_token": encrypted_session,
                "page_access_token": None,
                "facebook_page_id": None,
                "facebook_page_name": None,
                "token_expires_at": None,
                "onboarding_complete": True,
                "onboarding_checks": {
                    "instagram_beta_connected": True,
                    "session_valid": True,
                },
            },
            run_onboarding=False,
        )
        events.record(
            merchant_account_id=merchant_account_id,
            event_type=EVENT_CONNECT_SUCCEEDED,
            status=STATUS_SUCCEEDED,
            instagram_username=login["username"],
            instagram_account_id=official.id,
            instagram_beta_account_id=account.id,
            message="Instagram Beta connected successfully.",
        )
        return account

    def _upsert_channel_account(
        self,
        user: User,
        *,
        platform: str,
        attributes: dict,
        run_onboarding: bool = True,
    ) -> InstagramAccount:
        """
        Exactly one channel row per merchant shop (``account_id``) and platform.
        The same Instagram business account cannot be linked to two merchants.
        """
        merchant_account_id = require_merchant_account_id(user)
        ig_user_id = attributes.get("instagram_user_id")

        if ig_user_id:
            conflict = instagram_user_id_taken_by_other_merchant(
                self.db,
                platform=platform,
                instagram_user_id=str(ig_user_id),
                account_id=merchant_account_id,
            )
            if conflict is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail={
                        "code": "instagram_already_linked",
                        "message": (
                            "This Instagram account is already connected to another shop. "
                            "Each merchant can only use their own Instagram account."
                        ),
                    },
                )

        account = get_merchant_channel_account(self.db, merchant_account_id, platform)
        if account is None:
            account = InstagramAccount(
                user_id=user.id,
                account_id=merchant_account_id,
                platform=platform,
                user_access_token="",
            )
            self.db.add(account)
            self.db.flush()
            logger.info(
                "Created %s account id=%s for merchant account_id=%s",
                platform,
                account.id,
                merchant_account_id,
            )
        else:
            logger.info(
                "Updating %s account id=%s for merchant account_id=%s",
                platform,
                account.id,
                merchant_account_id,
            )

        account.account_id = merchant_account_id
        account.user_id = user.id
        account.platform = platform
        for key, value in attributes.items():
            setattr(account, key, value)

        account.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(account)

        if run_onboarding and platform == "instagram" and account.login_provider == "instagram":
            try:
                self.connection.subscribe_webhooks(account)
            except Exception as exc:
                logger.warning("Instagram webhook subscription failed: %s", exc)

            self.starters.seed_defaults(account)

            try:
                self.auto_reply.seed_default_greeting_rule(account)
            except Exception as exc:
                logger.warning("Default greeting rule seeding failed: %s", exc)

            try:
                self.starters.sync_to_instagram(account)
            except Exception as exc:
                logger.warning("Conversation starters sync failed: %s", exc)

            self.onboarding.evaluate(account)
            self.db.refresh(account)

        return account

    def _upsert_platform_account(
        self,
        user: User,
        attributes: dict,
        *,
        run_onboarding: bool = True,
    ) -> InstagramAccount:
        return self._upsert_channel_account(
            user,
            platform="instagram",
            attributes=attributes,
            run_onboarding=run_onboarding,
        )
