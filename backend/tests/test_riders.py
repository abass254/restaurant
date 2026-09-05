"""Tests for merchant rider fleet onboarding."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.core.rider_invite_tokens import (
    RiderInviteTokenInvalid,
    mint_rider_invite_token,
    read_rider_invite_token,
)
from app.services.rider_service import RiderService, RiderServiceError, normalize_phone, phone_lookup_candidates


def test_normalize_phone_strips_spaces() -> None:
    assert normalize_phone("+254 712 345 678") == "+254712345678"


def test_phone_lookup_candidates_cover_local_formats() -> None:
    found = set(phone_lookup_candidates("0712345678"))
    assert "+254712345678" in found
    assert "254712345678" in found
    assert "0712345678" in found
    assert "712345678" in found
    assert phone_lookup_candidates("") == []


def test_rider_invite_token_round_trip() -> None:
    token = mint_rider_invite_token("rider-1", "invite-1", jti="jti-abc")
    payload = read_rider_invite_token(token)
    assert payload["rid"] == "rider-1"
    assert payload["iid"] == "invite-1"
    assert payload["jti"] == "jti-abc"


def test_rider_invite_token_rejects_garbage() -> None:
    with pytest.raises(RiderInviteTokenInvalid):
        read_rider_invite_token("not-a-real-token")


def test_create_invite_rejects_duplicate_phone() -> None:
    db = MagicMock()
    existing = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = existing
    service = RiderService(db)
    with pytest.raises(RiderServiceError, match="already exists"):
        service.create_invite("acct-1", name="James", phone="+254700000001")


@patch("app.services.rider_service.mint_rider_invite_token", return_value="signed-token")
def test_create_invite_persists_rider_and_invite(mock_mint) -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    def flush_side_effect() -> None:
        if hasattr(db.add.call_args_list[0][0][0], "id"):
            pass

    rider_obj = None
    invite_obj = None

    def capture_add(obj) -> None:
        nonlocal rider_obj, invite_obj
        if rider_obj is None:
            rider_obj = obj
            obj.id = "rider-new"
        else:
            invite_obj = obj
            obj.id = "invite-new"

    db.add.side_effect = capture_add
    db.flush = MagicMock()
    db.commit = MagicMock()
    db.refresh = MagicMock()

    service = RiderService(db)
    with patch.object(service, "_invite_url", return_value="https://app/rider/join/signed-token"):
        result = service.create_invite("acct-1", name="James", phone="+254700000001")

    assert result["token"] == "signed-token"
    assert rider_obj is not None
    assert rider_obj.status == "invited"
    assert invite_obj is not None
    mock_mint.assert_called_once()


def test_get_join_info_expired_invite() -> None:
    db = MagicMock()
    rider = MagicMock()
    rider.id = "rider-1"
    rider.account_id = "acct-1"
    rider.status = "invited"
    rider.name = "James"
    rider.phone = "+254700"

    invite = MagicMock()
    invite.accepted_at = None
    invite.expires_at = datetime.now(timezone.utc) - timedelta(days=1)

    db.get.return_value = rider
    db.query.return_value.filter.return_value.first.return_value = invite

    service = RiderService(db)
    with patch(
        "app.services.rider_service.read_rider_invite_token",
        return_value={"rid": "rider-1", "jti": "jti-1", "iid": "inv-1"},
    ):
        with pytest.raises(RiderServiceError, match="expired"):
            service.get_join_info("token")
