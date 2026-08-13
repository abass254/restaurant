from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_access,
    require_merchant_admin,
)
from app.database import get_db
from app.dependencies import get_request_session
from app.config import get_settings
from app.models import MerchantMpesaProfile, MpesaTransaction, User
from app.services import mpesa_payout_service, mpesa_service
from app.services.mpesa_service import (
    MpesaApiError,
    MpesaConfigurationMissing,
    resolve_mpesa_config,
)
from app.services.platform_runtime import get_runtime_mode, is_dev_runtime
from app.support.daraja_sandbox import (
    build_daraja_production_config,
    build_daraja_sandbox_config,
    daraja_env_configured,
)
from app.support.mpesa_dev_samples import dev_merchant_config, dev_transactions

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mpesa", tags=["mpesa"])


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only super admins can manage Daraja API credentials.",
        )


def _require_merchant(user: User) -> None:
    try:
        active_account_id(user)
    except HTTPException:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only merchants can configure paybill/till details.",
        )


def _mask(value: str | None, keep: int = 4) -> str | None:
    if not value:
        return None
    if len(value) <= keep:
        return "*" * len(value)
    return ("*" * (len(value) - keep)) + value[-keep:]


def _active_env_config(db: Session):
    if mpesa_service.use_mpesa_sandbox(db):
        return build_daraja_sandbox_config()
    return build_daraja_production_config()


class MpesaConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    environment: str
    shortcode: str
    shortcode_type: str
    consumer_key_masked: str | None
    consumer_secret_masked: str | None
    passkey_masked: str | None
    callback_url: str | None
    account_reference_prefix: str
    b2b_initiator_name: str | None
    b2b_security_credential_masked: str | None
    b2b_auto_payout: bool
    b2b_result_url: str | None
    is_active: bool
    last_tested_at: datetime | None
    last_test_result: str | None
    is_configured: bool
    source: str = "env"

    @classmethod
    def from_env(cls, config: object, *, configured: bool) -> "MpesaConfigOut":
        settings = get_settings()
        base = settings.app_url.rstrip("/")
        last_at, last_result = mpesa_service.get_last_connection_test()
        return cls(
            id=str(getattr(config, "id", "daraja-env")),
            environment=str(getattr(config, "environment", "sandbox")),
            shortcode=str(getattr(config, "shortcode", "") or ""),
            shortcode_type=str(getattr(config, "shortcode_type", "paybill") or "paybill"),
            consumer_key_masked=_mask(getattr(config, "consumer_key", None), 4),
            consumer_secret_masked=_mask(getattr(config, "consumer_secret", None), 4),
            passkey_masked=_mask(getattr(config, "passkey", None), 4),
            callback_url=getattr(config, "callback_url", None) or None,
            account_reference_prefix=str(
                getattr(config, "account_reference_prefix", "PAY") or "PAY"
            ),
            b2b_initiator_name=getattr(config, "b2b_initiator_name", None) or None,
            b2b_security_credential_masked=_mask(
                getattr(config, "b2b_security_credential", None),
                4,
            ),
            b2b_auto_payout=bool(getattr(config, "b2b_auto_payout", False)),
            b2b_result_url=f"{base}/mpesa/b2b/result",
            is_active=True,
            last_tested_at=last_at,
            last_test_result=last_result,
            is_configured=configured,
            source="env",
        )


class MerchantMpesaConfigPayload(BaseModel):
    shortcode: str = Field(min_length=3, max_length=20)
    shortcode_type: Literal["paybill", "till", "pochi"] = "paybill"
    account_number: str = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def normalize_settlement_fields(self) -> "MerchantMpesaConfigPayload":
        if not (self.account_number or "").strip():
            raise ValueError("Transaction account is required.")
        self.account_number = self.account_number.strip()

        raw = (self.shortcode or "").strip()
        if self.shortcode_type == "pochi":
            msisdn = mpesa_service.normalize_msisdn(raw)
            if not msisdn.startswith("254") or len(msisdn) != 12:
                raise ValueError(
                    "Pochi la Biashara requires a valid M-PESA phone number "
                    "(07XXXXXXXX or 2547XXXXXXXX).",
                )
            self.shortcode = msisdn
        else:
            digits = "".join(ch for ch in raw if ch.isdigit())
            if len(digits) < 5 or len(digits) > 12:
                raise ValueError(
                    "Enter a valid Till or Paybill number (5–12 digits).",
                )
            self.shortcode = digits
        return self


class MerchantMpesaConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    shortcode: str
    shortcode_type: str
    account_number: str | None
    is_configured: bool

    @classmethod
    def from_model(
        cls,
        config: MerchantMpesaProfile | None,
    ) -> "MerchantMpesaConfigOut | None":
        if not config:
            return None
        return cls(
            id=config.id,
            account_id=config.account_id,
            shortcode=config.shortcode,
            shortcode_type=config.shortcode_type,
            account_number=config.account_number,
            is_configured=True,
        )


class StkPushPayload(BaseModel):
    phone_number: str = Field(min_length=9, max_length=20)
    amount: int = Field(ge=1, le=300_000)
    account_reference: str = Field(min_length=1, max_length=100)
    transaction_desc: str = Field(min_length=1, max_length=200)


class MpesaTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    phone_number: str
    amount: int
    account_reference: str
    transaction_desc: str
    status: str
    result_code: int | None
    result_desc: str | None
    mpesa_receipt_number: str | None
    merchant_request_id: str | None
    checkout_request_id: str | None
    completed_at: datetime | None
    created_at: datetime | None
    transaction_account: str | None = None
    payout_destination_shortcode: str | None = None
    payout_destination_type: str | None = None
    payout_status: str | None = None
    payout_shortcode: str | None = None
    payout_shortcode_type: str | None = None
    payout_amount: int | None = None
    payout_receipt_number: str | None = None
    payout_result_desc: str | None = None
    payout_completed_at: datetime | None = None

    @classmethod
    def from_model(
        cls,
        txn: MpesaTransaction,
        *,
        merchant_profile: MerchantMpesaProfile | None = None,
    ) -> "MpesaTransactionOut":
        payout_shortcode = txn.payout_shortcode
        payout_shortcode_type = txn.payout_shortcode_type
        if not payout_shortcode and merchant_profile:
            payout_shortcode = merchant_profile.shortcode
            payout_shortcode_type = merchant_profile.shortcode_type
        return cls(
            id=txn.id,
            phone_number=txn.phone_number,
            amount=txn.amount,
            account_reference=txn.account_reference,
            transaction_desc=txn.transaction_desc,
            status=txn.status,
            result_code=txn.result_code,
            result_desc=txn.result_desc,
            mpesa_receipt_number=txn.mpesa_receipt_number,
            merchant_request_id=txn.merchant_request_id,
            checkout_request_id=txn.checkout_request_id,
            completed_at=txn.completed_at,
            created_at=txn.created_at,
            transaction_account=(
                merchant_profile.account_number if merchant_profile else None
            ),
            payout_destination_shortcode=payout_shortcode,
            payout_destination_type=payout_shortcode_type,
            payout_status=txn.payout_status,
            payout_shortcode=txn.payout_shortcode,
            payout_shortcode_type=txn.payout_shortcode_type,
            payout_amount=txn.payout_amount,
            payout_receipt_number=txn.payout_receipt_number,
            payout_result_desc=txn.payout_result_desc,
            payout_completed_at=txn.payout_completed_at,
        )


def _serialize_transaction(
    db: Session,
    txn: MpesaTransaction,
) -> MpesaTransactionOut:
    account_id = mpesa_payout_service.resolve_collection_account_id(db, txn)
    profile = (
        mpesa_service.get_merchant_profile(db, account_id) if account_id else None
    )
    return MpesaTransactionOut.from_model(txn, merchant_profile=profile)


@router.get("/config")
def show_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    _require_super_admin(user)
    config = _active_env_config(db)
    configured = daraja_env_configured(config)
    return {
        "config": MpesaConfigOut.from_env(config, configured=configured),
        "runtime_mode": get_runtime_mode(db),
        "message": (
            None
            if configured
            else (
                "Set MPESA_SANDBOX_* in .env for Dev mode, or MPESA_CONSUMER_KEY / "
                "MPESA_CONSUMER_SECRET / MPESA_PASSKEY / MPESA_SHORTCODE for Production."
            )
        ),
    }


@router.put("/config")
def upsert_config(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)
    raise HTTPException(
        status.HTTP_405_METHOD_NOT_ALLOWED,
        detail=(
            "Daraja credentials are configured in .env "
            "(MPESA_* / MPESA_SANDBOX_*), not from the admin UI."
        ),
    )


@router.delete("/config")
def delete_config(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)
    raise HTTPException(
        status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Remove Daraja credentials from .env and restart the backend.",
    )


@router.post("/test")
def test_config(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)
    try:
        config = resolve_mpesa_config(db)
    except MpesaConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    try:
        mpesa_service._token_cache.pop(str(config.id), None)
        mpesa_service.test_connection(db, config)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Daraja test failed: {exc}",
        ) from exc
    return {
        "message": "Daraja credentials verified.",
        "config": MpesaConfigOut.from_env(config, configured=True),
        "runtime_mode": get_runtime_mode(db),
    }


@router.post("/stk-push")
def trigger_stk_push(
    payload: StkPushPayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_merchant(user)

    try:
        account_id = active_account_id(user)
        txn = mpesa_service.stk_push(
            db,
            phone_number=payload.phone_number,
            amount=payload.amount,
            account_reference=payload.account_reference,
            transaction_desc=payload.transaction_desc,
            initiated_by_user_id=user.id,
            account_id=account_id,
        )
    except MpesaConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return {
        "message": "STK push sent. Ask the customer to check their phone.",
        "transaction": _serialize_transaction(db, txn),
    }


@router.get("/transactions")
def list_transactions(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    limit: int = 50,
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_merchant(user)
    limit = max(1, min(limit, 200))
    rows = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.account_id == active_account_id(user),
        )
        .order_by(MpesaTransaction.id.desc())
        .limit(limit)
        .all()
    )
    transactions = [_serialize_transaction(db, t) for t in rows]
    if is_dev_runtime(db) and not transactions:
        transactions = [
            MpesaTransactionOut.model_validate(row) for row in dev_transactions()
        ]
    return {
        "transactions": transactions,
        "dev_sample_data": bool(is_dev_runtime(db) and not rows),
    }


@router.get("/transactions/{transaction_id}")
def get_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_merchant(user)
    txn = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.id == transaction_id,
            MpesaTransaction.account_id == active_account_id(user),
        )
        .first()
    )
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found.")
    return {"transaction": _serialize_transaction(db, txn)}


@router.post("/transactions/{transaction_id}/payout")
def retry_transaction_payout(
    transaction_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)
    txn = db.query(MpesaTransaction).filter(MpesaTransaction.id == transaction_id).first()
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found.")
    try:
        txn = mpesa_payout_service.retry_payout(db, txn)
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "message": "Merchant payout request sent.",
        "transaction": _serialize_transaction(db, txn),
    }


@router.get("/business-config")
def show_merchant_business_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    _require_merchant(user)
    account_id = active_account_id(user)
    config = mpesa_service.get_merchant_profile(db, account_id)
    out = MerchantMpesaConfigOut.from_model(config)
    if out is None and is_dev_runtime(db):
        out = MerchantMpesaConfigOut.model_validate(
            dev_merchant_config(str(account_id or "")),
        )
    return {
        "config": out,
        "dev_sample_data": bool(out is not None and config is None and is_dev_runtime(db)),
    }


@router.put("/business-config")
def upsert_merchant_business_config(
    payload: MerchantMpesaConfigPayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "settings")
    require_merchant_admin(user)
    _require_merchant(user)

    account_id = active_account_id(user)
    config = mpesa_service.get_merchant_profile(db, account_id)
    now = datetime.utcnow()
    if config is None:
        config = MerchantMpesaProfile(
            account_id=account_id,
            created_at=now,
        )
        db.add(config)

    config.shortcode = payload.shortcode.strip()
    config.shortcode_type = payload.shortcode_type
    config.account_number = payload.account_number.strip()
    config.updated_by_user_id = user.id
    config.updated_at = now

    db.commit()
    db.refresh(config)

    return {
        "message": "Merchant M-PESA settlement settings saved.",
        "config": MerchantMpesaConfigOut.from_model(config),
    }
