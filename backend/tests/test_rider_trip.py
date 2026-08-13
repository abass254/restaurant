"""Unit tests for rider trip / offer service helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.services.rider_service import RiderServiceError
from app.services.rider_trip_service import (
    OFFER_TTL_SECONDS,
    TRIP_AT_STORE,
    TRIP_EN_ROUTE_STORE,
    TRIP_TRANSITIONS,
    RiderTripService,
    hash_login_code,
    trip_route_for_phase,
)


def test_trip_route_for_phase() -> None:
    assert trip_route_for_phase(TRIP_EN_ROUTE_STORE) == "/r/trip/go-to-store"
    assert trip_route_for_phase(TRIP_AT_STORE) == "/r/trip/arrived-at-store"
    assert trip_route_for_phase(None) == "/r/home"


def test_trip_transitions_cover_happy_path() -> None:
    phase = TRIP_EN_ROUTE_STORE
    seen = {phase}
    while phase in TRIP_TRANSITIONS:
        phase = TRIP_TRANSITIONS[phase]
        seen.add(phase)
    assert "at_client" in seen


def test_hash_login_code_stable() -> None:
    assert hash_login_code("123456") == hash_login_code("123456")
    assert hash_login_code("123456") != hash_login_code("654321")


def test_request_login_code_unknown_phone_returns_null_code() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
    service = RiderTripService(db)
    result = service.request_login_code(phone="+254700000099")
    assert result["login_code"] is None
    assert "onboarded" in result["message"].lower() or "login" in result["message"].lower()


def test_request_login_code_requires_phone_or_email() -> None:
    service = RiderTripService(MagicMock())
    with pytest.raises(RiderServiceError, match="Phone number or email"):
        service.request_login_code()


def test_set_presence_blocks_when_active_trip() -> None:
    db = MagicMock()
    rider = MagicMock()
    rider.status = "active"
    rider.is_online = False
    service = RiderTripService(db)
    service._active_trip = MagicMock(return_value=MagicMock())  # type: ignore[method-assign]
    with pytest.raises(RiderServiceError, match="current delivery"):
        service.set_presence(rider, online=True)


def test_offer_ttl_constant() -> None:
    assert OFFER_TTL_SECONDS == 45
    assert datetime.now(timezone.utc) + timedelta(seconds=OFFER_TTL_SECONDS)
