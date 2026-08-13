"""
AI product-image generation with pluggable providers.

Providers (in order of preference under `auto` mode):

1. **OpenAI** (`gpt-image-1`) — paid, ~ $0.01–0.17/image, best quality + safety.
   Requires `OPENAI_API_KEY`.
2. **Cloudflare Workers AI** (`@cf/black-forest-labs/flux-1-schnell`) — 10 000
   requests/day on the free Workers plan. Requires `CLOUDFLARE_ACCOUNT_ID` +
   `CLOUDFLARE_API_TOKEN`.
3. **Pollinations** (`gen.pollinations.ai`) — low-cost, requires a free API
   key (set `POLLINATIONS_TOKEN`). As of 2026 anonymous image generation is no
   longer available, so a key is mandatory for this provider.
4. **Google Gemini** (`gemini-2.5-flash-image`) — requires a billed AI Studio
   project for image output (free tier IPM is 0). Requires `GEMINI_API_KEY`.
   On quota errors we automatically fall back to the next configured provider.

The same `Product.images` record shape is produced regardless of provider —
callers don't have to care which one ran.
"""

from __future__ import annotations

import base64
import logging
import secrets
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings, get_settings
from app.models import Product

logger = logging.getLogger(__name__)


class ImageGenerationDisabled(RuntimeError):
    """Feature flag off, or no usable provider configured."""


class ImageGenerationError(RuntimeError):
    """Upstream provider returned an error (network, quota, policy, etc.)."""


class ImageGenerationQuotaError(ImageGenerationError):
    """Upstream provider rejected the call due to rate limits or billing quota."""


# Style suffix appended to every prompt so output looks like a real catalog
# photo regardless of provider. Models that ignore long prompts (Pollinations
# at low budgets) still benefit from a few of these keywords.
_STYLE_SUFFIX = (
    "Professional studio product photograph on a clean white background. "
    "Soft, even lighting; sharp focus; centered composition; no text, "
    "no watermark, no logos other than the brand naturally on the product; "
    "e-commerce / catalog style; photorealistic."
)

_KNOWN_PROVIDERS = ("openai", "gemini", "cloudflare", "pollinations")


def _fresh_seed() -> int:
    """A random 32-bit seed for providers that accept one.

    Pollinations and Cloudflare cache / are deterministic by `(prompt, seed)`,
    so without a fresh seed every regenerate returns the same bytes — which
    then gets deduped on disk by our SHA1 filename scheme and looks like
    "nothing happened". Re-rolling the seed on every call fixes both at once.
    """
    return secrets.randbelow(2_147_483_647) + 1  # 1..2^31-1, avoid 0


def _trim(value: str | None, limit: int = 240) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) <= limit:
        return value
    cut = value[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def build_prompt_for_product(product: Product, override: str | None = None) -> str:
    """Compose the text prompt for a single product.

    If `override` is provided we still append the style suffix so the result
    looks like a real catalog photo rather than whatever the user typed.
    """
    if override and override.strip():
        return f"{override.strip()}\n\n{_STYLE_SUFFIX}"

    parts: list[str] = []
    subject = product.name.strip() if product.name else "product"
    if product.brand:
        parts.append(f"A photo of \"{subject}\" by {product.brand.strip()}.")
    else:
        parts.append(f"A photo of \"{subject}\".")

    if product.category:
        nice_cat = product.category.replace("_", " ").replace("-", " ").strip()
        if nice_cat:
            parts.append(f"Category: {nice_cat}.")

    description = _trim(product.description, 600)
    if description:
        parts.append(description)

    cat = (product.category or "").lower()
    if "drink" in cat or "beverage" in cat:
        parts.append("Bottle/can shown upright, label clearly visible.")
    elif "food" in cat or "snack" in cat:
        parts.append("Packaging or freshly prepared serving, appetising.")
    elif "fashion" in cat or "cloth" in cat or "apparel" in cat:
        parts.append("Garment laid flat or on a neutral mannequin, full item visible.")
    elif "phone" in cat or "electronic" in cat:
        parts.append("Device shown from the front, screen off, slight three-quarter angle.")

    parts.append(_STYLE_SUFFIX)
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Provider resolution
# ---------------------------------------------------------------------------

def _has_openai(s: Settings) -> bool:
    return bool(s.openai_api_key)


def _has_gemini(s: Settings) -> bool:
    return bool(s.gemini_api_key)


def _has_cloudflare(s: Settings) -> bool:
    return bool(s.cloudflare_account_id and s.cloudflare_api_token)


def _has_pollinations(s: Settings) -> bool:
    return bool(s.pollinations_token)


def _auto_provider_chain(settings: Settings) -> list[str]:
    """Providers to try under `auto`, highest quality first.

    Gemini image generation is last because the free tier no longer includes
    image output (quota limit 0); Pollinations/Cloudflare are more reliable
    without billing.
    """
    chain: list[str] = []
    if _has_openai(settings):
        chain.append("openai")
    if _has_cloudflare(settings):
        chain.append("cloudflare")
    if _has_pollinations(settings):
        chain.append("pollinations")
    if _has_gemini(settings):
        chain.append("gemini")
    if not chain:
        chain.append("pollinations")
    return chain


def _provider_chain(settings: Settings, *, pinned: str | None = None) -> list[str]:
    """Ordered providers for one generation call, with quota fallbacks."""
    if pinned:
        pinned = pinned.strip().lower()
        rest = [p for p in _auto_provider_chain(settings) if p != pinned]
        return [pinned, *rest]
    return _auto_provider_chain(settings)


def _resolve_provider(settings: Settings) -> str:
    """Return the primary provider id for this call (first in the chain).

    Order under `auto`: openai → cloudflare → pollinations → gemini.
    When the operator pins a provider explicitly we honour it as long as its
    credentials are present (otherwise we surface a clear `Disabled` error).
    """
    requested = (settings.image_generation_provider or "auto").strip().lower()

    if requested not in (*_KNOWN_PROVIDERS, "auto"):
        # Unknown provider name → fall back to auto rather than 500.
        logger.warning(
            "Unknown image_generation_provider=%r, falling back to auto.",
            requested,
        )
        requested = "auto"

    if requested == "openai":
        if not _has_openai(settings):
            raise ImageGenerationDisabled(
                "OpenAI is selected but OPENAI_API_KEY is not configured."
            )
        return "openai"
    if requested == "gemini":
        if not _has_gemini(settings):
            raise ImageGenerationDisabled(
                "Gemini is selected but GEMINI_API_KEY is not configured."
            )
        return "gemini"
    if requested == "cloudflare":
        if not _has_cloudflare(settings):
            raise ImageGenerationDisabled(
                "Cloudflare is selected but CLOUDFLARE_ACCOUNT_ID / "
                "CLOUDFLARE_API_TOKEN are not configured."
            )
        return "cloudflare"
    if requested == "pollinations":
        return "pollinations"

    return _auto_provider_chain(settings)[0]


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------

async def _generate_via_openai(
    prompt: str,
    *,
    settings: Settings,
    size: str,
    quality: str,
) -> tuple[bytes, str, dict[str, Any]]:
    payload = {
        "model": settings.openai_image_model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": quality,
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    url = f"{settings.openai_api_base.rstrip('/')}/images/generations"

    body = await _post_json(
        url,
        payload,
        headers=headers,
        timeout=settings.image_generation_timeout_seconds,
        provider_label="OpenAI",
    )

    try:
        b64 = body["data"][0]["b64_json"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ImageGenerationError(
            "OpenAI returned an unexpected payload."
        ) from exc

    image_bytes = _decode_b64(b64)
    meta = {
        "provider": "openai",
        "model": payload["model"],
        "size": payload["size"],
        "quality": payload["quality"],
        "revised_prompt": (body.get("data", [{}])[0] or {}).get("revised_prompt"),
    }
    return image_bytes, "image/png", meta


async def _generate_via_gemini(
    prompt: str,
    *,
    settings: Settings,
    size: str,
    quality: str,
) -> tuple[bytes, str, dict[str, Any]]:
    """Google Gemini image generation.

    Uses the AI Studio REST surface — the `?key=...` query auth keeps us off
    the OAuth tree and lets a single env var enable it.
    """
    model = settings.gemini_image_model
    url = (
        f"{settings.gemini_api_base.rstrip('/')}/models/{model}:generateContent"
        f"?key={settings.gemini_api_key}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }
    body = await _post_json(
        url,
        payload,
        headers={"Content-Type": "application/json"},
        timeout=settings.image_generation_timeout_seconds,
        provider_label="Gemini",
    )

    # Walk parts looking for the inline image. Gemini may return a leading
    # text part with commentary; we skip those.
    candidates = body.get("candidates") or []
    image_bytes: bytes | None = None
    content_type = "image/png"
    for part in (candidates[0].get("content", {}).get("parts", []) if candidates else []):
        inline = part.get("inlineData") or part.get("inline_data")
        if not inline:
            continue
        try:
            image_bytes = _decode_b64(inline.get("data") or "")
            content_type = (
                inline.get("mimeType") or inline.get("mime_type") or "image/png"
            )
            break
        except ImageGenerationError:
            continue

    if image_bytes is None:
        # Gemini sometimes refuses with a `promptFeedback.blockReason` — surface it.
        block = body.get("promptFeedback", {}).get("blockReason")
        if block:
            raise ImageGenerationError(
                f"Gemini refused this prompt ({block}). Try rewording it."
            )
        raise ImageGenerationError("Gemini returned no image data.")

    meta = {
        "provider": "gemini",
        "model": model,
        "size": size,  # informational; Gemini chooses its own dimensions.
    }
    return image_bytes, content_type, meta


async def _generate_via_cloudflare(
    prompt: str,
    *,
    settings: Settings,
    size: str,
    quality: str,
) -> tuple[bytes, str, dict[str, Any]]:
    """Cloudflare Workers AI — FLUX-1-schnell by default.

    Quality maps to step count: low=4 (the model's design point), medium=6,
    high=8. Past ~8 steps schnell stops improving, so we cap it.
    """
    model = settings.cloudflare_image_model
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run/{model}"
    )
    steps_for_quality = {"low": 4, "medium": 6, "high": 8}
    width, height = _parse_size(size, default=(1024, 1024))
    seed = _fresh_seed()
    payload = {
        "prompt": prompt,
        "steps": steps_for_quality.get(quality, 4),
        "width": width,
        "height": height,
        # Without a seed FLUX schnell at 4 steps is fairly deterministic for a
        # given prompt — re-rolling it makes regenerate actually regenerate.
        "seed": seed,
    }
    body = await _post_json(
        url,
        payload,
        headers={
            "Authorization": f"Bearer {settings.cloudflare_api_token}",
            "Content-Type": "application/json",
        },
        timeout=settings.image_generation_timeout_seconds,
        provider_label="Cloudflare",
    )

    if not body.get("success", True):
        errors = body.get("errors") or []
        msg = (
            errors[0].get("message")
            if errors and isinstance(errors[0], dict)
            else "Cloudflare Workers AI returned an error."
        )
        raise ImageGenerationError(msg)

    result = body.get("result") or {}
    b64 = result.get("image")
    if not b64:
        raise ImageGenerationError("Cloudflare returned no image data.")

    image_bytes = _decode_b64(b64)
    meta = {
        "provider": "cloudflare",
        "model": model,
        "size": f"{width}x{height}",
        "steps": payload["steps"],
        "seed": seed,
    }
    # Workers AI returns JPEG bytes for FLUX schnell.
    return image_bytes, "image/jpeg", meta


async def _generate_via_pollinations(
    prompt: str,
    *,
    settings: Settings,
    size: str,
    quality: str,
) -> tuple[bytes, str, dict[str, Any]]:
    """Pollinations image generation via the unified `gen.pollinations.ai` API.

    Pollinations retired the old key-free `image.pollinations.ai/prompt/...`
    endpoint; generation now goes through `gen.pollinations.ai/image/{prompt}`
    and requires an API key (free to create at enter.pollinations.ai). We send
    the key as a bearer token. `quality` maps to their `quality` knob; we also
    set `nofeed=true` so prompts stay out of the public feed.
    """
    width, height = _parse_size(size, default=(1024, 1024))
    seed = _fresh_seed()
    encoded = quote(prompt, safe="")
    quality_param = quality if quality in ("low", "medium", "high") else "medium"
    # Pollinations caches by `(prompt, seed)`. Without a fresh seed every
    # re-generate returns byte-for-byte the same image, which then dedupes on
    # our SHA1-named storage and looks like the "Generate" button is broken.
    url = (
        f"{settings.pollinations_base_url.rstrip('/')}/image/{encoded}"
        f"?width={width}&height={height}"
        f"&model={settings.pollinations_model}"
        f"&seed={seed}"
        f"&quality={quality_param}"
        f"&nofeed=true&safe=true"
    )

    # Generation now requires authentication — anonymous requests get a 401.
    # The operator supplies a free key via POLLINATIONS_TOKEN.
    headers: dict[str, str] = {}
    if settings.pollinations_token:
        headers["Authorization"] = f"Bearer {settings.pollinations_token}"

    timeout = httpx.Timeout(settings.image_generation_timeout_seconds, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("Pollinations network error: %s", exc)
        raise ImageGenerationError(
            "Could not reach the image generator. Try again shortly."
        ) from exc

    if response.status_code == 401:
        # No / invalid key. Pollinations no longer allows anonymous image
        # generation — tell the operator exactly how to fix it.
        raise ImageGenerationError(
            "Pollinations now requires a free API key for image generation. "
            "Sign up at enter.pollinations.ai, create a key, and set "
            "POLLINATIONS_TOKEN (or configure another provider such as "
            "OPENAI_API_KEY / GEMINI_API_KEY / Cloudflare)."
        )

    if response.status_code == 402:
        # Key is valid but out of budget — fall back to the next provider when
        # possible, and surface Pollinations' own balance message when we can't.
        detail = _pollinations_error_message(response)
        raise ImageGenerationQuotaError(
            detail
            or (
                f"Pollinations rejected the '{settings.pollinations_model}' model: "
                "your key's free pollen is exhausted or this model needs purchased "
                "pollen. Top up at enter.pollinations.ai or configure another "
                "provider (OPENAI_API_KEY / GEMINI_API_KEY / Cloudflare)."
            )
        )

    if response.status_code == 429:
        raise ImageGenerationQuotaError(
            "Pollinations rate limit exceeded. Try again shortly."
        )

    if response.status_code >= 400:
        raise ImageGenerationError(
            f"Pollinations returned HTTP {response.status_code}."
        )

    image_bytes = response.content
    if not image_bytes:
        raise ImageGenerationError("Pollinations returned an empty response.")

    content_type = response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    # Pollinations always returns one of the formats we already accept; if it
    # ever changes, `save_generated_image` will reject it with a 415 — better
    # than silently writing garbage.
    meta = {
        "provider": "pollinations",
        "model": settings.pollinations_model,
        "size": f"{width}x{height}",
        "seed": seed,
    }
    return image_bytes, content_type or "image/jpeg", meta


# ---------------------------------------------------------------------------
# Public dispatcher
# ---------------------------------------------------------------------------

async def generate_product_image(
    prompt: str,
    *,
    size: str | None = None,
    quality: str | None = None,
    provider: str | None = None,
) -> tuple[bytes, str, dict[str, Any]]:
    """Generate one product image; return `(image_bytes, content_type, meta)`.

    `provider` lets a caller pin a specific backend ("openai" etc.) for one
    request without flipping the global config. Default is "follow the
    config" (which itself is "auto" unless the operator pinned one).
    """
    settings = get_settings()

    if not settings.image_generation_enabled:
        raise ImageGenerationDisabled("AI image generation is disabled by config.")

    pinned: str | None = None
    if provider:
        pinned = provider.strip().lower()
        if pinned not in _KNOWN_PROVIDERS:
            raise ImageGenerationError(f"Unknown image provider '{pinned}'.")
        if pinned == "openai" and not _has_openai(settings):
            raise ImageGenerationDisabled("OPENAI_API_KEY is not configured.")
        if pinned == "gemini" and not _has_gemini(settings):
            raise ImageGenerationDisabled("GEMINI_API_KEY is not configured.")
        if pinned == "cloudflare" and not _has_cloudflare(settings):
            raise ImageGenerationDisabled(
                "Cloudflare Workers AI credentials are not configured."
            )
    elif (settings.image_generation_provider or "auto").strip().lower() != "auto":
        pinned = _resolve_provider(settings)

    chain = _provider_chain(settings, pinned=pinned)
    if not chain:
        raise ImageGenerationDisabled("No image generation provider is configured.")

    size = size or settings.image_generation_size
    quality = (quality or settings.image_generation_quality).lower()

    handlers = {
        "openai": _generate_via_openai,
        "gemini": _generate_via_gemini,
        "cloudflare": _generate_via_cloudflare,
        "pollinations": _generate_via_pollinations,
    }

    last_quota_error: ImageGenerationQuotaError | None = None
    provider_errors: list[str] = []
    for index, chosen in enumerate(chain):
        handler = handlers[chosen]
        try:
            result = await handler(prompt, settings=settings, size=size, quality=quality)
        except ImageGenerationQuotaError as exc:
            last_quota_error = exc
            provider_errors.append(f"{chosen}: {exc}")
            if index < len(chain) - 1:
                logger.warning(
                    "%s image quota exhausted, falling back to %s",
                    chosen,
                    chain[index + 1],
                )
                continue
            raise ImageGenerationQuotaError(
                provider_errors[-1]
                if len(provider_errors) == 1
                else "All image providers failed. "
                + " ".join(provider_errors)
            ) from exc
        else:
            if index > 0:
                logger.info(
                    "Image generation succeeded via %s after %s quota failure",
                    chosen,
                    chain[0],
                )
            return result

    raise last_quota_error or ImageGenerationError(
        "All configured image providers failed."
    )


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------

async def _post_json(
    url: str,
    payload: dict[str, Any],
    *,
    headers: dict[str, str],
    timeout: float,
    provider_label: str,
) -> dict[str, Any]:
    """POST JSON, return parsed body. Surfaces upstream error messages."""
    timeout_cfg = httpx.Timeout(timeout, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout_cfg) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("%s network error: %s", provider_label, exc)
        raise ImageGenerationError(
            f"Could not reach {provider_label}. Try again shortly."
        ) from exc

    if response.status_code >= 400:
        detail: str | None = None
        try:
            body = response.json()
            if isinstance(body, dict):
                # OpenAI: { "error": {"message": ...} }
                # Gemini: { "error": {"message": ...} }
                # Cloudflare: { "errors": [{"message": ...}], "success": false }
                detail = body.get("error", {}).get("message") if isinstance(
                    body.get("error"), dict
                ) else None
                if not detail:
                    errs = body.get("errors")
                    if isinstance(errs, list) and errs and isinstance(errs[0], dict):
                        detail = errs[0].get("message")
        except ValueError:
            detail = None
        logger.warning(
            "%s call failed: status=%s detail=%s",
            provider_label,
            response.status_code,
            detail,
        )
        message = detail or f"{provider_label} call failed (HTTP {response.status_code})."
        if response.status_code == 429 or _looks_like_quota_error(message):
            raise ImageGenerationQuotaError(message)
        raise ImageGenerationError(message)

    try:
        return response.json()
    except ValueError as exc:
        raise ImageGenerationError(
            f"{provider_label} returned a non-JSON response."
        ) from exc


def _pollinations_error_message(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return None


def _looks_like_quota_error(message: str) -> bool:
    lowered = message.lower()
    return any(
        token in lowered
        for token in (
            "quota",
            "rate limit",
            "rate-limit",
            "resource_exhausted",
            "too many requests",
            "exceeded your current quota",
        )
    )


def _decode_b64(b64: str) -> bytes:
    try:
        return base64.b64decode(b64)
    except (ValueError, TypeError) as exc:
        raise ImageGenerationError("Provider returned invalid image data.") from exc


def _parse_size(size: str | None, *, default: tuple[int, int]) -> tuple[int, int]:
    """Parse "1024x1024" into `(1024, 1024)`. Used by providers with
    width/height knobs."""
    if not size:
        return default
    try:
        w_str, h_str = size.lower().split("x", 1)
        w, h = int(w_str), int(h_str)
        if w <= 0 or h <= 0:
            return default
        return w, h
    except (ValueError, AttributeError):
        return default
