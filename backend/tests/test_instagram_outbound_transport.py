from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.instagram_outbound_transport import resolve_outbound_transport


def test_resolve_outbound_transport_official_when_beta_disabled() -> None:
    settings = MagicMock(instagram_beta_enabled=False, instagram_outbound_transport="auto")
    account = MagicMock(account_id="merchant-1", platform="instagram")
    assert resolve_outbound_transport(settings, MagicMock(), account) == "official"


def test_resolve_outbound_transport_beta_when_enabled_and_connected() -> None:
    settings = MagicMock(instagram_beta_enabled=True, instagram_outbound_transport="auto")
    account = MagicMock(account_id="merchant-1", platform="instagram")
    db = MagicMock()
    beta = MagicMock(login_provider="instagram_beta")

    with patch(
        "app.services.instagram_outbound_transport.get_merchant_instagram_beta_account",
        return_value=beta,
    ):
        assert resolve_outbound_transport(settings, db, account) == "beta"


def test_resolve_outbound_transport_forced_official() -> None:
    settings = MagicMock(instagram_beta_enabled=True, instagram_outbound_transport="official")
    account = MagicMock(account_id="merchant-1", platform="instagram")
    assert resolve_outbound_transport(settings, MagicMock(), account) == "official"
