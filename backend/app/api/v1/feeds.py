"""
Social content feeds — posts published on connected channels.

Instagram (OAuth) pulls live media from the Graph API. Other platforms
surface connection status until their content APIs are wired up.
"""

from __future__ import annotations

import json
import logging
import asyncio
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.core.uploads import save_feed_upload
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.schemas import InstagramAccountOut
from app.services.feed_post_detail_service import (
    fetch_instagram_post_comments,
    fetch_instagram_post_detail,
    fetch_instagram_post_insights,
)
from app.services.feed_post_link_service import (
    add_post_link,
    add_post_links,
    enrich_posts_with_links,
    remove_post_link,
)
from app.services.platform_instagram import (
    INSTAGRAM_BETA_PLATFORM,
    SUPPORTED_PLATFORMS,
    get_merchant_instagram_account,
    list_merchant_connected_channels,
    normalize_platform,
    require_merchant_account_id,
)
from app.services.social_publish_service import (
    normalize_instagram_post,
    publish_instagram_media,
    require_instagram_publish_account,
)
from app.web.instagram_auth import _request_return_origin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["feeds"])

_PLATFORM_CATALOG: dict[str, dict[str, str]] = {
    "instagram": {
        "label": "Instagram",
        "icon": "fa-brands fa-instagram",
        "color": "#dd2a7b",
    },
    "instagram_beta": {
        "label": "Instagram (Beta)",
        "icon": "fa-brands fa-instagram",
        "color": "#833ab4",
    },
    "facebook": {
        "label": "Facebook",
        "icon": "fa-brands fa-facebook",
        "color": "#1877f2",
    },
    "whatsapp": {
        "label": "WhatsApp",
        "icon": "fa-brands fa-whatsapp",
        "color": "#25d366",
    },
    "tiktok": {
        "label": "TikTok",
        "icon": "fa-brands fa-tiktok",
        "color": "#010101",
    },
}

# Content feeds are Graph/media APIs. Instagram Beta is session messaging only.
_FEED_PLATFORMS: tuple[str, ...] = tuple(
    p for p in SUPPORTED_PLATFORMS if p != INSTAGRAM_BETA_PLATFORM
)
_FEED_CAPABLE_PLATFORMS = frozenset({"instagram"})


def _instagram_connect_url(request: Request | None) -> str:
    if request is None:
        return "/auth/instagram"
    from app.config import get_settings

    settings = get_settings()
    origin = _request_return_origin(request)
    try:
        settings.validate_oauth_return_origin(origin)
    except ValueError:
        return "/auth/instagram"
    return f"{origin}/auth/instagram"


def _normalize_post(raw: dict[str, Any], platform: str) -> dict[str, Any]:
    if platform == "instagram":
        return normalize_instagram_post(raw)
    media_type = str(raw.get("media_type") or "IMAGE").upper()
    raw_media_url = raw.get("media_url")
    thumbnail_url = raw.get("thumbnail_url")
    is_video = media_type in ("VIDEO", "REELS")
    return {
        "id": str(raw.get("id") or ""),
        "platform": platform,
        "caption": raw.get("caption"),
        "media_type": media_type,
        "image_url": thumbnail_url if is_video else (raw_media_url or thumbnail_url),
        "video_url": raw_media_url if is_video else None,
        "permalink": raw.get("permalink"),
        "timestamp": raw.get("timestamp"),
        "like_count": raw.get("like_count"),
        "comments_count": raw.get("comments_count"),
        "linked_inventory": [],
    }


def _fetch_instagram_feed(
    services: ServiceContainer,
    account,
    *,
    limit: int,
    after: str | None,
) -> tuple[list[dict[str, Any]], str | None, str | None]:
    if account.login_provider != "instagram":
        return (
            [],
            None,
            "Connect with Meta OAuth to load your Instagram posts.",
        )
    if not account.instagram_user_id or str(account.instagram_user_id).startswith("manual_"):
        return [], None, "Instagram account is not fully linked yet."
    token = account.access_token()
    if not token or token == "manual-placeholder-token":
        return [], None, "A valid Instagram access token is required."

    try:
        payload = services.instagram_api.get_user_media(
            str(account.instagram_user_id),
            token,
            limit=limit,
            after=after,
        )
    except Exception as exc:
        logger.warning("Instagram feed fetch failed for account %s: %s", account.id, exc)
        return [], None, str(exc)

    posts = [_normalize_post(item, "instagram") for item in (payload.get("data") or [])]
    paging = payload.get("paging") or {}
    cursors = paging.get("cursors") or {}
    next_cursor = cursors.get("after") if paging.get("next") else None
    return posts, next_cursor, None


def _platform_feed_payload(
    platform: str,
    account,
    request: Request,
    services: ServiceContainer,
    *,
    limit: int,
    after: str | None,
    account_id: str,
) -> dict[str, Any]:
    meta = _PLATFORM_CATALOG.get(platform) or {
        "label": platform.replace("_", " ").title(),
        "icon": "fa-solid fa-share-nodes",
        "color": "#6b7280",
    }
    connected = account is not None
    can_fetch = platform in _FEED_CAPABLE_PLATFORMS
    posts: list[dict[str, Any]] = []
    next_cursor: str | None = None
    error: str | None = None
    status_text: str | None = None

    if not connected:
        status_text = "Not connected — link this channel in Settings."
    elif platform == INSTAGRAM_BETA_PLATFORM:
        status_text = "Beta is for messaging only — use Instagram (Meta) for feeds."
    elif not can_fetch:
        status_text = "Feed sync coming soon for this platform."
    elif platform == "instagram":
        posts, next_cursor, error = _fetch_instagram_feed(
            services,
            account,
            limit=limit,
            after=after,
        )

    posts = enrich_posts_with_links(services.db, account_id, platform, posts)

    return {
        "platform": platform,
        "label": meta["label"],
        "icon": meta["icon"],
        "color": meta["color"],
        "connected": connected,
        "can_fetch": connected and can_fetch and account.login_provider == "instagram",
        "connect_url": _instagram_connect_url(request) if platform == "instagram" else None,
        "status_text": status_text,
        "account": InstagramAccountOut.from_model(account) if account else None,
        "posts": posts,
        "next_cursor": next_cursor,
        "error": error,
    }


@router.get("")
def list_feeds(
    request: Request,
    platform: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=50),
    after: str | None = Query(default=None),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "feeds")
    merchant_id = require_merchant_account_id(user)
    accounts = list_merchant_connected_channels(services.db, merchant_id)

    platforms = _FEED_PLATFORMS
    if platform is not None:
        platform = normalize_platform(platform)
        platforms = (platform,)

    feeds = [
        _platform_feed_payload(
            p,
            accounts.get(p),
            request,
            services,
            limit=limit,
            after=after if p == platform else None,
            account_id=merchant_id,
        )
        for p in platforms
    ]

    connected_platforms = [p for p in _FEED_PLATFORMS if accounts.get(p) is not None]
    return {
        "feeds": feeds,
        "connected_count": len(connected_platforms),
        "connected_platforms": connected_platforms,
        "any_connected": bool(connected_platforms),
    }


@router.post("/post", status_code=status.HTTP_201_CREATED)
async def post_feed_media(
    request: Request,
    platform: str = Form(default="instagram"),
    caption: str | None = Form(default=None, max_length=2200),
    inventory_item_ids: str | None = Form(
        default=None,
        description="JSON array of inventory item ids to link after publish.",
    ),
    file: UploadFile = File(..., description="Photo or video to publish."),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Upload a photo or video and publish it to a connected social channel."""
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "feeds")
    merchant_id = require_merchant_account_id(user)
    platform = normalize_platform(platform)
    if platform != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only Instagram posting is supported right now.",
        )

    linked_item_ids: list[str] = []
    if inventory_item_ids:
        try:
            parsed = json.loads(inventory_item_ids)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="inventory_item_ids must be a JSON array.",
            ) from exc
        if not isinstance(parsed, list):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="inventory_item_ids must be a JSON array.",
            )
        linked_item_ids = [str(item_id).strip() for item_id in parsed if str(item_id).strip()]

    account = require_instagram_publish_account(services.db, user)
    upload = await save_feed_upload(merchant_id, file, uploader_id=user.id)
    result = await asyncio.to_thread(
        publish_instagram_media,
        services,
        account,
        upload["url"],
        content_type=upload["content_type"],
        caption=caption,
    )
    media_id = str(result.get("media_id") or result.get("post", {}).get("id") or "")
    if media_id and linked_item_ids:
        linked = add_post_links(
            services.db,
            account_id=merchant_id,
            platform=platform,
            external_post_id=media_id,
            inventory_item_ids=linked_item_ids,
        )
        if result.get("post"):
            result["post"]["linked_inventory"] = linked
    return result


@router.get("/posts/{platform}/{post_id}")
def get_feed_post_detail(
    platform: str,
    post_id: str,
    limit: int = Query(default=25, ge=1, le=50),
    after: str | None = Query(default=None),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Load live engagement (likes, comments) for one social post."""
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "feeds")
    merchant_id = require_merchant_account_id(user)
    platform = normalize_platform(platform)

    if platform != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Post detail is only supported for Instagram right now.",
        )

    account = get_merchant_instagram_account(services.db, merchant_id)
    if account is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Connect your shop's Instagram account in Settings first.",
        )
    if account.login_provider != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Connect with Meta OAuth to load Instagram post interactions.",
        )
    if not account.instagram_user_id or str(account.instagram_user_id).startswith("manual_"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Instagram account is not fully linked yet.",
        )

    if after:
        return fetch_instagram_post_comments(
            services,
            account,
            post_id=post_id,
            comment_limit=limit,
            comment_after=after,
        )

    return fetch_instagram_post_detail(
        services,
        account,
        account_id=merchant_id,
        post_id=post_id,
        comment_limit=limit,
        comment_after=after,
    )


@router.get("/posts/{platform}/{post_id}/insights")
def get_feed_post_insights(
    platform: str,
    post_id: str,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Load Instagram insights for one post (lazy-loaded by the feeds UI)."""
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "feeds")
    merchant_id = require_merchant_account_id(user)
    platform = normalize_platform(platform)

    if platform != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Post insights are only supported for Instagram right now.",
        )

    account = get_merchant_instagram_account(services.db, merchant_id)
    if account is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Connect your shop's Instagram account in Settings first.",
        )
    if account.login_provider != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Connect with Meta OAuth to load Instagram post insights.",
        )
    if not account.instagram_user_id or str(account.instagram_user_id).startswith("manual_"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Instagram account is not fully linked yet.",
        )

    return fetch_instagram_post_insights(
        services,
        account,
        post_id=post_id,
    )


class LinkFeedPostRequest(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)


@router.put("/posts/{platform}/{post_id}/link")
def link_feed_post(
    platform: str,
    post_id: str,
    payload: LinkFeedPostRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Associate a social post with one of the merchant's inventory items."""
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "feeds")
    merchant_id = require_merchant_account_id(user)
    platform = normalize_platform(platform)

    linked = add_post_link(
        services.db,
        account_id=merchant_id,
        platform=platform,
        external_post_id=post_id,
        inventory_item_id=payload.inventory_item_id,
    )
    return {
        "message": "Product linked to post.",
        "linked_inventory": linked,
    }


@router.delete("/posts/{platform}/{post_id}/link")
def unlink_feed_post(
    platform: str,
    post_id: str,
    request: Request,
    inventory_item_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Remove one inventory link from a social post."""
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "feeds")
    merchant_id = require_merchant_account_id(user)
    platform = normalize_platform(platform)

    linked = remove_post_link(
        services.db,
        account_id=merchant_id,
        platform=platform,
        external_post_id=post_id,
        inventory_item_id=inventory_item_id,
    )
    return {
        "message": "Product unlinked from post.",
        "linked_inventory": linked,
    }
