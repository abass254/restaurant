"""Publish photos and videos to connected social channels (Instagram today)."""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import Settings
from app.dependencies import ServiceContainer
from app.models import InstagramAccount, User
from app.services.platform_instagram import require_merchant_instagram_account
from app.services.product_media_service import absolute_media_url

_VIDEO_MEDIA_TYPES = frozenset({"VIDEO", "REELS"})
_VIDEO_CONTAINER_POLL_INTERVAL_SEC = 3
_VIDEO_CONTAINER_TIMEOUT_SEC = 300
_META_CRAWLER_UA = (
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
)


def normalize_instagram_post(raw: dict[str, Any]) -> dict[str, Any]:
    media_type = str(raw.get("media_type") or "IMAGE").upper()
    raw_media_url = raw.get("media_url")
    thumbnail_url = raw.get("thumbnail_url")
    is_video = media_type in _VIDEO_MEDIA_TYPES
    return {
        "id": str(raw.get("id") or ""),
        "platform": "instagram",
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


def require_instagram_publish_account(db: Session, user: User) -> InstagramAccount:
    account = require_merchant_instagram_account(db, user)
    if account.login_provider != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Connect with Meta OAuth to post to Instagram.",
        )
    if not account.instagram_user_id or str(account.instagram_user_id).startswith("manual_"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Instagram account is not fully linked yet.",
        )
    token = account.access_token()
    if not token or token == "manual-placeholder-token":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="A valid Instagram access token is required.",
        )
    return account


def _absolute_public_media_url(media_url: str, settings: Settings) -> str:
    absolute_url = absolute_media_url(media_url, settings, for_instagram=True)
    if not absolute_url.startswith(("http://", "https://")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Could not build a public URL for this file.",
        )
    return absolute_url


def _verify_instagram_can_fetch_media(url: str, *, expect_video: bool) -> None:
    """Best-effort check that Meta's crawler can reach the hosted file."""
    expected_prefix = "video/" if expect_video else "image/"
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            headers = {"User-Agent": _META_CRAWLER_UA}
            response = client.head(url, headers=headers)
            if response.status_code in {405, 501} or response.status_code >= 400:
                response = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "Instagram cannot reach the uploaded file URL. "
                f"Check that {url} is publicly accessible. ({exc})"
            ),
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "Instagram cannot download the uploaded file "
                f"(HTTP {response.status_code}). Ensure /uploads is public and "
                "robots.txt allows the facebookexternalhit crawler."
            ),
        )

    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type.startswith("text/") or content_type in {"application/json", "text/html"}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "Instagram received HTML/JSON instead of a media file. "
                "The upload URL may not be publicly reachable."
            ),
        )
    if content_type and not content_type.startswith(expected_prefix):
        kind = "video" if expect_video else "JPEG photo"
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Instagram expects a publicly hosted {kind} file. "
                f"The URL returned Content-Type '{content_type}'."
            ),
        )


def _wait_for_video_container(
    services: ServiceContainer,
    container_id: str,
    token: str,
) -> None:
    deadline = time.monotonic() + _VIDEO_CONTAINER_TIMEOUT_SEC
    while time.monotonic() < deadline:
        payload = services.instagram_api.get_media_container_status(container_id, token)
        status_code = str(payload.get("status_code") or "").upper()
        if status_code == "FINISHED":
            return
        if status_code in {"ERROR", "EXPIRED"}:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail="Instagram could not process this video.",
            )
        time.sleep(_VIDEO_CONTAINER_POLL_INTERVAL_SEC)
    raise HTTPException(
        status.HTTP_504_GATEWAY_TIMEOUT,
        detail="Instagram is still processing the video. Try again in a few minutes.",
    )


def publish_instagram_media(
    services: ServiceContainer,
    account: InstagramAccount,
    media_url: str,
    *,
    content_type: str,
    caption: str | None = None,
) -> dict[str, Any]:
    """Publish one public photo or video URL to Instagram."""
    if content_type.startswith("video/"):
        return publish_instagram_video(
            services,
            account,
            media_url,
            caption=caption,
        )
    return publish_instagram_photo(
        services,
        account,
        media_url,
        caption=caption,
    )


def publish_instagram_photo(
    services: ServiceContainer,
    account: InstagramAccount,
    image_url: str,
    *,
    caption: str | None = None,
) -> dict[str, Any]:
    """Publish one public image URL to Instagram and return a feed-ready post."""
    absolute_url = _absolute_public_media_url(image_url, services.settings)
    _verify_instagram_can_fetch_media(absolute_url, expect_video=False)
    token = account.access_token()
    ig_user_id = str(account.instagram_user_id)
    cleaned_caption = caption.strip() if caption else None

    try:
        container = services.instagram_api.create_image_media_container(
            ig_user_id,
            absolute_url,
            token,
            caption=cleaned_caption,
        )
        creation_id = str(container.get("id") or "")
        if not creation_id:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail="Instagram did not return a media container id.",
            )
        published = services.instagram_api.publish_media_container(
            ig_user_id,
            creation_id,
            token,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not post to Instagram: {exc}",
        ) from exc

    media_id = str(published.get("id") or "")
    post = _fetch_instagram_post(services, media_id, token, cleaned_caption, absolute_url)
    return {
        "message": "Posted to Instagram.",
        "platform": "instagram",
        "media_id": media_id or None,
        "permalink": post.get("permalink"),
        "post": post,
    }


def publish_instagram_video(
    services: ServiceContainer,
    account: InstagramAccount,
    video_url: str,
    *,
    caption: str | None = None,
    media_type: str = "REELS",
) -> dict[str, Any]:
    """Publish one public video URL to Instagram as a Reel."""
    absolute_url = _absolute_public_media_url(video_url, services.settings)
    _verify_instagram_can_fetch_media(absolute_url, expect_video=True)
    token = account.access_token()
    ig_user_id = str(account.instagram_user_id)
    cleaned_caption = caption.strip() if caption else None

    try:
        container = services.instagram_api.create_video_media_container(
            ig_user_id,
            absolute_url,
            token,
            caption=cleaned_caption,
            media_type=media_type,
        )
        creation_id = str(container.get("id") or "")
        if not creation_id:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail="Instagram did not return a video container id.",
            )
        _wait_for_video_container(services, creation_id, token)
        published = services.instagram_api.publish_media_container(
            ig_user_id,
            creation_id,
            token,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not post video to Instagram: {exc}",
        ) from exc

    media_id = str(published.get("id") or "")
    post = _fetch_instagram_post(
        services,
        media_id,
        token,
        cleaned_caption,
        absolute_url,
        media_type=media_type,
    )
    return {
        "message": "Posted video to Instagram.",
        "platform": "instagram",
        "media_id": media_id or None,
        "permalink": post.get("permalink"),
        "post": post,
    }


def _fetch_instagram_post(
    services: ServiceContainer,
    media_id: str,
    token: str,
    caption: str | None,
    fallback_media_url: str,
    *,
    media_type: str = "IMAGE",
) -> dict[str, Any]:
    fields = (
        "id,caption,media_type,media_url,thumbnail_url,"
        "timestamp,permalink,like_count,comments_count"
    )
    if media_id:
        try:
            detail = services.instagram_api.get(
                media_id,
                {"fields": fields, "access_token": token},
            )
            if detail.get("id"):
                return normalize_instagram_post(detail)
        except Exception:
            pass

    is_video = media_type in _VIDEO_MEDIA_TYPES
    return normalize_instagram_post(
        {
            "id": media_id or f"pending-{token[:8]}",
            "caption": caption,
            "media_type": media_type,
            "media_url": fallback_media_url if is_video else fallback_media_url,
            "thumbnail_url": None if is_video else None,
            "timestamp": None,
            "permalink": None,
            "like_count": None,
            "comments_count": None,
        }
    )
