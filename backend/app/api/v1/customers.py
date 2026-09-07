"""Merchant shop customers and credit limits."""

from __future__ import annotations

from decimal import Decimal

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import MpesaTransaction, ShopCustomer
from app.services.customer_service import (
    CustomerService,
    CustomerServiceError,
    available_credit,
)
from app.services.mpesa_service import (
    MpesaApiError,
    MpesaConfigurationMissing,
    apply_credit_collection_if_paid,
    get_merchant_profile,
    stk_push,
    use_mpesa_sandbox,
)
from app.services.platform_instagram import require_merchant_account_id
from app.support.datetime_utils import as_utc
from app.support.merchant_permissions import (
    assert_merchant_section_access,
    assert_merchant_section_any_access,
)
from app.support.mpesa_merchant_copy import merchant_safe_stk_error

router = APIRouter(prefix="/customers", tags=["customers"])

TILL_CUSTOMER_SECTIONS = ("customer", "pos", "dashboard")


class CustomerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=7, max_length=32)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    credit_limit: float = Field(default=0, ge=0, le=99_999_999.99)


class CustomerUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, min_length=7, max_length=32)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    credit_limit: float | None = Field(default=None, ge=0, le=99_999_999.99)


class CreditCollectRequest(BaseModel):
    amount: float = Field(gt=0, le=99_999_999.99)


class CustomerOut(BaseModel):
    id: str
    name: str
    phone: str
    email: str | None = None
    address: str | None = None
    notes: str | None = None
    credit_limit: float
    outstanding_balance: float
    available_credit: float
    created_at: str | None = None
    updated_at: str | None = None


def _money_out(value: object | None) -> float:
    return float(Decimal(str(value or 0)).quantize(Decimal("0.01")))


def _iso(dt) -> str | None:
    aware = as_utc(dt)
    return aware.isoformat() if aware else None


def _customer_out(customer: ShopCustomer) -> CustomerOut:
    limit = customer.credit_limit
    outstanding = customer.outstanding_balance
    return CustomerOut(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        email=customer.email,
        address=customer.address,
        notes=customer.notes,
        credit_limit=_money_out(limit),
        outstanding_balance=_money_out(outstanding),
        available_credit=_money_out(available_credit(limit, outstanding)),
        created_at=_iso(customer.created_at),
        updated_at=_iso(customer.updated_at),
    )


def _raise_service_error(exc: CustomerServiceError) -> NoReturn:
    message = str(exc)
    code = (
        status.HTTP_404_NOT_FOUND
        if message == "Customer not found."
        else status.HTTP_422_UNPROCESSABLE_ENTITY
    )
    raise HTTPException(code, detail=message) from exc


@router.get("")
def list_customers(
    q: str | None = Query(default=None),
    owing: bool = Query(default=False),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    rows = CustomerService(db).list_customers(account_id, query=q, owing=owing)
    payload: dict[str, object] = {
        "data": [_customer_out(row) for row in rows],
        "total": len(rows),
    }
    if owing:
        payload["owing_total"] = _money_out(
            sum(
                (Decimal(str(row.outstanding_balance or 0)) for row in rows),
                Decimal("0.00"),
            ),
        )
    return payload


@router.post("", status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    try:
        customer = CustomerService(db).create_customer(
            account_id,
            name=payload.name,
            phone=payload.phone,
            email=str(payload.email) if payload.email else None,
            address=payload.address,
            notes=payload.notes,
            credit_limit=payload.credit_limit,
        )
    except CustomerServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Customer saved.", "data": _customer_out(customer)}


@router.get("/{customer_id}")
def get_customer(
    customer_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "customer")
    account_id = require_merchant_account_id(user)
    try:
        customer = CustomerService(db).get_customer(account_id, customer_id)
    except CustomerServiceError as exc:
        _raise_service_error(exc)
    return {"data": _customer_out(customer)}


@router.post("/{customer_id}/update")
def update_customer(
    customer_id: str,
    payload: CustomerUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "customer")
    account_id = require_merchant_account_id(user)
    data = payload.model_dump(exclude_unset=True)
    try:
        customer = CustomerService(db).update_customer(
            account_id,
            customer_id,
            name=data.get("name") if "name" in data else None,
            phone=data.get("phone") if "phone" in data else None,
            email=(
                str(data["email"]).strip().lower()
                if "email" in data and data["email"] is not None
                else None
            ),
            address=data.get("address") if "address" in data else None,
            notes=data.get("notes") if "notes" in data else None,
            credit_limit=data.get("credit_limit") if "credit_limit" in data else None,
            clear_email="email" in data and not data.get("email"),
            clear_address="address" in data and not str(data.get("address") or "").strip(),
            clear_notes="notes" in data and not str(data.get("notes") or "").strip(),
        )
    except CustomerServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Customer details saved.", "data": _customer_out(customer)}


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "customer")
    account_id = require_merchant_account_id(user)
    try:
        CustomerService(db).delete_customer(account_id, customer_id)
    except CustomerServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Customer removed."}


@router.post("/{customer_id}/collect")
def collect_customer_credit(
    customer_id: str,
    payload: CreditCollectRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    try:
        customer = CustomerService(db).get_customer(account_id, customer_id)
    except CustomerServiceError as exc:
        _raise_service_error(exc)

    amount = Decimal(str(payload.amount)).quantize(Decimal("0.01"))
    outstanding = Decimal(str(customer.outstanding_balance or 0)).quantize(Decimal("0.01"))
    if amount > outstanding:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That is more than this customer owes.",
        )

    profile = get_merchant_profile(db, account_id)
    if not profile:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Set your M-PESA details in Settings before collecting on a tab.",
        )
    from app.support.mpesa_amounts import min_collection_kes

    kes = int(round(float(amount)))
    min_kes = min_collection_kes(
        profile.shortcode_type if profile else None,
        sandbox=use_mpesa_sandbox(db),
    )
    if kes < min_kes:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"M-PESA's minimum is KES {min_kes}.",
        )

    try:
        txn = stk_push(
            db,
            phone_number=customer.phone,
            amount=kes,
            account_reference=f"TAB{customer.id[:8]}",
            transaction_desc=f"Tab {customer.name}"[:13],
            initiated_by_user_id=user.id,
            account_id=account_id,
            shop_customer_id=customer.id,
            credit_collect_amount=kes,
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
        "message": f"Prompt sent to {txn.phone_number}. Ask them to check their phone.",
        "data": _customer_out(customer),
        "collection": {
            "id": txn.id,
            "status": txn.status,
            "amount": kes,
        },
    }


@router.get("/{customer_id}/collections/{transaction_id}")
def get_credit_collection(
    customer_id: str,
    transaction_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    txn = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.id == transaction_id,
            MpesaTransaction.shop_customer_id == customer_id,
            MpesaTransaction.account_id == account_id,
        )
        .first()
    )
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Collection not found.")
    if txn.status == "success":
        apply_credit_collection_if_paid(db, txn)
        db.commit()
        db.refresh(txn)
    try:
        customer = CustomerService(db).get_customer(account_id, customer_id)
    except CustomerServiceError as exc:
        _raise_service_error(exc)
    return {
        "message": txn.result_desc,
        "data": _customer_out(customer),
        "collection": {
            "id": txn.id,
            "status": txn.status,
            "amount": txn.credit_collect_amount or txn.amount,
            "collected": bool(txn.credit_collected_at),
        },
    }
