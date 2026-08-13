from __future__ import annotations

import re

from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit


def _normalize_search_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _search_tokens(query: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", _normalize_search_text(query)) if token]


def score_catalog_match(query: str, item: CatalogItem) -> CatalogSearchHit | None:
    normalized_query = _normalize_search_text(query)
    if not normalized_query:
        return None

    name = _normalize_search_text(item.name)
    category = _normalize_search_text((item.category or "").replace("_", " ").replace("-", " "))
    brand = _normalize_search_text(item.brand)
    description = _normalize_search_text(item.description)
    tokens = _search_tokens(normalized_query)
    if not tokens:
        return None

    score = 0.0
    reasons: list[str] = []

    if normalized_query == name:
        score += 200
        reasons.append("exact_name")
    elif normalized_query in name:
        score += 120
        reasons.append("name")
    elif name in normalized_query:
        score += 80
        reasons.append("name")

    if category:
        if normalized_query == category:
            score += 150
            reasons.append("category")
        elif normalized_query in category or category in normalized_query:
            score += 110
            reasons.append("category")

    if brand and normalized_query in brand:
        score += 70
        reasons.append("brand")

    for token in tokens:
        min_len = 2 if len(tokens) == 1 else 3
        if len(token) < min_len:
            continue
        if token in name.split():
            score += 45
            if "name" not in reasons:
                reasons.append("name")
        if category and token in category.split():
            score += 40
            if "category" not in reasons:
                reasons.append("category")
        if token in name:
            score += 35
            if "name" not in reasons:
                reasons.append("name")
        if category and token in category:
            score += 35
            if "category" not in reasons:
                reasons.append("category")
        if brand and token in brand:
            score += 25
            if "brand" not in reasons:
                reasons.append("brand")
        if token in description:
            score += 12
            if "description" not in reasons:
                reasons.append("description")

    if score <= 0:
        return None

    return CatalogSearchHit(
        item=item,
        score=score,
        match_reasons=tuple(dict.fromkeys(reasons)),
    )


def search_catalog_items(
    query: str,
    items: list[CatalogItem],
    *,
    limit: int = 8,
) -> list[CatalogSearchHit]:
    hits: list[CatalogSearchHit] = []
    for item in items:
        hit = score_catalog_match(query, item)
        if hit is not None:
            hits.append(hit)
    hits.sort(key=lambda row: (-row.score, row.item.name))
    return hits[: max(1, min(limit, 25))]


def match_item_from_text(text: str, items: list[CatalogItem]) -> CatalogItem | None:
    raw = (text or "").strip()
    if not raw:
        return None

    index_match = re.match(r"^\s*(\d+)\s*\.?$", raw)
    if index_match:
        idx = int(index_match.group(1))
        if 1 <= idx <= len(items):
            return items[idx - 1]

    hits = search_catalog_items(raw, items, limit=8)
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0].item

    top = hits[0]
    second = hits[1]
    if "exact_name" in top.match_reasons:
        return top.item
    if top.score >= second.score + 25:
        return top.item
    return None
