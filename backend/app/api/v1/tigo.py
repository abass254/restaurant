"""Super-admin endpoints for exercising the Tigo Pesa / Mixx by Yas APIs.

These are deliberately admin-only and side-effect free apart from the money
movement each Tigo call implies. Nothing here is reachable from a merchant
surface: Tigo stays behind the TIGO_ENABLED rollout gate until the integration
is proven from the admin console.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import User
from app.services import tigo_service
from app.services.platform_runtime import get_runtime_mode
from app.services.tigo_service import (
    TigoApiError,
    TigoCallResult,
    TigoConfigurationMissing,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tigo", tags=["tigo"])


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only super admins can test the Tigo APIs.",
        )


def _admin(db: Session, session: dict) -> User:
    user = require_user(db, session)
    _require_super_admin(user)
    return user


def _config(db: Session):
    try:
        return tigo_service.resolve_tigo_config(db)
    except TigoConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _respond(calls: list[TigoCallResult]) -> dict:
    payload = [call.as_dict() for call in calls]
    last = calls[-1] if calls else None
    return {
        "ok": bool(last and last.ok),
        "message": (
            f"{last.operation} succeeded."
            if last and last.ok
            else (last.error or "Request failed.") if last else "Nothing ran."
        ),
        "calls": payload,
    }


def _run(config, runner) -> dict:
    """Mint a fresh token then run one Tigo Secure call, reporting both."""
    try:
        calls = tigo_service.run_with_token(config, runner)
    except TigoConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except TigoApiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return _respond(calls)


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------


class TigoConfigOut(BaseModel):
    environment: str
    base_url: str
    partner_base_url: str | None
    client_id_masked: str | None
    client_secret_masked: str | None
    account_msisdn: str | None
    account_pin_masked: str | None
    master_merchant_id: str | None
    biller_code: str | None
    callback_url: str
    redirect_url: str
    currency: str
    secure_configured: bool
    partner_configured: bool
    rollout_enabled: bool
    allowlisted_accounts: int


@router.get("/config")
def show_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _admin(db, session)
    cfg = _config(db)
    settings = get_settings()
    allowlist = [
        item.strip()
        for item in (settings.tigo_enabled_account_ids or "").split(",")
        if item.strip()
    ]
    secure_ready = tigo_service.tigo_configured(cfg)
    partner_ready = bool(cfg.partner_base_url and cfg.account_msisdn and cfg.account_pin)

    return {
        "config": TigoConfigOut(
            environment=cfg.environment,
            base_url=cfg.base_url,
            partner_base_url=cfg.partner_base_url or None,
            client_id_masked=tigo_service.mask_secret(cfg.client_id) or None,
            client_secret_masked=tigo_service.mask_secret(cfg.client_secret) or None,
            account_msisdn=cfg.account_msisdn or None,
            account_pin_masked="****" if cfg.account_pin else None,
            master_merchant_id=cfg.master_merchant_id or None,
            biller_code=cfg.biller_code or None,
            callback_url=cfg.callback_url,
            redirect_url=cfg.redirect_url,
            currency=cfg.currency,
            secure_configured=secure_ready,
            partner_configured=partner_ready,
            rollout_enabled=bool(settings.tigo_enabled),
            allowlisted_accounts=len(allowlist),
        ),
        "runtime_mode": get_runtime_mode(db),
        "message": (
            None
            if secure_ready
            else (
                "Set TIGO_CLIENT_ID and TIGO_CLIENT_SECRET in .env. Credentials come "
                "from Mixx corporate onboarding (inquiry.mfscorporate@mixx.co.tz)."
            )
        ),
    }


# --------------------------------------------------------------------------
# Test calls
# --------------------------------------------------------------------------


class ValidateAccountIn(BaseModel):
    msisdn: str = Field(min_length=9, max_length=15)
    first_name: str | None = None
    last_name: str | None = None


class PaymentAuthIn(BaseModel):
    msisdn: str = Field(min_length=9, max_length=15)
    amount: int = Field(gt=0)
    reference: str | None = Field(default=None, max_length=32)
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None


class DisburseIn(BaseModel):
    msisdn: str = Field(min_length=9, max_length=15)
    amount: int = Field(gt=0)
    reference: str | None = Field(default=None, max_length=20)


@router.post("/test/token")
def test_token(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _admin(db, session)
    cfg = _config(db)
    try:
        result, _ = tigo_service.generate_access_token(cfg)
    except TigoConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _respond([result])


@router.post("/test/system-status")
def test_system_status(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _admin(db, session)
    cfg = _config(db)
    return _run(cfg, lambda token: tigo_service.system_status(cfg, token))


@router.post("/test/validate-account")
def test_validate_account(
    payload: ValidateAccountIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _admin(db, session)
    cfg = _config(db)
    _assert_tanzanian(payload.msisdn)
    return _run(
        cfg,
        lambda token: tigo_service.validate_mfs_account(
            cfg,
            token,
            msisdn=payload.msisdn,
            first_name=payload.first_name,
            last_name=payload.last_name,
        ),
    )


@router.post("/test/payment-auth")
def test_payment_auth(
    payload: PaymentAuthIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _admin(db, session)
    cfg = _config(db)
    _assert_tanzanian(payload.msisdn)
    _assert_amount(payload.amount)
    return _run(
        cfg,
        lambda token: tigo_service.authorize_payment(
            cfg,
            token,
            msisdn=payload.msisdn,
            amount=payload.amount,
            reference=payload.reference,
            first_name=payload.first_name,
            last_name=payload.last_name,
            email=payload.email,
        ),
    )


@router.post("/test/disburse")
def test_disburse(
    payload: DisburseIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _admin(db, session)
    cfg = _config(db)
    _assert_tanzanian(payload.msisdn)
    _assert_amount(payload.amount)
    try:
        result = tigo_service.disburse(
            cfg,
            msisdn=payload.msisdn,
            amount=payload.amount,
            reference=payload.reference,
        )
    except TigoConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _respond([result])


def _assert_tanzanian(msisdn: str) -> None:
    if not tigo_service.is_tanzania_msisdn(msisdn):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"'{msisdn}' is not a Tanzanian number. Use 2557XXXXXXXX format.",
        )


def _assert_amount(amount: int) -> None:
    settings = get_settings()
    low = max(1, int(settings.tigo_min_amount or 1))
    high = max(low, int(settings.tigo_max_amount or 5_000_000))
    if amount < low:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Amount must be at least {settings.tigo_currency} {low:,}.",
        )
    if amount > high:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Amount cannot exceed {settings.tigo_currency} {high:,}.",
        )
