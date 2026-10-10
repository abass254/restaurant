"""Merchant shop suppliers directory."""

from __future__ import annotations

from datetime import date
from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import ShopSupplier
from app.services.platform_instagram import require_merchant_account_id
from app.services.supplier_import_service import (
    generate_supplier_template,
    import_suppliers_from_excel,
)
from app.services.supplier_service import SupplierService, SupplierServiceError
from app.support.datetime_utils import as_utc
from app.support.merchant_permissions import (
    assert_merchant_section_access,
    assert_merchant_section_any_access,
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])

TILL_SUPPLIER_SECTIONS = ("supplier", "inventory", "dashboard")


class SupplierCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=7, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)
    balance: float | None = Field(default=0.0)
    balance_due_date: date | None = None
    address: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=64)
    postalcode: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=255)
    fax: str | None = Field(default=None, max_length=64)
    pin_number: str | None = Field(default=None, max_length=64)


class SupplierUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, min_length=7, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)
    balance: float | None = None
    balance_due_date: date | None = None
    address: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=64)
    postalcode: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=255)
    fax: str | None = Field(default=None, max_length=64)
    pin_number: str | None = Field(default=None, max_length=64)


class SupplierOut(BaseModel):
    id: str
    name: str
    phone: str | None = None
    notes: str | None = None
    balance: float | None = None
    balance_due_date: str | None = None
    address: str | None = None
    postal_code: str | None = None
    postalcode: str | None = None
    city: str | None = None
    email: str | None = None
    fax: str | None = None
    pin_number: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


def _iso(dt) -> str | None:
    aware = as_utc(dt)
    return aware.isoformat() if aware else None


def _supplier_out(supplier: ShopSupplier) -> SupplierOut:
    bal = float(supplier.balance) if supplier.balance is not None else 0.0
    return SupplierOut(
        id=supplier.id,
        name=supplier.name,
        phone=supplier.phone,
        notes=supplier.notes,
        balance=bal,
        balance_due_date=(
            supplier.balance_due_date.isoformat() if supplier.balance_due_date else None
        ),
        address=supplier.address,
        postal_code=supplier.postal_code,
        postalcode=supplier.postal_code,
        city=supplier.city,
        email=supplier.email,
        fax=supplier.fax,
        pin_number=supplier.pin_number,
        created_at=_iso(supplier.created_at),
        updated_at=_iso(supplier.updated_at),
    )


def _raise_service_error(exc: SupplierServiceError) -> NoReturn:
    message = str(exc)
    code = (
        status.HTTP_404_NOT_FOUND
        if message == "Supplier not found."
        else status.HTTP_422_UNPROCESSABLE_ENTITY
    )
    raise HTTPException(code, detail=message) from exc


@router.get("")
def list_suppliers(
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_SUPPLIER_SECTIONS)
    account_id = require_merchant_account_id(user)
    rows = SupplierService(db).list_suppliers(account_id, query=q)
    return {"data": [_supplier_out(row) for row in rows], "total": len(rows)}


@router.get("/template")
def download_supplier_template(
    format: Literal["xlsx", "csv"] = Query(default="xlsx"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Download a ready-to-use Excel or CSV template for importing suppliers."""
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_SUPPLIER_SECTIONS)

    content, filename, media_type = generate_supplier_template(format=format)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_SUPPLIER_SECTIONS)
    account_id = require_merchant_account_id(user)
    p_code = payload.postal_code or payload.postalcode
    try:
        supplier = SupplierService(db).create_supplier(
            account_id,
            name=payload.name,
            phone=payload.phone,
            notes=payload.notes,
            balance=payload.balance,
            balance_due_date=payload.balance_due_date,
            address=payload.address,
            postal_code=p_code,
            city=payload.city,
            email=payload.email,
            fax=payload.fax,
            pin_number=payload.pin_number,
        )
    except SupplierServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Supplier saved.", "data": _supplier_out(supplier)}


@router.post("/import")
async def import_suppliers_file(
    request: Request,
    file: UploadFile = File(..., description="Supplier list (.xlsx or .csv)"),
    mode: Literal["merge", "replace"] = Query(
        default="merge",
        description="merge: add/update from file; replace: file becomes the full supplier list",
    ),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Bulk-import suppliers from Excel (.xlsx) or CSV (.csv) file."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_SUPPLIER_SECTIONS)
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
        result = import_suppliers_from_excel(
            db,
            content=content,
            account_id=account_id,
            filename=file.filename or "suppliers.xlsx",
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


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "supplier")
    account_id = require_merchant_account_id(user)
    try:
        supplier = SupplierService(db).get_supplier(account_id, supplier_id)
    except SupplierServiceError as exc:
        _raise_service_error(exc)
    return {"data": _supplier_out(supplier)}


@router.post("/{supplier_id}/update")
def update_supplier(
    supplier_id: str,
    payload: SupplierUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "supplier")
    account_id = require_merchant_account_id(user)
    data = payload.model_dump(exclude_unset=True)
    p_code = data.get("postal_code") or data.get("postalcode")
    try:
        supplier = SupplierService(db).update_supplier(
            account_id,
            supplier_id,
            name=data.get("name"),
            phone=data.get("phone"),
            notes=data.get("notes"),
            balance=data.get("balance"),
            balance_due_date=data.get("balance_due_date"),
            clear_balance_due_date=(
                "balance_due_date" in data and data.get("balance_due_date") is None
            ),
            address=data.get("address"),
            postal_code=p_code,
            city=data.get("city"),
            email=data.get("email"),
            fax=data.get("fax"),
            pin_number=data.get("pin_number"),
            clear_notes="notes" in data and not str(data.get("notes") or "").strip(),
        )
    except SupplierServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Supplier details saved.", "data": _supplier_out(supplier)}


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "supplier")
    account_id = require_merchant_account_id(user)
    try:
        SupplierService(db).delete_supplier(account_id, supplier_id)
    except SupplierServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Supplier removed."}
