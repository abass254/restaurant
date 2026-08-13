from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_access,
    require_merchant_admin,
)
from app.database import get_db
from app.dependencies import get_request_session
from app.models import MerchantKraProfile, User
from app.services import kra_service

router = APIRouter(prefix="/kra", tags=["kra"])


def _require_merchant(user: User) -> None:
    try:
        active_account_id(user)
    except HTTPException:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only merchants can configure KRA fiscal settings.",
        )


class MerchantKraConfigPayload(BaseModel):
    enabled: bool = False
    kra_pin: str | None = Field(default=None, max_length=20)
    integration_type: Literal["vscu", "oscu", "device"] = "vscu"
    control_unit_serial: str | None = Field(default=None, max_length=50)
    branch_id: str | None = Field(default=None, max_length=50)
    vat_registered: bool = True
    middleware_provider: str | None = Field(default=None, max_length=100)

    @field_validator("kra_pin", mode="before")
    @classmethod
    def _normalize_pin(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = str(value).strip()
        return stripped or None

    @field_validator("control_unit_serial", "branch_id", "middleware_provider", mode="before")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = str(value).strip()
        return stripped or None


class MerchantKraConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    enabled: bool
    kra_pin: str | None
    integration_type: str
    control_unit_serial: str | None
    branch_id: str | None
    vat_registered: bool
    middleware_provider: str | None
    is_configured: bool

    @classmethod
    def from_model(
        cls,
        config: MerchantKraProfile | None,
    ) -> "MerchantKraConfigOut | None":
        if not config:
            return None
        return cls(
            id=config.id,
            account_id=config.account_id,
            enabled=bool(config.enabled),
            kra_pin=config.kra_pin,
            integration_type=config.integration_type,
            control_unit_serial=config.control_unit_serial,
            branch_id=config.branch_id,
            vat_registered=bool(config.vat_registered),
            middleware_provider=config.middleware_provider,
            is_configured=bool(config.enabled and config.kra_pin and config.control_unit_serial),
        )


def _validate_payload(payload: MerchantKraConfigPayload) -> str | None:
    kra_pin: str | None = None
    if payload.kra_pin:
        try:
            kra_pin = kra_service.validate_kra_pin(payload.kra_pin)
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    if payload.enabled:
        if not kra_pin:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="KRA PIN is required when fiscal invoicing is enabled.",
            )
        if not (payload.control_unit_serial or "").strip():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Control unit serial is required when fiscal invoicing is enabled.",
            )

    return kra_pin


@router.get("/business-config")
def show_merchant_business_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_merchant(user)
    config = kra_service.get_merchant_profile(db, active_account_id(user))
    return {
        "config": MerchantKraConfigOut.from_model(config),
    }


@router.put("/business-config")
def upsert_merchant_business_config(
    payload: MerchantKraConfigPayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    require_merchant_admin(user)
    _require_merchant(user)

    kra_pin = _validate_payload(payload)

    account_id = active_account_id(user)
    config = kra_service.get_merchant_profile(db, account_id)
    now = datetime.utcnow()
    if config is None:
        config = MerchantKraProfile(
            account_id=account_id,
            created_at=now,
        )
        db.add(config)

    config.enabled = payload.enabled
    config.kra_pin = kra_pin
    config.integration_type = payload.integration_type
    config.control_unit_serial = payload.control_unit_serial
    config.branch_id = payload.branch_id
    config.vat_registered = payload.vat_registered
    config.middleware_provider = payload.middleware_provider
    config.updated_by_user_id = user.id
    config.updated_at = now

    db.commit()
    db.refresh(config)

    return {
        "message": "KRA fiscal settings saved.",
        "config": MerchantKraConfigOut.from_model(config),
    }
