"""Server-side checks for a Google Maps browser API key."""

from __future__ import annotations

from typing import Any

import httpx

PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
MAPS_JS_URL = "https://maps.googleapis.com/maps/api/js"


def verify_google_maps_api_key(api_key: str) -> dict[str, Any]:
    """Probe the APIs used by location pickers (Places, Geocoding, Maps JS)."""
    trimmed = api_key.strip()
    if not trimmed:
        raise ValueError("API key is required.")

    checks: list[dict[str, Any]] = []

    with httpx.Client(timeout=20.0) as client:
        checks.append(_check_places_autocomplete(client, trimmed))
        checks.append(_check_geocoding(client, trimmed))
        checks.append(_check_maps_javascript(client, trimmed))

    required = {"places_autocomplete", "maps_javascript"}
    failed_checks = [check for check in checks if not check["ok"]]
    referrer_blocked_only = bool(failed_checks) and all(
        _is_referrer_restriction_error(check["detail"]) for check in failed_checks
    )

    if referrer_blocked_only:
        for check in checks:
            if not check["ok"]:
                check["ok"] = True
                check["detail"] = (
                    "Skipped server-side probe — key is restricted to browser referrers "
                    "(recommended). Use Live preview on this page to confirm it works."
                )
        ok = True
        message = (
            "API key uses browser referrer restrictions, so it cannot be verified from the "
            "server. That is expected and secure. Try the Live preview below to confirm "
            "autocomplete and map display."
        )
    else:
        ok = all(check["ok"] for check in checks if check["id"] in required)
        failed = [check["label"] for check in failed_checks]

        if ok and all(check["ok"] for check in checks):
            message = (
                "Google Maps API key is permitted for autocomplete, geocoding, and map display."
            )
        elif ok:
            message = (
                "Autocomplete and map display work, but some APIs are blocked: "
                + ", ".join(failed)
                + ". Enable them in Google Cloud Console and ensure billing is on."
            )
        else:
            message = (
                "The API key cannot power location pickers yet. "
                + "; ".join(check["detail"] for check in failed_checks)
            )

    return {"ok": ok, "message": message, "checks": checks}


def _is_referrer_restriction_error(detail: str) -> bool:
    lowered = detail.lower()
    return (
        "referer <empty>" in lowered
        or "referrer <empty>" in lowered
        or "referer restrictions" in lowered
        or "referrer restrictions" in lowered
        or "referernotallowed" in lowered
    )


def _check_places_autocomplete(client: httpx.Client, api_key: str) -> dict[str, Any]:
    label = "Places API (New) autocomplete"
    try:
        response = client.post(
            PLACES_AUTOCOMPLETE_URL,
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": api_key,
            },
            json={"input": "Nairobi", "includedRegionCodes": ["KE"]},
        )
    except httpx.HTTPError as exc:
        return _check("places_autocomplete", label, False, f"Request failed: {exc}")

    if response.status_code == 200:
        suggestions = response.json().get("suggestions") or []
        if suggestions:
            return _check(
                "places_autocomplete",
                label,
                True,
                f"Returned {len(suggestions)} suggestion(s).",
            )
        return _check(
            "places_autocomplete",
            label,
            False,
            "Request succeeded but no suggestions were returned.",
        )

    detail = _extract_google_error(response)
    return _check("places_autocomplete", label, False, detail)


def _check_geocoding(client: httpx.Client, api_key: str) -> dict[str, Any]:
    label = "Geocoding API"
    try:
        response = client.get(
            GEOCODE_URL,
            params={"address": "Nairobi", "key": api_key},
        )
    except httpx.HTTPError as exc:
        return _check("geocoding", label, False, f"Request failed: {exc}")

    payload = response.json()
    status = str(payload.get("status") or "")
    if status == "OK":
        return _check("geocoding", label, True, "Geocoding request succeeded.")

    detail = payload.get("error_message") or status or response.text[:200]
    return _check("geocoding", label, False, str(detail))


def _check_maps_javascript(client: httpx.Client, api_key: str) -> dict[str, Any]:
    label = "Maps JavaScript API"
    try:
        response = client.get(MAPS_JS_URL, params={"key": api_key})
    except httpx.HTTPError as exc:
        return _check("maps_javascript", label, False, f"Request failed: {exc}")

    body = response.text
    if response.status_code != 200:
        return _check("maps_javascript", label, False, f"HTTP {response.status_code}")

    for marker in (
        "Google Maps JavaScript API error: InvalidKeyMapError",
        "Google Maps JavaScript API error: ApiNotActivatedMapError",
        "Google Maps JavaScript API error: RefererNotAllowedMapError",
        "Google Maps JavaScript API error: ApiTargetBlockedMapError",
    ):
        if marker in body:
            return _check("maps_javascript", label, False, marker.split("error: ", 1)[-1])

    if "importLibrary" in body or "google.maps" in body:
        return _check("maps_javascript", label, True, "Maps JavaScript bundle loaded.")

    return _check(
        "maps_javascript",
        label,
        False,
        "Unexpected Maps JavaScript response.",
    )


def _extract_google_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:240] or f"HTTP {response.status_code}"

    error = payload.get("error") or {}
    message = error.get("message") or payload.get("error_message")
    status = error.get("status")
    if message and status:
        return f"{status}: {message}"
    if message:
        return str(message)
    return response.text[:240] or f"HTTP {response.status_code}"


def _check(check_id: str, label: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"id": check_id, "label": label, "ok": ok, "detail": detail}
