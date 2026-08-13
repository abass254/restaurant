"""Fetch live Instagram post details and comments for the feeds UI."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app.dependencies import ServiceContainer
from app.models import InstagramAccount
from app.services.feed_insights_service import apply_insights_to_post, fetch_media_insights
from app.services.feed_post_link_service import enrich_posts_with_links
from app.services.social_publish_service import normalize_instagram_post


def _normalize_comment(raw: dict[str, Any]) -> dict[str, Any]:
    from_user = raw.get("from") if isinstance(raw.get("from"), dict) else {}
    username = raw.get("username") or from_user.get("username")
    replies_block = raw.get("replies")
    replies: list[dict[str, Any]] = []
    if isinstance(replies_block, dict):
        replies = [
            _normalize_comment(item)
            for item in (replies_block.get("data") or [])
            if isinstance(item, dict)
        ]
    return {
        "id": str(raw.get("id") or ""),
        "text": raw.get("text"),
        "username": username,
        "timestamp": raw.get("timestamp"),
        "replies": replies,
    }


def _fetch_comments(
    services: ServiceContainer,
    *,
    post_id: str,
    token: str,
    comment_limit: int,
    comment_after: str | None,
) -> tuple[list[dict[str, Any]], str | None, str | None]:
    try:
        payload = services.instagram_api.get_media_comments(
            post_id,
            token,
            limit=comment_limit,
            after=comment_after,
        )
        comments = [
            _normalize_comment(item)
            for item in (payload.get("data") or [])
            if isinstance(item, dict)
        ]
        paging = payload.get("paging") or {}
        cursors = paging.get("cursors") or {}
        next_comment_cursor = cursors.get("after") if paging.get("next") else None
        return comments, next_comment_cursor, None
    except Exception as exc:
        return [], None, str(exc)


def fetch_instagram_post_comments(
    services: ServiceContainer,
    account: InstagramAccount,
    *,
    post_id: str,
    comment_limit: int = 25,
    comment_after: str | None = None,
) -> dict[str, Any]:
    """Fetch only the next page of comments (used for pagination)."""
    token = account.access_token()
    comments, next_comment_cursor, comments_error = _fetch_comments(
        services,
        post_id=post_id,
        token=token,
        comment_limit=comment_limit,
        comment_after=comment_after,
    )
    return {
        "comments": comments,
        "next_comment_cursor": next_comment_cursor,
        "comments_error": comments_error,
    }


def fetch_instagram_post_detail(
    services: ServiceContainer,
    account: InstagramAccount,
    *,
    account_id: str,
    post_id: str,
    comment_limit: int = 25,
    comment_after: str | None = None,
) -> dict[str, Any]:
    token = account.access_token()

    def load_media() -> tuple[dict[str, Any], str | None]:
        try:
            return services.instagram_api.get_media(post_id, token), None
        except Exception as exc:
            return {"id": post_id}, str(exc)

    with ThreadPoolExecutor(max_workers=2) as pool:
        media_future = pool.submit(load_media)
        comments_future = pool.submit(
            _fetch_comments,
            services,
            post_id=post_id,
            token=token,
            comment_limit=comment_limit,
            comment_after=comment_after,
        )
        media_raw, media_error = media_future.result()
        comments, next_comment_cursor, comments_error = comments_future.result()

    post = normalize_instagram_post(media_raw)
    enriched = enrich_posts_with_links(
        services.db,
        account_id,
        "instagram",
        [post],
    )[0]

    return {
        "post": enriched,
        "comments": comments,
        "next_comment_cursor": next_comment_cursor,
        "insights": None,
        "insights_error": None,
        "media_error": media_error,
        "comments_error": comments_error,
        "interactions_note": (
            "Instagram insights are organic-only unless total metrics are available for "
            "your account. Counts can take up to 48 hours to update, and individual "
            "likers are not exposed by the API."
        ),
    }


def fetch_instagram_post_insights(
    services: ServiceContainer,
    account: InstagramAccount,
    *,
    post_id: str,
) -> dict[str, Any]:
    token = account.access_token()
    media_error: str | None = None

    try:
        media_raw = services.instagram_api.get_media(post_id, token)
    except Exception as exc:
        media_error = str(exc)
        media_raw = {"id": post_id}

    post = normalize_instagram_post(media_raw)
    insights, insights_error = fetch_media_insights(
        services,
        media_id=post_id,
        access_token=token,
        media_type=str(post.get("media_type") or "IMAGE"),
        media_raw=media_raw if isinstance(media_raw, dict) else None,
        detailed=True,
    )
    post = apply_insights_to_post(post, insights)

    return {
        "post": post,
        "insights": insights,
        "insights_error": insights_error,
        "media_error": media_error,
    }
