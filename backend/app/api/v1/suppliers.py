"""Merchant shop suppliers directory."""

from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import ShopSupplier
from app.services.platform_instagram import require_merchant_account_id
from app.services.supplier_import_service import import_suppliers_from_excel
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


class SupplierUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, min_length=7, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class SupplierOut(BaseModel):
    id: str
    name: str
    phone: str
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


def _iso(dt) -> str | None:
    aware = as_utc(dt)
    return aware.isoformat() if aware else None


def _supplier_out(supplier: ShopSupplier) -> SupplierOut:
    return SupplierOut(
        id=supplier.id,
        name=supplier.name,
        phone=supplier.phone,
        notes=supplier.notes,
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
    try:
        supplier = SupplierService(db).create_supplier(
            account_id,
            name=payload.name,
            phone=payload.phone,
            notes=payload.notes,
        )
    except SupplierServiceError as exc:
        _raise_service_error(exc)
    return {"message": "Supplier saved.", "data": _supplier_out(supplier)}


@router.post("/import")
async def import_suppliers_excel(
    request: Request,
    file: UploadFile = File(..., description="Supplier list (.xlsx)"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Bulk-import suppliers (name, phone, optional notes)."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *TILL_SUPPLIER_SECTIONS)
    account_id = require_merchant_account_id(user)

    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx"):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload an Excel file (.xlsx).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The file is empty.")

    try:
        result = import_suppliers_from_excel(
            db,
            content=content,
            account_id=account_id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return {
        "message": f"Import complete: {result.summary_message()}.",
        "summary": {
            "created": result.created,
            "updated": result.updated,
            "skipped": result.skipped,
            "errors": result.errors,
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
            if row.status in {"error", "skipped"}
        ][:50],
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
    try:
        supplier = SupplierService(db).update_supplier(
            account_id,
            supplier_id,
            name=data.get("name") if "name" in data else None,
            phone=data.get("phone") if "phone" in data else None,
            notes=data.get("notes") if "notes" in data else None,
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
