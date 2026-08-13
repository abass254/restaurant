from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation
from app.services.instagram_api import InstagramApiService
from app.services.instagram_beta_api import InstagramBetaService
from app.services.instagram_beta_event_service import (
    EVENT_OUTBOUND_FAILED,
    EVENT_OUTBOUND_SENT,
    InstagramBetaEventService,
    STATUS_FAILED,
    STATUS_SUCCEEDED,
)
from app.services.platform_instagram import (
    INSTAGRAM_BETA_PLATFORM,
    get_merchant_instagram_beta_account,
)

logger = logging.getLogger(__name__)


@dataclass
class OutboundSendResult:
    message_id: str
    transport: str
    delivery_status: str = "sent"
    delivery_error: str | None = None


def resolve_outbound_transport(
    settings: Settings,
    db: Session | None,
    account: InstagramAccount,
) -> str:
    mode = (settings.instagram_outbound_transport or "auto").strip().lower()
    if not settings.instagram_beta_enabled:
        return "official"
    if mode == "official":
        return "official"
    if db is None or not account.account_id:
        return "official"

    beta = get_merchant_instagram_beta_account(db, str(account.account_id))
    if beta is None or beta.login_provider != "instagram_beta":
        return "official"
    if mode == "beta":
        return "beta"
    return "beta"


def _resolve_recipient_pk(
    beta_service: InstagramBetaService,
    beta_account: InstagramAccount,
    conversation: InstagramConversation | None,
    recipient_ig_scoped_id: str,
    db: Session | None,
) -> str:
    if conversation is not None and conversation.participant_instagram_pk:
        return str(conversation.participant_instagram_pk)

    if conversation is not None and conversation.participant_username:
        pk = beta_service.user_pk_from_username(
            beta_account,
            conversation.participant_username,
        )
        if pk:
            conversation.participant_instagram_pk = pk
            if db is not None:
                db.flush()
            return pk

    if recipient_ig_scoped_id.isdigit():
        return recipient_ig_scoped_id

    raise RuntimeError(
        "Cannot send via Instagram Beta: customer username is unknown. "
        "Ask them to message again or wait for profile enrichment.",
    )


def _generic_elements_to_text(elements: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for index, element in enumerate(elements, start=1):
        title = str(element.get("title") or f"Option {index}").strip()
        subtitle = str(element.get("subtitle") or "").strip()
        if subtitle:
            lines.append(f"{index}. {title} — {subtitle}")
        else:
            lines.append(f"{index}. {title}")
    if not lines:
        return "Tap an option below to continue."
    return "Here are your options:\n" + "\n".join(lines)


class InstagramOutboundTransport:
    def __init__(
        self,
        settings: Settings,
        instagram_api: InstagramApiService,
        *,
        db: Session | None = None,
        beta_service: InstagramBetaService | None = None,
    ):
        self.settings = settings
        self.instagram_api = instagram_api
        self.db = db
        self.beta_service = beta_service or InstagramBetaService()

    def _beta_account(self, account: InstagramAccount) -> InstagramAccount | None:
        if self.db is None or not account.account_id:
            return None
        return get_merchant_instagram_beta_account(self.db, str(account.account_id))

    def send_text(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        text: str,
        *,
        conversation: InstagramConversation | None = None,
        quick_replies: list[dict[str, str]] | None = None,
    ) -> OutboundSendResult:
        transport = resolve_outbound_transport(self.settings, self.db, account)
        if quick_replies and transport == "beta":
            chips = ", ".join(item.get("title") or item.get("payload") or "?" for item in quick_replies)
            text = f"{text}\n\nReply with: {chips}"

        if transport == "beta":
            beta_account = self._beta_account(account)
            if beta_account is None:
                transport = "official"
            else:
                try:
                    recipient_pk = _resolve_recipient_pk(
                        self.beta_service,
                        beta_account,
                        conversation,
                        recipient_ig_scoped_id,
                        self.db,
                    )
                    message_id = self.beta_service.send_text_message(
                        beta_account,
                        recipient_pk,
                        text,
                    )
                    if self.db is not None and account.account_id:
                        InstagramBetaEventService(self.db).record(
                            merchant_account_id=str(account.account_id),
                            event_type=EVENT_OUTBOUND_SENT,
                            status=STATUS_SUCCEEDED,
                            instagram_username=beta_account.username,
                            instagram_beta_account_id=beta_account.id,
                            instagram_account_id=account.id,
                            message="Beta text message sent.",
                            metadata={
                                "transport": "beta",
                                "recipient_pk": recipient_pk,
                                "message_id": message_id,
                            },
                        )
                    return OutboundSendResult(message_id=message_id, transport="beta")
                except Exception as exc:
                    if self.db is not None and account.account_id:
                        InstagramBetaEventService(self.db).record(
                            merchant_account_id=str(account.account_id),
                            event_type=EVENT_OUTBOUND_FAILED,
                            status=STATUS_FAILED,
                            instagram_username=beta_account.username,
                            instagram_beta_account_id=beta_account.id,
                            instagram_account_id=account.id,
                            message=str(exc)[:500],
                            metadata={"transport": "beta", "recipient_pk": recipient_pk},
                        )
                    logger.warning(
                        "Instagram Beta text send failed account=%s recipient=%s error=%s",
                        account.username,
                        recipient_ig_scoped_id,
                        exc,
                    )
                    if (self.settings.instagram_outbound_transport or "").lower() == "beta":
                        return OutboundSendResult(
                            message_id="",
                            transport="beta",
                            delivery_status="failed",
                            delivery_error=str(exc),
                        )

        try:
            response = self.instagram_api.send_text_message(
                recipient_ig_scoped_id,
                text,
                account.access_token(),
                quick_replies=quick_replies,
            )
            message_id = str(response.get("message_id") or response.get("id") or "")
            return OutboundSendResult(message_id=message_id, transport="official")
        except Exception as exc:
            return OutboundSendResult(
                message_id="",
                transport="official",
                delivery_status="failed",
                delivery_error=str(exc),
            )

    def send_image(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        image_url: str,
        *,
        conversation: InstagramConversation | None = None,
    ) -> OutboundSendResult:
        transport = resolve_outbound_transport(self.settings, self.db, account)
        if transport == "beta":
            beta_account = self._beta_account(account)
            if beta_account is not None:
                try:
                    recipient_pk = _resolve_recipient_pk(
                        self.beta_service,
                        beta_account,
                        conversation,
                        recipient_ig_scoped_id,
                        self.db,
                    )
                    message_id = self.beta_service.send_image_message(
                        beta_account,
                        recipient_pk,
                        image_url,
                    )
                    return OutboundSendResult(message_id=message_id, transport="beta")
                except Exception as exc:
                    logger.warning(
                        "Instagram Beta image send failed account=%s error=%s",
                        account.username,
                        exc,
                    )

        response = self.instagram_api.send_image_message(
            recipient_ig_scoped_id,
            image_url,
            account.access_token(),
        )
        message_id = str(response.get("message_id") or response.get("id") or "")
        return OutboundSendResult(message_id=message_id, transport="official")

    def send_generic_template(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        elements: list[dict[str, Any]],
        *,
        conversation: InstagramConversation | None = None,
    ) -> OutboundSendResult:
        transport = resolve_outbound_transport(self.settings, self.db, account)
        if transport == "beta":
            return self.send_text(
                account,
                recipient_ig_scoped_id,
                _generic_elements_to_text(elements),
                conversation=conversation,
            )

        response = self.instagram_api.send_generic_template(
            recipient_ig_scoped_id,
            elements,
            account.access_token(),
        )
        message_id = str(response.get("message_id") or response.get("id") or "")
        return OutboundSendResult(message_id=message_id, transport="official")
