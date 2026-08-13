"""Lightweight OpenAI API key verification for admin settings."""

from __future__ import annotations

import httpx


def verify_openai_api_key(
    api_key: str,
    *,
    api_base: str = "https://api.openai.com/v1",
    model: str = "gpt-4o-mini",
) -> dict:
    """Run a minimal chat completion to confirm the key works."""
    key = api_key.strip()
    if not key:
        raise ValueError("API key is required.")

    url = f"{api_base.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
        "max_tokens": 5,
        "temperature": 0,
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(url, headers=headers, json=body)
    except httpx.RequestError as exc:
        return {
            "ok": False,
            "message": f"Could not reach OpenAI: {exc}",
            "model": model,
        }

    if response.status_code == 401:
        return {
            "ok": False,
            "message": "Invalid API key. Check the key from platform.openai.com.",
            "model": model,
        }
    if response.status_code == 429:
        return {
            "ok": False,
            "message": "Rate limit hit. The key is valid but OpenAI is throttling requests.",
            "model": model,
        }
    if response.status_code >= 400:
        detail = response.text[:300]
        return {
            "ok": False,
            "message": f"OpenAI returned {response.status_code}: {detail}",
            "model": model,
        }

    data = response.json()
    used_model = (data.get("model") or model).strip()
    return {
        "ok": True,
        "message": f"ChatGPT API key verified (model: {used_model}).",
        "model": used_model,
    }
