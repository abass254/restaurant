from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from app.core.mpesa_verify_tokens import (
    MpesaVerifyTokenInvalid,
    mint_mpesa_verify_token,
    read_mpesa_verify_token,
)
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
from app.services.platform_runtime import get_runtime_mode
from app.support.daraja_sandbox import (
    build_daraja_production_config,
    build_daraja_sandbox_config,
    daraja_env_configured,
)
from app.support.mpesa_merchant_copy import (
    merchant_safe_collection_desc,
    merchant_safe_payout_desc,
    merchant_safe_stk_error,
)

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


def _suggested_merchant_phone(user: User) -> str | None:
    raw = (user.phone or "").strip()
    if raw and mpesa_service.is_kenya_msisdn(raw):
        return mpesa_service.normalize_msisdn(raw)
    return None


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
    shortcode_type: Literal["paybill", "till", "pochi", "phone"] = "paybill"
    account_number: str = ""

    @model_validator(mode="after")
    def normalize_settlement_fields(self) -> "MerchantMpesaConfigPayload":
        raw = (self.shortcode or "").strip()
        if self.shortcode_type in {"pochi", "phone"}:
            if not mpesa_service.is_kenya_msisdn(raw):
                label = (
                    "Pochi la Biashara"
                    if self.shortcode_type == "pochi"
                    else "M-PESA phone"
                )
                raise ValueError(
                    f"{label} requires a valid Kenyan M-PESA number "
                    "(07XXXXXXXX or 2547XXXXXXXX).",
                )
            self.shortcode = mpesa_service.normalize_msisdn(raw)
            self.account_number = ""
        else:
            digits = "".join(ch for ch in raw if ch.isdigit())
            if len(digits) < 5 or len(digits) > 12:
                raise ValueError(
                    "Enter a valid Till or Paybill number (5–12 digits).",
                )
            self.shortcode = digits
            if self.shortcode_type == "paybill":
                account = (self.account_number or "").strip()
                if not account:
                    raise ValueError("Paybill account number is required.")
                self.account_number = account[:12]
            else:
                self.account_number = ""
        return self


class MerchantMpesaConfigSavePayload(MerchantMpesaConfigPayload):
    verification_token: str = Field(min_length=8, max_length=500)


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
    order_id: str | None = None
    booking_id: str | None = None
    source: Literal["booking", "order", "manual"] = "manual"
    booking_customer_name: str | None = None
    booking_starts_at: datetime | None = None

    @classmethod
    def from_model(
        cls,
        txn: MpesaTransaction,
        *,
        merchant_profile: MerchantMpesaProfile | None = None,
        booking_customer_name: str | None = None,
        booking_starts_at: datetime | None = None,
    ) -> "MpesaTransactionOut":
        payout_shortcode = txn.payout_shortcode
        payout_shortcode_type = txn.payout_shortcode_type
        if not payout_shortcode and merchant_profile:
            payout_shortcode = merchant_profile.shortcode
            payout_shortcode_type = merchant_profile.shortcode_type
        booking_id = getattr(txn, "booking_id", None)
        order_id = getattr(txn, "order_id", None)
        if booking_id:
            source: Literal["booking", "order", "manual"] = "booking"
        elif order_id:
            source = "order"
        else:
            source = "manual"
        return cls(
            id=txn.id,
            phone_number=txn.phone_number,
            amount=txn.amount,
            account_reference=txn.account_reference,
            transaction_desc=txn.transaction_desc,
            status=txn.status,
            result_code=txn.result_code,
            result_desc=merchant_safe_collection_desc(
                txn.status, txn.result_code, txn.result_desc
            ),
            mpesa_receipt_number=txn.mpesa_receipt_number,
            merchant_request_id=None,
            checkout_request_id=None,
            completed_at=txn.completed_at,
            created_at=txn.created_at,
            transaction_account=None,
            payout_destination_shortcode=payout_shortcode,
            payout_destination_type=payout_shortcode_type,
            payout_status=txn.payout_status,
            payout_shortcode=txn.payout_shortcode,
            payout_shortcode_type=txn.payout_shortcode_type,
            payout_amount=txn.payout_amount,
            payout_receipt_number=txn.payout_receipt_number,
            payout_result_desc=merchant_safe_payout_desc(
                txn.payout_status, txn.payout_result_desc
            ),
            payout_completed_at=txn.payout_completed_at,
            order_id=order_id,
            booking_id=booking_id,
            source=source,
            booking_customer_name=booking_customer_name,
            booking_starts_at=booking_starts_at,
        )


def _serialize_transaction(
    db: Session,
    txn: MpesaTransaction,
) -> MpesaTransactionOut:
    account_id = mpesa_payout_service.resolve_collection_account_id(db, txn)
    profile = (
        mpesa_service.get_merchant_profile(db, account_id) if account_id else None
    )
    booking_customer_name = None
    booking_starts_at = None
    booking_id = getattr(txn, "booking_id", None)
    if booking_id:
        from app.models import Booking

        booking = db.get(Booking, booking_id)
        if booking:
            booking_customer_name = booking.customer_name
            booking_starts_at = booking.starts_at
    return MpesaTransactionOut.from_model(
        txn,
        merchant_profile=profile,
        booking_customer_name=booking_customer_name,
        booking_starts_at=booking_starts_at,
    )


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
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=merchant_safe_stk_error(str(exc)),
        ) from exc
    except MpesaApiError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=merchant_safe_stk_error(str(exc)),
        ) from exc

    return {
        "message": "Prompt sent. Ask the customer to check their phone.",
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
        .order_by(
            MpesaTransaction.created_at.is_(None),
            MpesaTransaction.created_at.desc(),
            MpesaTransaction.id.desc(),
        )
        .limit(limit)
        .all()
    )
    transactions = [_serialize_transaction(db, t) for t in rows]
    return {
        "transactions": transactions,
        "dev_sample_data": False,
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
    return {
        "config": out,
        "suggested_phone": _suggested_merchant_phone(user),
        "dev_sample_data": False,
    }


def _format_destination_label(shortcode: str, shortcode_type: str) -> str:
    if shortcode_type in {"pochi", "phone"} and len(shortcode) == 12:
        return f"+{shortcode[:3]} {shortcode[3:6]} {shortcode[6:9]} {shortcode[9:]}"
    return shortcode


def _destination_prompt(
    *,
    source: str,
    name: str | None,
    shortcode: str,
    shortcode_type: str,
    account_number: str,
    destination_label: str,
) -> str:
    if source == "mpesa" and name:
        return f"Is this {name}?"
    if shortcode_type == "paybill":
        account = (account_number or "").strip()
        if account:
            return f"Is this your Paybill {destination_label}, account {account}?"
        return f"Is this your Paybill {destination_label}?"
    if shortcode_type == "till":
        return f"Is this your Till {destination_label}?"
    if shortcode_type == "pochi":
        return f"Is this your Pochi number {destination_label}?"
    return f"Is this your M-PESA number {destination_label}?"


@router.post("/business-config/verify")
def verify_merchant_business_config(
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
    try:
        lookup = mpesa_service.lookup_destination_name(
            db,
            shortcode=payload.shortcode,
            shortcode_type=payload.shortcode_type,
        )
    except mpesa_service.MpesaConfigurationMissing as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except mpesa_service.MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    destination_label = _format_destination_label(
        payload.shortcode,
        payload.shortcode_type,
    )
    organization_name = lookup.name or destination_label
    prompt = _destination_prompt(
        source=lookup.source,
        name=lookup.name,
        shortcode=payload.shortcode,
        shortcode_type=payload.shortcode_type,
        account_number=payload.account_number,
        destination_label=destination_label,
    )
    token = mint_mpesa_verify_token(
        account_id=account_id,
        shortcode=payload.shortcode,
        shortcode_type=payload.shortcode_type,
        account_number=payload.account_number,
        organization_name=organization_name,
    )
    return {
        "organization_name": lookup.name,
        "lookup_source": lookup.source,
        "shortcode": payload.shortcode,
        "shortcode_type": payload.shortcode_type,
        "account_number": payload.account_number or None,
        "destination_label": destination_label,
        "verification_token": token,
        "prompt": prompt,
    }


@router.put("/business-config")
def upsert_merchant_business_config(
    payload: MerchantMpesaConfigSavePayload,
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
    try:
        verified = read_mpesa_verify_token(payload.verification_token)
    except MpesaVerifyTokenInvalid as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if (
        str(verified.get("aid") or "") != str(account_id)
        or str(verified.get("sc") or "") != payload.shortcode
        or str(verified.get("st") or "") != payload.shortcode_type
        or str(verified.get("an") or "") != (payload.account_number or "")
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Looked-up details do not match. Look up the destination again.",
        )

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
    config.account_number = payload.account_number.strip() or None
    config.updated_by_user_id = user.id
    config.updated_at = now

    db.commit()
    db.refresh(config)

    return {
        "message": "Merchant M-PESA settlement settings saved.",
        "config": MerchantMpesaConfigOut.from_model(config),
        "suggested_phone": _suggested_merchant_phone(user),
    }
