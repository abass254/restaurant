"""Normalize and match product barcodes / SKUs for stock tools and POS."""

from __future__ import annotations

from typing import Any


def normalize_scan_value(value: str | None) -> str:
    if not value:
        return ""
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def product_barcode_candidates(product: Any | None) -> list[str]:
    """Collect sku, product_code, and attributes.barcode from a Product-like object."""
    if product is None:
        return []
    candidates: list[str] = []
    for raw in (getattr(product, "product_code", None), getattr(product, "sku", None)):
        if isinstance(raw, str) and raw.strip():
            candidates.append(raw.strip())
    attrs = getattr(product, "attributes", None)
    if isinstance(attrs, dict):
        barcode = attrs.get("barcode")
        if isinstance(barcode, str) and barcode.strip():
            candidates.append(barcode.strip())
    return candidates


def code_matches_candidate(code: str, candidate: str) -> bool:
    raw_scan = code.strip().lower()
    normalized_scan = normalize_scan_value(code)
    if not raw_scan and not normalized_scan:
        return False

    raw = candidate.strip().lower()
    normalized = normalize_scan_value(candidate)
    if raw_scan == raw or (normalized_scan and normalized_scan == normalized):
        return True
    if raw and len(raw_scan) >= 4 and raw.startswith(raw_scan):
        return True
    if (
        normalized
        and len(normalized_scan) >= 4
        and normalized_scan in normalized
    ):
        return True
    return False


def product_matches_barcode(product: Any | None, code: str) -> bool:
    for candidate in product_barcode_candidates(product):
        if code_matches_candidate(code, candidate):
            return True
    return False
