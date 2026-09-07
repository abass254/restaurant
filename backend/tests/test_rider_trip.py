"""Unit tests for rider trip / offer service helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.services.rider_service import RiderServiceError
from app.services.rider_trip_service import (
    OFFER_TTL_SECONDS,
    RIDER_SEARCH_TTL_SECONDS,
    TRIP_AT_STORE,
    TRIP_CANCELLED,
    TRIP_EN_ROUTE_STORE,
    TRIP_TRANSITIONS,
    RiderTripService,
    claim_searching_delivery,
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


def test_request_login_code_phone_rejected_when_not_debug() -> None:
    from app.support.otp_delivery import PHONE_OTP_UNAVAILABLE

    service = RiderTripService(MagicMock())
    with patch(
        "app.services.rider_trip_service.phone_otp_allowed",
        return_value=False,
    ):
        with pytest.raises(RiderServiceError, match=PHONE_OTP_UNAVAILABLE):
            service.request_login_code(phone="+254700000099")


@patch("app.services.rider_trip_service.sms_configured", return_value=True)
@patch("app.services.rider_trip_service.phone_otp_allowed", return_value=True)
@patch("app.services.login_otp_sms.send_login_otp_sms", return_value=True)
def test_request_login_code_phone_sends_sms(_send, _phone_ok, _sms) -> None:
    db = MagicMock()
    rider = MagicMock()
    rider.account_id = "acc-1"
    rider.name = "Amina"
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [rider]
    db.get.return_value = MagicMock(business_name="Kiosk")
    service = RiderTripService(db)
    login_row = MagicMock()
    service._issue_login_code = MagicMock(return_value=("654321", login_row))  # type: ignore[method-assign]
    result = service.request_login_code(phone="+254700000001")
    assert result["code_sent"] is True
    assert result["login_code"] is None
    assert login_row.delivery_status == "delivered"
    _send.assert_called_once()


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
    assert RIDER_SEARCH_TTL_SECONDS == 60
    assert datetime.now(timezone.utc) + timedelta(seconds=OFFER_TTL_SECONDS)


def test_rider_search_expires_and_cancels_standalone_delivery() -> None:
    from app.support.delivery_status import DELIVERY_CANCELLED, DELIVERY_SEARCHING

    db = MagicMock()
    now = datetime.now(timezone.utc)
    expired_at = now - timedelta(minutes=1)
    delivery = MagicMock()
    delivery.order_id = None
    delivery.status = DELIVERY_SEARCHING
    delivery.assigned_rider_id = None
    delivery.rider_search_expires_at = expired_at.replace(tzinfo=None)
    delivery.id = "delivery-1"

    pending_offer = MagicMock()
    pending_offer.status = "pending"
    db.query.return_value.filter.return_value.all.return_value = [pending_offer]
    db.get.return_value = None

    service = RiderTripService(db)
    assert service.rider_search_expired(delivery, now=now) is True
    assert service.expire_rider_search(delivery, now=now) is True
    assert delivery.status == DELIVERY_CANCELLED
    assert delivery.rider_trip_phase == TRIP_CANCELLED
    assert pending_offer.status == "expired"
    db.commit.assert_called()


def test_claim_searching_delivery_second_writer_loses() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE deliveries (
                    id VARCHAR(36) PRIMARY KEY,
                    account_id VARCHAR(36) NOT NULL DEFAULT 'acct',
                    status VARCHAR(32),
                    assigned_rider_id VARCHAR(36),
                    rider_assigned_at DATETIME,
                    rider_trip_phase VARCHAR(32),
                    rider_search_expires_at DATETIME,
                    cancelled_at DATETIME,
                    updated_at DATETIME
                )
                """
            ),
        )
        conn.execute(
            text(
                "INSERT INTO deliveries (id, status) VALUES ('del-1', 'searching')"
            ),
        )

    Session = sessionmaker(bind=engine)
    now = datetime.now(timezone.utc)
    first = Session()
    second = Session()
    try:
        assert claim_searching_delivery(first, "del-1", "rider-a", now=now) == 1
        first.commit()
        assert claim_searching_delivery(second, "del-1", "rider-b", now=now) == 0
        second.rollback()
    finally:
        first.close()
        second.close()

