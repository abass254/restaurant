from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.config import Settings
from app.core.instagram_hub import (
    hub_connect_url,
    public_https_origin,
    states_match,
)
from app.services.auth_service import InstagramAuthService
from app.services.instagram_connection import InstagramConnectionService, graph_access_token


def test_hub_connect_url_contract() -> None:
    settings = SimpleNamespace(
        instagram_hub_url="https://dukai.app",
        dukai_platform="merchant",
    )
    url = hub_connect_url(
        settings,  # type: ignore[arg-type]
        "abc123",
        origin="https://merchants.dukai.app",
    )
    assert url.startswith("https://dukai.app/instagram?")
    assert "platform=merchant" in url
    assert "state=abc123" in url
    assert "return_to=https%3A%2F%2Fmerchants.dukai.app%2Finstagram%2Fcallback" in url


def test_hub_connect_url_service_platform() -> None:
    settings = SimpleNamespace(instagram_hub_url="https://dukai.app", dukai_platform="service")
    url = hub_connect_url(settings, "xyz")  # type: ignore[arg-type]
    assert "platform=service" in url
    assert "return_to=" not in url


def test_login_url_goes_to_hub_not_instagram() -> None:
    settings = Settings(
        instagram_hub_url="https://dukai.app",
        dukai_platform="merchant",
        instagram_redirect_uri="https://dukai.app/instagram/callback",
    )
    service = InstagramAuthService(settings, MagicMock(), MagicMock())
    url = service.get_login_url(state="s1", origin="https://merchants.dukai.app")
    assert "dukai.app/instagram?" in url
    assert "instagram.com/oauth" not in url
    assert settings.effective_instagram_redirect_uri == "https://dukai.app/instagram/callback"


def test_states_match() -> None:
    assert states_match("same-state", "same-state")
    assert not states_match("a", "b")
    assert not states_match("short", "longer-value")
    assert not states_match(None, "x")
    assert not states_match("x", None)


def test_public_https_origin_prefers_https() -> None:
    assert (
        public_https_origin("http://127.0.0.1:7100", "https://merchants.dukai.app")
        == "https://merchants.dukai.app"
    )
    assert public_https_origin("http://127.0.0.1:7100") is None


def test_ensure_fresh_token_skips_when_not_near_expiry() -> None:
    api = MagicMock()
    account = MagicMock(
        login_provider="instagram",
        token_expires_at=datetime.now(timezone.utc) + timedelta(days=40),
        username="shop",
    )
    account.access_token.return_value = "long-lived"
    service = InstagramConnectionService(MagicMock(), MagicMock(), api)
    assert service.ensure_fresh_token(account) == "long-lived"
    api.refresh_long_lived_token.assert_not_called()


def test_ensure_fresh_token_refreshes_near_expiry() -> None:
    api = MagicMock()
    api.refresh_long_lived_token.return_value = {
        "access_token": "rotated",
        "expires_at": datetime.now(timezone.utc) + timedelta(days=60),
    }
    db = MagicMock()
    account = MagicMock(
        login_provider="instagram",
        token_expires_at=datetime.now(timezone.utc) + timedelta(days=2),
        username="shop",
    )
    account.access_token.return_value = "expiring"
    service = InstagramConnectionService(db, MagicMock(), api)
    assert service.ensure_fresh_token(account) == "rotated"
    assert account.user_access_token == "rotated"
    db.commit.assert_called_once()


def test_graph_access_token_without_db_skips_refresh() -> None:
    account = MagicMock()
    account.access_token.return_value = "raw"
    assert graph_access_token(None, MagicMock(), MagicMock(), account) == "raw"
