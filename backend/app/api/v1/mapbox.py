"""Mapbox configuration endpoints.

Super admins manage a single platform-wide Mapbox config (public access
token + default map view). A public, unauthenticated endpoint exposes the
*public* token so the interactive map on the merchant registration form can
render before the merchant has any session.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.database import get_db
from app.dependencies import get_request_session
from app.models import MapboxConfiguration, User

router = APIRouter(prefix="/mapbox", tags=["mapbox"])

DEFAULT_MAP_STYLE = "mapbox://styles/mapbox/streets-v12"


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only super admins can manage the Mapbox configuration.",
        )


def _mask(value: str | None, keep: int = 6) -> str | None:
    if not value:
        return None
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + ("*" * (len(value) - keep))


def get_active_config(db: Session) -> MapboxConfiguration | None:
    return (
        db.query(MapboxConfiguration)
        .filter(MapboxConfiguration.is_active.is_(True))
        .order_by(MapboxConfiguration.id.desc())
        .first()
    )


class MapboxConfigPayload(BaseModel):
    access_token: str = Field(min_length=1, max_length=500)
    map_style: str = Field(default=DEFAULT_MAP_STYLE, max_length=255)
    default_center_lat: float | None = Field(default=None, ge=-90, le=90)
    default_center_lng: float | None = Field(default=None, ge=-180, le=180)
    default_zoom: float | None = Field(default=None, ge=0, le=22)
    default_country: str | None = Field(default=None, max_length=10)


class MapboxConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    access_token_masked: str | None
    map_style: str
    default_center_lat: float | None
    default_center_lng: float | None
    default_zoom: float | None
    default_country: str | None
    is_active: bool
    is_configured: bool

    @classmethod
    def from_model(cls, config: MapboxConfiguration | None) -> "MapboxConfigOut | None":
        if not config:
            return None
        return cls(
            id=config.id,
            access_token_masked=_mask(config.access_token),
            map_style=config.map_style or DEFAULT_MAP_STYLE,
            default_center_lat=config.default_center_lat,
            default_center_lng=config.default_center_lng,
            default_zoom=config.default_zoom,
            default_country=config.default_country,
            is_active=bool(config.is_active),
            is_configured=True,
        )


class MapboxPublicConfigOut(BaseModel):
    """Public view: exposes the (public) token so the map can render."""

    access_token: str | None
    map_style: str
    default_center_lat: float | None
    default_center_lng: float | None
    default_zoom: float | None
    default_country: str | None


@router.get("/config")
def show_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_super_admin(user)
    return {"config": MapboxConfigOut.from_model(get_active_config(db))}


@router.put("/config")
def upsert_config(
    payload: MapboxConfigPayload,
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
        config = MapboxConfiguration(created_at=now)
        db.add(config)

    config.access_token = payload.access_token.strip()
    config.map_style = (payload.map_style or "").strip() or DEFAULT_MAP_STYLE
    config.default_center_lat = payload.default_center_lat
    config.default_center_lng = payload.default_center_lng
    config.default_zoom = payload.default_zoom
    config.default_country = (payload.default_country or "").strip().lower() or None
    config.is_active = True
    config.updated_at = now

    db.commit()
    db.refresh(config)

    return {
        "message": "Mapbox configuration saved.",
        "config": MapboxConfigOut.from_model(config),
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
    return {"message": "Mapbox configuration removed."}


@router.get("/public-config")
def public_config(db: Session = Depends(get_db)):
    """Unauthenticated: token + defaults for the registration map.

    The token returned here is the public Mapbox token (``pk.*``), which is
    designed to be embedded in client-side code.
    """
    config = get_active_config(db)
    if not config:
        return MapboxPublicConfigOut(
            access_token=None,
            map_style=DEFAULT_MAP_STYLE,
            default_center_lat=None,
            default_center_lng=None,
            default_zoom=None,
            default_country=None,
        )
    return MapboxPublicConfigOut(
        access_token=config.access_token,
        map_style=config.map_style or DEFAULT_MAP_STYLE,
        default_center_lat=config.default_center_lat,
        default_center_lng=config.default_center_lng,
        default_zoom=config.default_zoom,
        default_country=config.default_country,
    )
