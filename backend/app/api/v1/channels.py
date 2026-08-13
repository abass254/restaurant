"""
Unified multi-channel API.

Exposes the platform's connected social-media channels (Instagram today,
Facebook / WhatsApp / TikTok as manual-link placeholders) so the dashboard
can show a single "Channels" UI and the messages page can detect whether
any channel is connected.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.web.instagram_auth import _request_return_origin
from app.schemas import InstagramAccountOut
from app.services.instagram_beta_event_service import InstagramBetaEventService
from app.services.platform_instagram import (
    INSTAGRAM_BETA_PLATFORM,
    SUPPORTED_PLATFORMS,
    get_merchant_channel_account,
    list_merchant_connected_channels,
    normalize_platform,
    require_merchant_account_id,
    user_can_manage_channels,
)

router = APIRouter(prefix="/channels", tags=["channels"])


# Static catalogue describing each platform so the frontend always has a
# stable ordering, label, icon, and capability list — even when nothing is
# connected yet.
_PLATFORM_CATALOG: dict[str, dict] = {
    "instagram": {
        "label": "Instagram",
        "tagline": "DMs, comments, and story replies via Meta.",
        "icon": "fa-brands fa-instagram",
        "color": "#dd2a7b",
        "supports_oauth": True,
        "supports_messaging": True,
        "status_text": "Live messaging available.",
    },
    "instagram_beta": {
        "label": "Instagram (Beta)",
        "tagline": "Session-based outbound messaging while Meta App Review is pending.",
        "icon": "fa-brands fa-instagram",
        "color": "#833ab4",
        "supports_oauth": False,
        "supports_messaging": True,
        "supports_password_login": True,
        "status_text": "Beta — sends replies via session login until Meta Advanced Access is approved.",
    },
    "facebook": {
        "label": "Facebook",
        "tagline": "Page inbox & Messenger conversations.",
        "icon": "fa-brands fa-facebook",
        "color": "#1877f2",
        "supports_oauth": False,
        "supports_messaging": False,
        "status_text": "Manual link only — live messaging coming soon.",
    },
    "whatsapp": {
        "label": "WhatsApp",
        "tagline": "Business chats via Cloud API.",
        "icon": "fa-brands fa-whatsapp",
        "color": "#25d366",
        "supports_oauth": False,
        "supports_messaging": True,
        "status_text": "Live inbound messaging available via webhooks.",
    },
    "tiktok": {
        "label": "TikTok",
        "tagline": "Business DMs & comments.",
        "icon": "fa-brands fa-tiktok",
        "color": "#010101",
        "supports_oauth": False,
        "supports_messaging": False,
        "status_text": "Manual link only — live messaging coming soon.",
    },
}


def _instagram_connect_url(request: Request | None) -> str:
    """OAuth entrypoint on the app host the user is browsing (not internal docker host)."""
    if request is None:
        return "/auth/instagram"
    settings = get_settings()
    origin = _request_return_origin(request)
    try:
        settings.validate_oauth_return_origin(origin)
    except ValueError:
        return "/auth/instagram"
    return f"{origin}/auth/instagram"


def _channel_payload(platform: str, account, request: Request | None = None) -> dict:
    meta = _PLATFORM_CATALOG[platform]
    connect_url = _instagram_connect_url(request) if platform == "instagram" else None
    return {
        "platform": platform,
        "label": meta["label"],
        "tagline": meta["tagline"],
        "icon": meta["icon"],
        "color": meta["color"],
        "supports_oauth": meta["supports_oauth"],
        "supports_messaging": meta["supports_messaging"],
        "supports_password_login": meta.get("supports_password_login", False),
        "status_text": meta["status_text"],
        "connect_url": connect_url,
        "connected": account is not None,
        "account": InstagramAccountOut.from_model(account) if account else None,
    }


class ConnectChannelRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


class ConnectInstagramBetaRequest(BaseModel):
    password: str = Field(min_length=1, max_length=255)
    username: str | None = Field(default=None, max_length=255)
    verification_code: str | None = Field(default=None, max_length=32)


def _visible_platforms(settings) -> list[str]:
    platforms = list(SUPPORTED_PLATFORMS)
    if not settings.instagram_beta_enabled:
        platforms = [platform for platform in platforms if platform != INSTAGRAM_BETA_PLATFORM]
    return platforms


@router.get("")
def list_channels(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    merchant_id = require_merchant_account_id(user)
    accounts = list_merchant_connected_channels(services.db, merchant_id)
    official_instagram = accounts.get("instagram")
    official_username = (
        str(official_instagram.username).lstrip("@")
        if official_instagram is not None and official_instagram.username
        else None
    )
    channels = [
        _channel_payload(platform, accounts.get(platform), request)
        for platform in _visible_platforms(services.settings)
    ]
    for channel in channels:
        if channel["platform"] == INSTAGRAM_BETA_PLATFORM:
            channel["linked_instagram_username"] = official_username
    connected_platforms = [c["platform"] for c in channels if c["connected"]]
    beta_account = accounts.get(INSTAGRAM_BETA_PLATFORM)
    beta_events = []
    pending_challenge = None
    if services.settings.instagram_beta_enabled:
        event_service = InstagramBetaEventService(services.db)
        beta_events = [
            InstagramBetaEventService.to_dict(item)
            for item in event_service.recent_events(merchant_id, limit=10)
        ]
        pending = event_service.latest_pending_challenge(merchant_id)
        if pending is not None:
            pending_challenge = InstagramBetaEventService.to_dict(pending)
    return {
        "can_manage": user_can_manage_channels(user),
        "channels": channels,
        "connected_count": len(connected_platforms),
        "connected_platforms": connected_platforms,
        "any_connected": bool(connected_platforms),
        "instagram_beta_enabled": services.settings.instagram_beta_enabled,
        "instagram_outbound_transport": services.settings.instagram_outbound_transport,
        "instagram_beta_connected": beta_account is not None,
        "official_instagram_username": official_username,
        "instagram_beta_events": beta_events,
        "instagram_beta_pending_challenge": pending_challenge,
    }


@router.post("/{platform}")
def connect_channel(
    platform: str,
    payload: ConnectChannelRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only platform admins can manage channels.",
        )
    platform = normalize_platform(platform)
    if platform == INSTAGRAM_BETA_PLATFORM:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Use POST /api/v1/channels/instagram_beta/connect with username and password.",
        )
    account = services.linker.link_manual(
        user,
        payload.username,
        payload.display_name,
        platform=platform,
    )
    return {
        "message": f"{_PLATFORM_CATALOG[platform]['label']} account saved.",
        "channel": _channel_payload(platform, account, request),
    }


@router.post("/instagram_beta/connect")
def connect_instagram_beta(
    payload: ConnectInstagramBetaRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only platform admins can manage channels.",
        )
    account = services.linker.link_instagram_beta(
        user,
        payload.password,
        username=payload.username,
        verification_code=payload.verification_code,
    )
    return {
        "message": "Instagram Beta connected.",
        "channel": _channel_payload(INSTAGRAM_BETA_PLATFORM, account, request),
    }


@router.get("/instagram_beta/events")
def list_instagram_beta_events(
    limit: int = 20,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not services.settings.instagram_beta_enabled:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Instagram Beta is not enabled on this environment.",
        )
    merchant_id = require_merchant_account_id(user)
    event_service = InstagramBetaEventService(services.db)
    events = event_service.recent_events(merchant_id, limit=limit)
    pending = event_service.latest_pending_challenge(merchant_id)
    return {
        "events": [InstagramBetaEventService.to_dict(item) for item in events],
        "pending_challenge": (
            InstagramBetaEventService.to_dict(pending) if pending is not None else None
        ),
    }


@router.delete("/{platform}")
def disconnect_channel(
    platform: str,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only platform admins can manage channels.",
        )
    platform = normalize_platform(platform)
    merchant_id = require_merchant_account_id(user)
    account = get_merchant_channel_account(services.db, merchant_id, platform)
    if account:
        if platform == "instagram":
            from app.services.instagram_data_purge import InstagramDataPurgeService

            purge = InstagramDataPurgeService(
                services.db,
                services.settings,
                services.instagram_api,
            )
            purge.purge_account(account, source="merchant_disconnect")
        else:
            from app.services.instagram_data_purge import InstagramDataPurgeService

            purge = InstagramDataPurgeService(
                services.db,
                services.settings,
                services.instagram_api,
            )
            purge._prepare_account_for_deletion(account)
            services.db.delete(account)
        services.db.commit()
    return {
        "message": f"{_PLATFORM_CATALOG[platform]['label']} account removed.",
        "channel": _channel_payload(platform, None, request),
    }
