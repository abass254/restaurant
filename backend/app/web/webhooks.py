from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import PlainTextResponse

from app.config import Settings, get_settings
from app.database import SessionLocal
from app.dependencies import ServiceContainer, get_services
from app.models import InstagramConversation, InstagramMessage, WebhookEvent
from app.dependencies import ServiceContainer
from app.services.platform_instagram import find_channel_account_by_external_id
from app.support.webhook_event_summary import summarize_webhook_payload

logger = logging.getLogger(__name__)
router = APIRouter(tags=["webhooks"])


def _signature_hint(body: bytes, header: str | None, settings: Settings) -> str | None:
    if not header or not header.startswith("sha256="):
        if settings.app_env == "local" and not settings.instagram_app_secret:
            return "local-unsigned"
        return None

    candidates = {
        "instagram": settings.instagram_app_secret,
        "meta": settings.meta_app_secret,
    }
    for label, secret in candidates.items():
        if not secret:
            continue
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, header):
            return label
    return None


def _record_event(
    payload: dict,
    signature_hint: str | None,
    http_status: int,
    processing_result: str,
) -> None:
    """Persist webhook audit row. Uses its own DB session so pool pressure on the
    request session cannot block DM processing. Failures are logged, not raised."""
    db = SessionLocal()
    try:
        summary = summarize_webhook_payload(payload)
        event = WebhookEvent(
            received_at=datetime.now(timezone.utc),
            signature_valid=signature_hint is not None,
            signature_secret=signature_hint,
            http_status=http_status,
            object=str(payload.get("object") or "") or None,
            event_type=summary["event_type"],
            sender_id=summary["sender_id"],
            recipient_id=summary["recipient_id"],
            preview=summary["preview"],
            payload=payload,
            processing_result=processing_result,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(event)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Webhook audit log write failed")
    finally:
        db.close()


def _process_payload(payload: dict) -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        services = ServiceContainer(db, settings)
        services.webhooks.handle(payload)
    except Exception:
        logger.exception("Instagram webhook processing failed")
        raise
    finally:
        db.close()


def _parse_whatsapp_timestamp(value: object) -> datetime:
    if value in (None, ""):
        return datetime.now(timezone.utc)
    ts = int(value)
    if ts <= 0:
        return datetime.now(timezone.utc)
    if ts < 1_000_000_000_000:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)


def _ingest_whatsapp_payload(services: ServiceContainer, payload: dict) -> int:
    phone_number_id = ""
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            metadata = ((change or {}).get("value") or {}).get("metadata") or {}
            phone_number_id = str(metadata.get("phone_number_id") or "")
            if phone_number_id:
                break
        if phone_number_id:
            break

    account = None
    if phone_number_id:
        account = find_channel_account_by_external_id(
            services.db,
            "whatsapp",
            phone_number_id,
        )
    if account is None:
        # NOTE: keep this fallback explicit + narrow. It's only for single-tenant
        # local setups where the WhatsApp channel was linked manually without
        # storing phone_number_id yet.
        from app.models import InstagramAccount

        rows = (
            services.db.query(InstagramAccount)
            .filter(InstagramAccount.platform == "whatsapp")
            .limit(2)
            .all()
        )
        if len(rows) == 1:
            account = rows[0]
            logger.warning(
                "WhatsApp webhook fallback matched the only connected WhatsApp channel "
                "(account_id=%s). Consider saving WHATSAPP_PHONE_NUMBER_ID to avoid ambiguity.",
                account.id,
            )
    if account is None:
        logger.warning(
            "WhatsApp webhook received but no matching merchant WhatsApp channel "
            "(phone_number_id=%s).",
            phone_number_id or "unknown",
        )
        return 0
    if phone_number_id and not account.instagram_webhook_ig_id:
        account.instagram_webhook_ig_id = phone_number_id

    ingested = 0
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            value = (change or {}).get("value") or {}
            messages = value.get("messages") or []
            contacts = value.get("contacts") or []
            profile_by_wa_id: dict[str, str] = {}
            for contact in contacts:
                if not isinstance(contact, dict):
                    continue
                wa_id = str(contact.get("wa_id") or "")
                name = str(((contact.get("profile") or {}).get("name")) or "")
                if wa_id and name:
                    profile_by_wa_id[wa_id] = name

            for message in messages:
                if not isinstance(message, dict):
                    continue
                if message.get("type") != "text":
                    continue
                mid = str(message.get("id") or "")
                wa_id = str(message.get("from") or "")
                text = str(((message.get("text") or {}).get("body")) or "").strip()
                if not mid or not wa_id or not text:
                    continue

                timestamp = _parse_whatsapp_timestamp(message.get("timestamp"))
                conversation = (
                    services.db.query(InstagramConversation)
                    .filter(
                        InstagramConversation.instagram_account_id == account.id,
                        InstagramConversation.participant_ig_id == wa_id,
                    )
                    .first()
                )
                if conversation is None:
                    conversation = InstagramConversation(
                        instagram_account_id=account.id,
                        instagram_conversation_id=f"whatsapp_{wa_id}",
                        participant_ig_id=wa_id,
                        participant_username=profile_by_wa_id.get(wa_id),
                        last_message_at=timestamp,
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                    services.db.add(conversation)
                    services.db.flush()
                else:
                    conversation.last_message_at = timestamp
                    conversation.updated_at = datetime.now(timezone.utc)
                    if not conversation.participant_username and profile_by_wa_id.get(wa_id):
                        conversation.participant_username = profile_by_wa_id[wa_id]

                duplicate = (
                    services.db.query(InstagramMessage)
                    .filter(InstagramMessage.instagram_message_id == mid)
                    .first()
                )
                if duplicate:
                    continue

                inbound = InstagramMessage(
                    instagram_conversation_id=conversation.id,
                    instagram_message_id=mid,
                    direction="inbound",
                    sender_ig_id=wa_id,
                    sender_username=profile_by_wa_id.get(wa_id),
                    body=text,
                    sent_at=timestamp,
                    auto_replied=False,
                    created_at=timestamp,
                    updated_at=timestamp,
                )
                services.db.add(inbound)
                services.db.flush()
                try:
                    services.auto_reply.process_inbound_message(account, conversation, inbound)
                except Exception:
                    logger.exception("WhatsApp auto-reply processing failed mid=%s", mid)
                ingested += 1

    services.db.commit()
    return ingested


def verify_instagram_webhook(
    hub_mode: str | None,
    hub_verify_token: str | None,
    hub_challenge: str | None,
) -> PlainTextResponse:
    settings = get_settings()
    if (
        hub_mode == "subscribe"
        and settings.meta_webhook_verify_token
        and hmac.compare_digest(settings.meta_webhook_verify_token, hub_verify_token or "")
    ):
        logger.info("Instagram webhook verified (challenge returned)")
        return PlainTextResponse(hub_challenge or "", status_code=200)
    logger.warning("Instagram webhook verification failed mode=%s", hub_mode)
    return PlainTextResponse("Forbidden", status_code=403)


@router.get("/webhooks/instagram")
async def verify_webhook(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    return verify_instagram_webhook(hub_mode, hub_verify_token, hub_challenge)


@router.get("/webhooks/whatsapp")
async def verify_whatsapp_webhook(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    return verify_instagram_webhook(hub_mode, hub_verify_token, hub_challenge)


@router.post("/webhooks/instagram")
async def handle_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    settings = get_settings()
    body = await request.body()
    signature_hint = _signature_hint(
        body,
        request.headers.get("X-Hub-Signature-256"),
        settings,
    )

    if signature_hint is None:
        try:
            payload = json.loads(body.decode() or "{}")
        except json.JSONDecodeError:
            payload = {}
        hint = InstagramWebhookPayload.describe_skipped(payload)
        logger.warning(
            "Instagram webhook rejected: invalid signature (%s). "
            "Console test events often fail signature check; real DMs should return 200.",
            hint,
        )
        _record_event(payload, None, 403, "rejected: invalid signature")
        return PlainTextResponse("Invalid signature", status_code=403)

    payload = json.loads(body.decode() or "{}")
    summary = (
        f"object={payload.get('object', 'none')} "
        f"sample={'yes' if 'sample' in payload else 'no'} "
        f"entries={len(payload.get('entry') or [])}"
    )
    logger.info("Instagram webhook received summary=%s secret=%s", summary, signature_hint)

    # Queue DM processing before audit logging — Meta must get 200 even if the
    # webhook_events insert fails (e.g. connection pool exhaustion).
    if payload:
        background_tasks.add_task(_process_payload, payload)

    _record_event(payload, signature_hint, 200, "accepted, queued")

    return PlainTextResponse("EVENT_RECEIVED", status_code=200)


@router.post("/webhooks/whatsapp")
async def handle_whatsapp_webhook(
    request: Request,
    services: ServiceContainer = Depends(get_services),
):
    settings = get_settings()
    body = await request.body()
    signature_hint = _signature_hint(
        body,
        request.headers.get("X-Hub-Signature-256"),
        settings,
    )
    if signature_hint is None:
        try:
            payload = json.loads(body.decode() or "{}")
        except json.JSONDecodeError:
            payload = {}
        _record_event(payload, None, 403, "rejected: invalid signature")
        return PlainTextResponse("Invalid signature", status_code=403)

    payload = json.loads(body.decode() or "{}")
    ingested = _ingest_whatsapp_payload(services, payload)
    _record_event(
        payload,
        signature_hint,
        200,
        f"accepted, ingested={ingested}",
    )
    return PlainTextResponse("EVENT_RECEIVED", status_code=200)
