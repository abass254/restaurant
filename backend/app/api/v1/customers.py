"""Merchant shop customers and credit limits."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session, selectinload

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, MpesaTransaction, Order, ShopCustomer
from app.services.customer_import_service import (
    generate_customer_template,
    import_customers_from_excel,
)
from app.services.credit_pay_service import CreditPayService
from app.services.openwa_service import OpenWaAgentService
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
from app.support.mpesa_order_link import normalize_mpesa_receipt
from app.support.order_payments import payment_portion
from app.support.order_status import CANCELLED, PAYMENT_CREDIT, PAYMENT_SPLIT, REFUNDED

router = APIRouter(prefix="/customers", tags=["customers"])

TILL_CUSTOMER_SECTIONS = ("customer", "pos", "dashboard")


def _outstanding_adjustment_allowed(db: Session, account_id: str) -> bool:
    account = db.get(Account, account_id)
    return bool(account and getattr(account, "allow_outstanding_adjustment", False))


def _reject_outstanding_adjustment() -> None:
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail="Turn on Adjust Supplier/Customer Outstanding amounts in Settings to change a balance.",
    )
TAB_SALES_LIMIT = 100
TAB_PAYMENTS_LIMIT = 20


class CustomerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=7, max_length=32)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    postal_code: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=120)
    fax: str | None = Field(default=None, max_length=64)
    physical_location: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    credit_limit: float = Field(default=1000.0, ge=0, le=99_999_999.99)
    outstanding_balance: float = Field(default=0.0, ge=0, le=99_999_999.99)
    date_to_pay: date | str | None = None


class WhatsAppVerifyRequest(BaseModel):
    phone: str = Field(min_length=7, max_length=32)


class CustomerUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, min_length=7, max_length=32)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    postal_code: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=120)
    fax: str | None = Field(default=None, max_length=64)
    physical_location: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    credit_limit: float | None = Field(default=None, ge=0, le=99_999_999.99)
    outstanding_balance: float | None = Field(default=None, ge=0, le=99_999_999.99)
    date_to_pay: date | str | None = None


class CreditCollectRequest(BaseModel):
    amount: float = Field(gt=0, le=99_999_999.99)


class ManualCreditCollectRequest(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, le=99_999_999.99, decimal_places=2)
    mpesa_code: str | None = Field(default=None, max_length=50)


class CustomerOut(BaseModel):
    id: str
    name: str
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    postal_code: str | None = None
    city: str | None = None
    fax: str | None = None
    physical_location: str | None = None
    date_to_pay: str | None = None
    notes: str | None = None
    credit_limit: float
    outstanding_balance: float
    available_credit: float
    pay_bill_url: str | None = None
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
    pay_url = None
    if (outstanding or 0) > 0:
        try:
            pay_url = CreditPayService.pay_bill_url(customer.id)
        except Exception:
            pay_url = None
    loc = customer.physical_location or customer.address
    due_str = customer.date_to_pay.isoformat() if customer.date_to_pay else None
    return CustomerOut(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        email=customer.email,
        address=customer.address or loc,
        postal_code=customer.postal_code,
        city=customer.city,
        fax=customer.fax,
        physical_location=loc,
        date_to_pay=due_str,
        notes=customer.notes,
        credit_limit=_money_out(limit),
        outstanding_balance=_money_out(outstanding),
        available_credit=_money_out(available_credit(limit, outstanding)),
        pay_bill_url=pay_url,
        created_at=_iso(customer.created_at),
        updated_at=_iso(customer.updated_at),
    )


def _tab_payment_out(txn: MpesaTransaction) -> dict[str, object]:
    payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
    amount = payload.get("payment_amount") or txn.credit_collect_amount or txn.amount
    return {
        "id": txn.id,
        "amount": _money_out(amount),
        "receipt_code": txn.mpesa_receipt_number,
        "paid_at": _iso(txn.credit_collected_at),
        "manual": bool(payload.get("manual_credit_collection")),
    }


def _require_phone(customer: ShopCustomer, action: str) -> str:
    if not customer.phone:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Add a phone number for {customer.name} before {action}.",
        )
    return customer.phone


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


@router.get("/credit-settings")
def get_customer_credit_settings(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    account = db.get(Account, account_id)
    return {"force_mpesa_prompt": account.force_mpesa_prompt if account else True}


@router.post("/verify-whatsapp")
def verify_whatsapp_number(
    payload: WhatsAppVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Check if a customer phone number is registered on WhatsApp."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)

    agent = OpenWaAgentService()
    if not agent.configured:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="WhatsApp agent is not configured. Set OPENWA_AGENT_TOKEN.",
        )

    result = agent.check_number(payload.phone)
    if not result.ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=result.error or "Could not verify WhatsApp number.",
        )

    return {
        "verified": result.registered,
        "message": (
            f"{payload.phone} is on WhatsApp."
            if result.registered
            else f"{payload.phone} is not registered on WhatsApp."
        ),
    }


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
    if (payload.outstanding_balance or 0) > 0 and not _outstanding_adjustment_allowed(db, account_id):
        _reject_outstanding_adjustment()
    try:
        loc = payload.physical_location or payload.address
        customer = CustomerService(db).create_customer(
            account_id,
            name=payload.name,
            phone=payload.phone,
            email=str(payload.email) if payload.email else None,
            address=payload.address or loc,
            postal_code=payload.postal_code,
            city=payload.city,
            fax=payload.fax,
            physical_location=loc,
            date_to_pay=payload.date_to_pay,
            notes=payload.notes,
            credit_limit=payload.credit_limit,
            outstanding_balance=payload.outstanding_balance,
        )
    except CustomerServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Customer saved.", "data": _customer_out(customer)}


@router.get("/template")
def download_customer_template(
    format: Literal["xlsx", "csv"] = Query(default="xlsx"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Download a ready-to-use Excel or CSV template for importing customers."""
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)

    content, filename, media_type = generate_customer_template(format=format)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_customers_file(
    request: Request,
    file: UploadFile = File(..., description="Customer list (.xlsx or .csv)"),
    mode: Literal["merge", "replace"] = Query(
        default="merge",
        description="merge: add/update from file; replace: file becomes the full customer list",
    ),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Bulk-import customers from Excel (.xlsx) or CSV (.csv) file."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)

    filename = (file.filename or "").lower()
    if not (filename.endswith(".xlsx") or filename.endswith(".xls") or filename.endswith(".csv")):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload an Excel file (.xlsx) or CSV file (.csv).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The file is empty.")

    try:
        result = import_customers_from_excel(
            db,
            content=content,
            account_id=account_id,
            filename=file.filename or "customers.xlsx",
            mode=mode,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return {
        "message": f"Import complete: {result.summary_message()}.",
        "summary": {
            "created": result.created,
            "updated": result.updated,
            "merged": result.merged,
            "skipped": result.skipped,
            "errors": result.errors,
            "removed": result.removed,
            "kept": result.kept,
        },
        "detected_columns": result.detected_columns,
        "rows": [
            {
                "row": row.row,
                "name": row.name,
                "phone": row.phone,
                "status": row.status,
                "message": row.message,
            }
            for row in result.rows
            if row.status not in {"created", "updated"}
        ][:300],
    }


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


@router.get("/{customer_id}/tab")
def get_customer_tab(
    customer_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Credit sales (with line items) and payments behind a customer's balance.

    Payments are not linked to specific sales, so the outstanding balance is
    attributed to the newest sales first (payments clear the oldest debt).
    Whatever is left after all recorded sales is an opening/imported balance.
    """
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    try:
        customer = CustomerService(db).get_customer(account_id, customer_id)
    except CustomerServiceError as exc:
        _raise_service_error(exc)

    orders = (
        db.query(Order)
        .options(selectinload(Order.items))
        .filter(
            Order.account_id == account_id,
            Order.payment_method.in_((PAYMENT_CREDIT, PAYMENT_SPLIT)),
            Order.customer_phone == customer.phone,
            Order.status.notin_((CANCELLED, REFUNDED)),
        )
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(TAB_SALES_LIMIT)
        .all()
        if customer.phone
        else []
    )

    remaining = Decimal(str(customer.outstanding_balance or 0)).quantize(Decimal("0.01"))
    sales = []
    for order in orders:
        if order.payment_method == PAYMENT_SPLIT:
            total = payment_portion(order, PAYMENT_CREDIT)
            if total <= 0:
                continue
        else:
            total = Decimal(str(order.total or 0)).quantize(Decimal("0.01"))
        due = min(total, remaining) if remaining > 0 else Decimal("0.00")
        remaining -= due
        sales.append(
            {
                "id": order.id,
                "order_number": order.order_number,
                "placed_at": _iso(order.placed_at or order.created_at),
                "total": _money_out(total),
                "amount_due": _money_out(due),
                "state": "unpaid" if due == total else ("partial" if due > 0 else "paid"),
                "items": [
                    {
                        "id": item.id,
                        "name": item.product_name,
                        "quantity": item.quantity,
                        "sell_unit": item.sell_unit,
                        "unit_price": _money_out(item.unit_price),
                        "line_total": _money_out(item.line_total),
                    }
                    for item in order.items
                ],
            }
        )

    payments = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.account_id == account_id,
            MpesaTransaction.shop_customer_id == customer.id,
            MpesaTransaction.credit_collected_at.isnot(None),
        )
        .order_by(MpesaTransaction.credit_collected_at.desc())
        .limit(TAB_PAYMENTS_LIMIT)
        .all()
    )

    return {
        "data": {
            "customer_id": customer.id,
            "outstanding_balance": _money_out(customer.outstanding_balance),
            "opening_balance_due": _money_out(max(remaining, Decimal("0.00"))),
            "sales": sales,
            "payments": [
                _tab_payment_out(txn)
                for txn in payments
            ],
        }
    }


@router.get("/{customer_id}/statement")
def get_customer_statement(
    customer_id: str,
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    format: Literal["json", "csv"] = Query(default="json"),
    tz_offset_minutes: int = Query(default=180, ge=-720, le=840),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Full Statement of Account and Cash Flow for a customer."""
    from app.services.statement_service import build_customer_statement, export_statement_csv

    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    try:
        statement = build_customer_statement(
            db,
            account_id,
            customer_id,
            start=start,
            end=end,
            tz_offset_minutes=tz_offset_minutes,
        )
    except CustomerServiceError as exc:
        _raise_service_error(exc)

    if format == "csv":
        content, filename = export_statement_csv(statement)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return {"data": statement}


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
    if "outstanding_balance" in data and not _outstanding_adjustment_allowed(db, account_id):
        _reject_outstanding_adjustment()
    loc = (
        data.get("physical_location")
        if "physical_location" in data
        else (data.get("address") if "address" in data else None)
    )
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
            address=data.get("address") if "address" in data else loc,
            postal_code=(data.get("postal_code") or "") if "postal_code" in data else None,
            city=(data.get("city") or "") if "city" in data else None,
            fax=(data.get("fax") or "") if "fax" in data else None,
            physical_location=loc,
            date_to_pay=data.get("date_to_pay") if "date_to_pay" in data else None,
            notes=data.get("notes") if "notes" in data else None,
            credit_limit=data.get("credit_limit") if "credit_limit" in data else None,
            outstanding_balance=(
                data.get("outstanding_balance") if "outstanding_balance" in data else None
            ),
            clear_email="email" in data and not data.get("email"),
            clear_address="address" in data and not str(data.get("address") or "").strip(),
            clear_physical_location=(
                "physical_location" in data
                and not str(data.get("physical_location") or "").strip()
            ),
            clear_date_to_pay="date_to_pay" in data and not data.get("date_to_pay"),
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
    phone = _require_phone(customer, "sending an M-PESA prompt")

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
            phone_number=phone,
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


@router.post("/{customer_id}/manual-collect")
def manually_collect_customer_credit(
    customer_id: str,
    payload: ManualCreditCollectRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_CUSTOMER_SECTIONS)
    account_id = require_merchant_account_id(user)
    account = db.get(Account, account_id)
    if account is None or account.force_mpesa_prompt is not False:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Manual credit payments are available only when enforce STK push is disabled.",
        )

    customer = (
        db.query(ShopCustomer)
        .filter(
            ShopCustomer.id == customer_id,
            ShopCustomer.account_id == account_id,
        )
        .with_for_update()
        .first()
    )
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found.")

    outstanding = Decimal(str(customer.outstanding_balance or 0)).quantize(Decimal("0.01"))
    if outstanding <= 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This customer does not owe anything.",
        )
    amount = (
        payload.amount.quantize(Decimal("0.01"))
        if payload.amount is not None
        else outstanding
    )
    if amount > outstanding:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That is more than this customer owes.",
        )

    receipt_code = normalize_mpesa_receipt(payload.mpesa_code)
    if receipt_code and not re.fullmatch(r"[A-Z0-9]{6,20}", receipt_code):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid M-PESA transaction code (6–20 letters/numbers).",
        )
    if receipt_code:
        duplicate = (
            db.query(MpesaTransaction)
            .filter(
                MpesaTransaction.status == "success",
                MpesaTransaction.mpesa_receipt_number == receipt_code,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="That M-PESA code is already recorded on another successful payment.",
            )

    try:
        applied = CustomerService(db).collect_credit(customer, amount)
    except CustomerServiceError as exc:
        _raise_service_error(exc)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    collected_amount = int(round(float(applied)))
    txn = MpesaTransaction(
        initiated_by_user_id=user.id,
        phone_number=customer.phone or "",
        amount=collected_amount,
        account_reference=f"TAB{customer.id[:8]}",
        transaction_desc=f"Manual tab payment {customer.name}"[:200],
        status="success",
        result_code=0,
        result_desc=(
            f"Manually recorded credit payment of KES {applied}"
            + (f" with receipt {receipt_code}." if receipt_code else " (no M-PESA code).")
        )[:500],
        mpesa_receipt_number=receipt_code or None,
        completed_at=now,
        callback_payload={
            "manual_credit_collection": True,
            "payment_amount": str(applied),
        },
        account_id=account_id,
        shop_customer_id=customer.id,
        credit_collect_amount=collected_amount,
        credit_collected_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return {
        "message": "Credit payment recorded.",
        "data": _customer_out(customer),
        "collection": {
            "id": txn.id,
            "status": txn.status,
            "amount": float(applied),
            "receipt_code": receipt_code or None,
            "collected": True,
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


@router.post("/{customer_id}/send-whatsapp-reminder")
def send_customer_whatsapp_reminder(
    customer_id: str,
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
    phone = _require_phone(customer, "sending a WhatsApp reminder")

    if customer.outstanding_balance <= 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This customer does not owe anything right now.",
        )

    account = db.query(Account).filter(Account.id == account_id).first()
    shop = (account.business_name if account else None) or "the shop"
    formatted_amount = f"Ksh{customer.outstanding_balance:,.2f}"
    first_name = customer.name.strip().split()[0] if customer.name else ""
    greeting = f"Hi {first_name}, " if first_name else "Hi, "

    pay_bill_url = CreditPayService.pay_bill_url(customer.id)
    text = f"{greeting}this is a payment reminder from {shop} regarding your outstanding tab balance of {formatted_amount}."
    if pay_bill_url:
        text += f"\n\nYou can view your bill details and pay securely via M-PESA here:\n{pay_bill_url}"
    else:
        text += "\n\nPlease reach out to clear your balance via M-PESA. Thank you!"

    agent = OpenWaAgentService()
    if not agent.configured:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="WhatsApp agent is not configured. Set OPENWA_AGENT_TOKEN.",
        )

    result = agent.send_text(to=phone, text=text)
    if not result.ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=result.error or "WhatsApp message could not be sent.",
        )

    return {
        "message": f"WhatsApp reminder sent to {customer.name} ({customer.phone}).",
        "sent": True,
        "message_id": result.message_id,
        "pay_bill_url": pay_bill_url,
    }
