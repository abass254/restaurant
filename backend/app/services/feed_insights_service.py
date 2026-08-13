"""Parse Instagram media insights into dashboard-friendly payloads."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app.dependencies import ServiceContainer

METRIC_LABELS: dict[str, str] = {
    "likes": "Likes",
    "comments": "Comments",
    "reach": "Reach",
    "saved": "Saves",
    "shares": "Shares",
    "views": "Views",
    "total_interactions": "Interactions",
    "profile_visits": "Profile visits",
    "profile_activity": "Profile activity",
    "follows": "Follows",
    "reposts": "Reposts",
    "navigation": "Story navigation",
    "link_clicks": "Link clicks",
    "ig_reels_avg_watch_time": "Avg watch time",
    "ig_reels_video_view_total_time": "Total watch time",
    "reels_skip_rate": "Skip rate",
    "crossposted_views": "Crossposted views",
    "facebook_views": "Facebook views",
    "total_likes": "Total likes (all surfaces)",
    "total_comments": "Total comments (all surfaces)",
    "total_views": "Total views (all surfaces)",
}

PROFILE_ACTIVITY_LABELS: dict[str, str] = {
    "bio_link_clicked": "Bio link clicks",
    "call": "Call clicks",
    "direction": "Direction clicks",
    "email": "Email clicks",
    "text": "Text clicks",
    "other": "Other profile clicks",
}

NAVIGATION_LABELS: dict[str, str] = {
    "tap_forward": "Tap forward",
    "tap_back": "Tap back",
    "tap_exit": "Tap exit",
    "swipe_forward": "Swipe forward",
    "swipe_back": "Swipe back",
    "tap_forward_swipe_forward": "Tap or swipe forward",
}

FOLLOWER_TYPE_LABELS: dict[str, str] = {
    "follower": "Followers",
    "non_follower": "Non-followers",
    "unknown": "Unknown",
}

MEDIA_PRODUCT_TYPE_LABELS: dict[str, str] = {
    "ad": "Ads",
    "feed": "Feed",
    "reels": "Reels",
    "story": "Stories",
    "igtv": "IGTV",
}

MEDIA_FIELD_TO_METRIC: dict[str, str] = {
    "reposts_count": "reposts",
    "saved_count": "saved",
    "shares_count": "shares",
    "total_like_count": "total_likes",
    "total_comments_count": "total_comments",
    "total_views_count": "total_views",
    "view_count": "views",
}

METRIC_DISPLAY_ORDER: list[str] = [
    "views",
    "reach",
    "likes",
    "comments",
    "saved",
    "shares",
    "reposts",
    "total_interactions",
    "ig_reels_avg_watch_time",
    "ig_reels_video_view_total_time",
    "reels_skip_rate",
    "crossposted_views",
    "facebook_views",
    "profile_visits",
    "follows",
    "profile_activity",
    "navigation",
    "link_clicks",
    "total_likes",
    "total_comments",
    "total_views",
]

DURATION_METRICS = frozenset({"ig_reels_avg_watch_time", "ig_reels_video_view_total_time"})
PERCENT_METRICS = frozenset({"reels_skip_rate"})


def metrics_for_media(media_type: str, media_product_type: str | None = None) -> list[str]:
    normalized = str(media_type or "IMAGE").upper()
    product = str(media_product_type or normalized).upper()

    if normalized == "STORY" or product == "STORY":
        return [
            "reach",
            "views",
            "shares",
            "total_interactions",
            "profile_visits",
            "navigation",
            "link_clicks",
        ]

    if normalized == "REELS" or product == "REELS":
        return [
            "comments",
            "likes",
            "reach",
            "saved",
            "shares",
            "views",
            "total_interactions",
            "profile_visits",
            "ig_reels_avg_watch_time",
            "ig_reels_video_view_total_time",
            "reels_skip_rate",
            "crossposted_views",
            "facebook_views",
        ]

    if normalized == "VIDEO" and product == "FEED":
        return [
            "reach",
            "saved",
            "likes",
            "comments",
            "shares",
            "views",
            "total_interactions",
            "profile_visits",
            "follows",
        ]

    if normalized == "CAROUSEL_ALBUM":
        return [
            "reach",
            "saved",
            "shares",
            "follows",
            "profile_visits",
            "likes",
            "comments",
            "views",
            "total_interactions",
            "profile_activity",
        ]

    return [
        "likes",
        "comments",
        "reach",
        "saved",
        "shares",
        "views",
        "total_interactions",
        "profile_visits",
        "profile_activity",
        "follows",
    ]


def optional_insights_metrics() -> list[str]:
    """Metrics that may be unavailable depending on login type or account features."""
    return ["reposts", "total_likes", "total_comments", "total_views"]


def _breakdown_label(metric_name: str, key: str) -> str:
    normalized = key.lower()
    if metric_name == "profile_activity":
        return PROFILE_ACTIVITY_LABELS.get(normalized, key.replace("_", " ").title())
    if metric_name == "navigation":
        return NAVIGATION_LABELS.get(normalized, key.replace("_", " ").title())
    if normalized in FOLLOWER_TYPE_LABELS:
        return FOLLOWER_TYPE_LABELS[normalized]
    if normalized in MEDIA_PRODUCT_TYPE_LABELS:
        return MEDIA_PRODUCT_TYPE_LABELS[normalized]
    return key.replace("_", " ").title()


def _metric_numeric(raw: dict[str, Any]) -> int | float | None:
    total_value = raw.get("total_value")
    if isinstance(total_value, dict) and total_value.get("value") is not None:
        try:
            value = total_value["value"]
            if isinstance(value, float):
                return value
            return int(value)
        except (TypeError, ValueError):
            return None
    values = raw.get("values") or []
    if values and isinstance(values[0], dict) and values[0].get("value") is not None:
        try:
            value = values[0]["value"]
            if isinstance(value, float):
                return value
            return int(value)
        except (TypeError, ValueError):
            return None
    return None


def _format_duration_ms(value: int | float) -> str:
    seconds = float(value) / 1000.0
    if seconds >= 60:
        minutes = int(seconds // 60)
        remainder = seconds % 60
        return f"{minutes}m {remainder:.0f}s"
    if seconds >= 10:
        return f"{seconds:.0f}s"
    return f"{seconds:.1f}s"


def _format_duration_seconds(value: int | float) -> str:
    seconds = float(value)
    if seconds >= 3600:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{hours}h {minutes}m"
    if seconds >= 60:
        minutes = int(seconds // 60)
        remainder = seconds % 60
        return f"{minutes}m {remainder:.0f}s"
    if seconds >= 10:
        return f"{seconds:.0f}s"
    return f"{seconds:.1f}s"


def _format_metric_display(name: str, value: int | float | None) -> str | None:
    if value is None:
        return None
    if name in DURATION_METRICS:
        # Meta returns Reels watch-time metrics in milliseconds.
        return _format_duration_ms(value)
    if name in PERCENT_METRICS:
        numeric = float(value)
        if numeric <= 1:
            numeric *= 100
        return f"{numeric:.1f}%"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:,.1f}"
    return f"{int(value):,}"


def _metric_breakdown(raw: dict[str, Any], *, metric_name: str) -> list[dict[str, Any]]:
    total_value = raw.get("total_value")
    if not isinstance(total_value, dict):
        return []
    breakdowns = total_value.get("breakdowns") or []
    out: list[dict[str, Any]] = []
    for block in breakdowns:
        if not isinstance(block, dict):
            continue
        for result in block.get("results") or []:
            if not isinstance(result, dict):
                continue
            dimension_values = result.get("dimension_values") or []
            key = str(dimension_values[0] if dimension_values else "other").lower()
            value = result.get("value")
            if value is None:
                continue
            try:
                numeric: int | float = int(value)
            except (TypeError, ValueError):
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    continue
            label = _breakdown_label(metric_name, key)
            out.append(
                {
                    "label": label,
                    "value": numeric,
                    "display_value": _format_metric_display(metric_name, numeric),
                }
            )
    return out


def _upsert_metric(
    metrics: list[dict[str, Any]],
    by_name: dict[str, int | float | None],
    *,
    name: str,
    value: int | float | None,
    breakdown: list[dict[str, Any]] | None = None,
) -> None:
    for item in metrics:
        if item.get("name") != name:
            continue
        if value is not None:
            item["value"] = value
            item["display_value"] = _format_metric_display(name, value)
            by_name[name] = value
        if breakdown:
            existing = item.get("breakdown") or []
            item["breakdown"] = existing + breakdown
        return

    if value is None and not breakdown:
        return
    by_name[name] = value
    metrics.append(
        {
            "name": name,
            "label": METRIC_LABELS.get(name, name.replace("_", " ").title()),
            "value": value,
            "display_value": _format_metric_display(name, value),
            "breakdown": breakdown or [],
        }
    )


def _sort_metrics(metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    order = {name: index for index, name in enumerate(METRIC_DISPLAY_ORDER)}

    def sort_key(item: dict[str, Any]) -> tuple[int, str]:
        name = str(item.get("name") or "")
        return (order.get(name, len(METRIC_DISPLAY_ORDER)), name)

    return sorted(metrics, key=sort_key)


def normalize_insights_payload(payload: dict[str, Any]) -> dict[str, Any]:
    metrics: list[dict[str, Any]] = []
    by_name: dict[str, int | float | None] = {}
    for raw in payload.get("data") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "")
        if not name:
            continue
        value = _metric_numeric(raw)
        breakdown = _metric_breakdown(raw, metric_name=name)
        _upsert_metric(metrics, by_name, name=name, value=value, breakdown=breakdown)
    sorted_metrics = _sort_metrics(metrics)
    return {"metrics": sorted_metrics, "by_name": by_name}


def _merge_media_field_metrics(
    metrics: list[dict[str, Any]],
    by_name: dict[str, int | float | None],
    media_raw: dict[str, Any] | None,
) -> None:
    if not media_raw:
        return
    for field_name, metric_name in MEDIA_FIELD_TO_METRIC.items():
        if metric_name in by_name and by_name[metric_name] is not None:
            continue
        raw_value = media_raw.get(field_name)
        if raw_value is None:
            continue
        try:
            value: int | float = int(raw_value)
        except (TypeError, ValueError):
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                continue
        _upsert_metric(metrics, by_name, name=metric_name, value=value)


def _fetch_metric_batch(
    services: ServiceContainer,
    *,
    media_id: str,
    access_token: str,
    metrics: list[str],
    breakdown: str | None = None,
) -> list[dict[str, Any]]:
    if not metrics:
        return []
    payload = services.instagram_api.get_media_insights(
        media_id,
        access_token,
        metrics=metrics,
        breakdown=breakdown,
    )
    return [item for item in (payload.get("data") or []) if isinstance(item, dict)]


def _fetch_metrics_resilient(
    services: ServiceContainer,
    *,
    media_id: str,
    access_token: str,
    metrics: list[str],
) -> list[dict[str, Any]]:
    deduped = list(dict.fromkeys(metrics))
    if not deduped:
        return []

    try:
        return _fetch_metric_batch(
            services,
            media_id=media_id,
            access_token=access_token,
            metrics=deduped,
        )
    except Exception:
        collected: list[dict[str, Any]] = []

        def fetch_one(metric: str) -> list[dict[str, Any]]:
            try:
                return _fetch_metric_batch(
                    services,
                    media_id=media_id,
                    access_token=access_token,
                    metrics=[metric],
                )
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=min(len(deduped), 6)) as pool:
            for batch in pool.map(fetch_one, deduped):
                collected.extend(batch)
        return collected


def _fetch_breakdown_metric(
    services: ServiceContainer,
    *,
    media_id: str,
    access_token: str,
    metric: str,
    breakdown: str,
) -> list[dict[str, Any]]:
    try:
        return _fetch_metric_batch(
            services,
            media_id=media_id,
            access_token=access_token,
            metrics=[metric],
            breakdown=breakdown,
        )
    except Exception:
        return []


def fetch_media_insights(
    services: ServiceContainer,
    *,
    media_id: str,
    access_token: str,
    media_type: str,
    media_raw: dict[str, Any] | None = None,
    detailed: bool = True,
) -> tuple[dict[str, Any] | None, str | None]:
    product_type = None
    if media_raw:
        product_type = media_raw.get("media_product_type") or media_raw.get("media_type")

    metrics = metrics_for_media(media_type, str(product_type) if product_type else None)
    base_metrics = [metric for metric in metrics if metric != "profile_activity"]
    optional_metrics = [
        metric for metric in optional_insights_metrics() if metric not in base_metrics
    ]

    combined: dict[str, Any] = {"data": []}
    tasks: dict[str, Any] = {
        "base": (base_metrics, None),
    }
    if detailed:
        if optional_metrics:
            tasks["optional"] = (optional_metrics, None)
        if "profile_activity" in metrics:
            tasks["profile_activity"] = (["profile_activity"], "action_type")
        if "views" in metrics:
            tasks["views"] = (["views"], "follow_type")
        if "navigation" in metrics:
            tasks["navigation"] = (["navigation"], "story_navigation_action_type")

    def run_task(task_metrics: list[str], breakdown: str | None) -> list[dict[str, Any]]:
        if breakdown:
            return _fetch_breakdown_metric(
                services,
                media_id=media_id,
                access_token=access_token,
                metric=task_metrics[0],
                breakdown=breakdown,
            )
        return _fetch_metrics_resilient(
            services,
            media_id=media_id,
            access_token=access_token,
            metrics=task_metrics,
        )

    with ThreadPoolExecutor(max_workers=min(len(tasks), 4)) as pool:
        futures = {
            key: pool.submit(run_task, task_metrics, breakdown)
            for key, (task_metrics, breakdown) in tasks.items()
        }
        for future in futures.values():
            combined["data"].extend(future.result())

    normalized = normalize_insights_payload(combined)
    _merge_media_field_metrics(normalized["metrics"], normalized["by_name"], media_raw)
    normalized["metrics"] = _sort_metrics(normalized["metrics"])

    if not normalized["metrics"]:
        return None, "Instagram insights are not available for this post yet."

    return normalized, None


def apply_insights_to_post(post: dict[str, Any], insights: dict[str, Any] | None) -> dict[str, Any]:
    if not insights:
        return post
    by_name = insights.get("by_name") or {}
    updated = dict(post)
    if by_name.get("likes") is not None:
        updated["like_count"] = int(by_name["likes"])
    if by_name.get("comments") is not None:
        updated["comments_count"] = int(by_name["comments"])
    return updated
