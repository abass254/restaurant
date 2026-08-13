"""Google Maps configuration endpoints.

Super admins manage a single platform-wide Google Maps API key and default
map view. A public, unauthenticated endpoint exposes the key so interactive
location pickers can render before the user has any session.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.database import get_db
from app.dependencies import get_request_session
from app.models import GoogleMapsConfiguration, User
from app.services.google_maps_service import verify_google_maps_api_key

router = APIRouter(prefix="/google-maps", tags=["google-maps"])


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only super admins can manage the Google Maps configuration.",
        )


def _mask(value: str | None, keep: int = 6) -> str | None:
    if not value:
        return None
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + ("*" * (len(value) - keep))


def get_active_config(db: Session) -> GoogleMapsConfiguration | None:
    return (
        db.query(GoogleMapsConfiguration)
        .filter(GoogleMapsConfiguration.is_active.is_(True))
        .order_by(GoogleMapsConfiguration.id.desc())
        .first()
    )


def resolve_api_key(db: Session) -> str | None:
    config = get_active_config(db)
    if config and config.api_key.strip():
        return config.api_key.strip()
    env_key = get_settings().google_maps_api_key.strip()
    return env_key or None


def resolve_map_id() -> str | None:
    env_map_id = get_settings().google_maps_map_id.strip()
    return env_map_id or None


class GoogleMapsConfigPayload(BaseModel):
    api_key: str = Field(min_length=1, max_length=500)
    default_center_lat: float | None = Field(default=None, ge=-90, le=90)
    default_center_lng: float | None = Field(default=None, ge=-180, le=180)
    default_zoom: float | None = Field(default=None, ge=0, le=22)
    default_country: str | None = Field(default=None, max_length=10)
    delivery_fee_per_km: float | None = Field(default=None, ge=0, le=99_999_999.99)


class GoogleMapsConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    api_key_masked: str | None
    default_center_lat: float | None
    default_center_lng: float | None
    default_zoom: float | None
    default_country: str | None
    delivery_fee_per_km: float | None
    is_active: bool
    is_configured: bool

    @classmethod
    def from_model(cls, config: GoogleMapsConfiguration | None) -> "GoogleMapsConfigOut | None":
        if not config:
            return None
        return cls(
            id=config.id,
            api_key_masked=_mask(config.api_key),
            default_center_lat=config.default_center_lat,
            default_center_lng=config.default_center_lng,
            default_zoom=config.default_zoom,
            default_country=config.default_country,
            delivery_fee_per_km=(
                float(config.delivery_fee_per_km)
                if config.delivery_fee_per_km is not None
                else None
            ),
            is_active=bool(config.is_active),
            is_configured=True,
        )


class GoogleMapsPublicConfigOut(BaseModel):
    """Public view: exposes the browser API key so maps can render."""

    api_key: str | None
    map_id: str | None
    default_center_lat: float | None
    default_center_lng: float | None
    default_zoom: float | None
    default_country: str | None
    delivery_fee_per_km: float | None


class GoogleMapsTestPayload(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)


class GoogleMapsCheckOut(BaseModel):
    id: str
    label: str
    ok: bool
    detail: str


class GoogleMapsTestOut(BaseModel):
    ok: bool
    message: str
    checks: list[GoogleMapsCheckOut]


@router.get("/config")
def show_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_super_admin(user)
    return {"config": GoogleMapsConfigOut.from_model(get_active_config(db))}


@router.put("/config")
def upsert_config(
    payload: GoogleMapsConfigPayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_super_admin(user)

    config = get_active_config(db)
    now = datetime.utcnow()
    if config is None:
        config = GoogleMapsConfiguration(created_at=now)
        db.add(config)

    config.api_key = payload.api_key.strip()
    config.default_center_lat = payload.default_center_lat
    config.default_center_lng = payload.default_center_lng
    config.default_zoom = payload.default_zoom
    config.default_country = (payload.default_country or "").strip().lower() or None
    config.delivery_fee_per_km = payload.delivery_fee_per_km
    config.is_active = True
    config.updated_at = now

    db.commit()
    db.refresh(config)

    return {
        "message": "Google Maps configuration saved.",
        "config": GoogleMapsConfigOut.from_model(config),
    }


class GoogleMapsDeliveryRatePayload(BaseModel):
    delivery_fee_per_km: float | None = Field(default=None, ge=0, le=99_999_999.99)


@router.patch("/config/delivery-rate")
def patch_delivery_rate(
    payload: GoogleMapsDeliveryRatePayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_super_admin(user)

    config = get_active_config(db)
    if config is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Save Google Maps configuration before setting a delivery rate.",
        )

    config.delivery_fee_per_km = payload.delivery_fee_per_km
    config.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(config)

    return {
        "message": "Delivery rate saved.",
        "config": GoogleMapsConfigOut.from_model(config),
    }


@router.delete("/config")
def delete_config(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_super_admin(user)
    config = get_active_config(db)
    if config:
        db.delete(config)
        db.commit()
    return {"message": "Google Maps configuration removed."}


@router.post("/test", response_model=GoogleMapsTestOut)
def test_config(
    request: Request,
    payload: GoogleMapsTestPayload,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Verify that the platform key can call the APIs used by location pickers."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_super_admin(user)

    api_key = (payload.api_key or "").strip() or resolve_api_key(db)
    if not api_key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Save an API key or set GOOGLE_MAPS_API_KEY before running the test.",
        )

    try:
        result = verify_google_maps_api_key(api_key)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Maps test failed: {exc}",
        ) from exc

    return GoogleMapsTestOut(**result)


@router.get("/public-config")
def public_config(db: Session = Depends(get_db)):
    """Unauthenticated: API key + defaults for location pickers."""
    config = get_active_config(db)
    api_key = resolve_api_key(db)
    if not config and not api_key:
        return GoogleMapsPublicConfigOut(
            api_key=None,
            map_id=resolve_map_id(),
            default_center_lat=None,
            default_center_lng=None,
            default_zoom=None,
            default_country=None,
            delivery_fee_per_km=None,
        )
    return GoogleMapsPublicConfigOut(
        api_key=api_key,
        map_id=resolve_map_id(),
        default_center_lat=config.default_center_lat if config else -1.2921,
        default_center_lng=config.default_center_lng if config else 36.8219,
        default_zoom=config.default_zoom if config else 11,
        default_country=config.default_country if config else "ke",
        delivery_fee_per_km=(
            float(config.delivery_fee_per_km)
            if config and config.delivery_fee_per_km is not None
            else None
        ),
    )
