from __future__ import annotations

import json
from unittest.mock import MagicMock

import httpx

from app.services.google_maps_service import verify_google_maps_api_key


def _response(
    *,
    status_code: int = 200,
    json_data: dict | None = None,
    text: str | None = None,
) -> httpx.Response:
    request = httpx.Request("GET", "https://example.com")
    content = text if text is not None else json.dumps(json_data or {})
    return httpx.Response(status_code, request=request, content=content.encode())


def test_verify_google_maps_api_key_all_checks_pass(monkeypatch):
    client = MagicMock()
    client.post.return_value = _response(
        json_data={
            "suggestions": [
                {"placePrediction": {"placeId": "abc", "text": {"text": "Nairobi"}}}
            ]
        }
    )
    client.get.side_effect = [
        _response(json_data={"status": "OK", "results": [{"formatted_address": "Nairobi"}]}),
        _response(text="window.google=window.google||{};google.maps.importLibrary=function(){}"),
    ]
    monkeypatch.setattr(
        "app.services.google_maps_service.httpx.Client",
        lambda **kwargs: MagicMock(
            __enter__=lambda self: client,
            __exit__=lambda *args: None,
        ),
    )

    result = verify_google_maps_api_key("test-key")

    assert result["ok"] is True
    assert len(result["checks"]) == 3
    assert all(check["ok"] for check in result["checks"])


def test_verify_google_maps_api_key_geocoding_denied(monkeypatch):
    client = MagicMock()
    client.post.return_value = _response(
        json_data={"suggestions": [{"placePrediction": {"placeId": "abc"}}]}
    )
    client.get.side_effect = [
        _response(
            json_data={
                "status": "REQUEST_DENIED",
                "error_message": "Billing must be enabled.",
            }
        ),
        _response(text="google.maps.importLibrary=function(){}"),
    ]
    monkeypatch.setattr(
        "app.services.google_maps_service.httpx.Client",
        lambda **kwargs: MagicMock(
            __enter__=lambda self: client,
            __exit__=lambda *args: None,
        ),
    )

    result = verify_google_maps_api_key("test-key")

    assert result["ok"] is True
    geocoding = next(check for check in result["checks"] if check["id"] == "geocoding")
    assert geocoding["ok"] is False
    assert "Billing" in geocoding["detail"]


def test_verify_google_maps_api_key_referrer_restricted_is_ok(monkeypatch):
    client = MagicMock()
    referrer_error = (
        "PERMISSION_DENIED: Requests from referer <empty> are blocked.; "
        "API keys with referer restrictions cannot be used with this API."
    )
    client.post.return_value = _response(
        status_code=403,
        json_data={"error": {"status": "PERMISSION_DENIED", "message": referrer_error}},
    )
    client.get.side_effect = [
        _response(
            json_data={
                "status": "REQUEST_DENIED",
                "error_message": referrer_error,
            }
        ),
        _response(text="Google Maps JavaScript API error: RefererNotAllowedMapError"),
    ]
    monkeypatch.setattr(
        "app.services.google_maps_service.httpx.Client",
        lambda **kwargs: MagicMock(
            __enter__=lambda self: client,
            __exit__=lambda *args: None,
        ),
    )

    result = verify_google_maps_api_key("test-key")

    assert result["ok"] is True
    assert "Live preview" in result["message"]
    assert all(check["ok"] for check in result["checks"])
    assert all("Live preview" in check["detail"] for check in result["checks"])
