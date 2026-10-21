"""Restaurant purchase orders (supplies bought from suppliers)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import User
from app.services.inventory_stock_service import InsufficientStockError
from app.services.purchase_order_service import (
    LineInput,
    PurchaseOrderError,
    PurchaseOrderNotFound,
    PurchaseOrderService,
    ReceiveInput,
    purchase_order_out,
    supply_item_out,
)
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
    require_store_admin,
)
from app.support.store_type import require_restaurant_account

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])

SECTIONS = ("supplier", "inventory", "dashboard")


class LineIn(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(gt=0, le=1_000_000, decimal_places=3)
    unit_cost: Decimal = Field(ge=0, le=99_999_999.99, decimal_places=2)
    purchase_unit: str | None = Field(default=None, max_length=64)
    unit_factor: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=4)


class PurchaseOrderCreate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=64)
    status: Literal["draft", "ordered"] = "draft"
    order_date: date | None = None
    expected_date: date | None = None
    supplier_invoice_no: str | None = Field(default=None, max_length=120)
    discount: Decimal | None = Field(default=None, ge=0, le=99_999_999.99, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    lines: list[LineIn] = Field(min_length=1, max_length=200)
    # Record the delivery straight away (supplies arrived with the invoice).
    receive_now: bool = False
    amount_paid: Decimal | None = Field(default=None, ge=0, le=99_999_999.99, decimal_places=2)


class PurchaseOrderUpdate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=64)
    order_date: date | None = None
    expected_date: date | None = None
    supplier_invoice_no: str | None = Field(default=None, max_length=120)
    discount: Decimal | None = Field(default=None, ge=0, le=99_999_999.99, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    lines: list[LineIn] | None = Field(default=None, min_length=1, max_length=200)


class ReceiveLineIn(BaseModel):
    line_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(ge=0, le=1_000_000, decimal_places=3)
    unit_cost: Decimal | None = Field(default=None, ge=0, le=99_999_999.99, decimal_places=2)


class ReceiveRequest(BaseModel):
    lines: list[ReceiveLineIn] = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=500)


class PaymentRequest(BaseModel):
    amount: Decimal = Field(ge=-99_999_999.99, le=99_999_999.99, decimal_places=2)


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


def _shop(db: Session, session: dict) -> tuple[User, str]:
    user = require_user(db, session)
    assert_merchant_section_any_access(user, *SECTIONS)
    account_id = str(active_account_id(user))
    require_restaurant_account(db, account_id)
    return user, account_id


def _raise(exc: Exception) -> NoReturn:
    if isinstance(exc, PurchaseOrderNotFound):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


def _line_inputs(lines: list[LineIn]) -> list[LineInput]:
    return [
        LineInput(
            inventory_item_id=line.inventory_item_id,
            quantity=line.quantity,
            unit_cost=line.unit_cost,
            purchase_unit=line.purchase_unit,
            unit_factor=line.unit_factor,
        )
        for line in lines
    ]


def _detail(service: PurchaseOrderService, account_id: str, po_id: str) -> dict:
    po = service.get(account_id, po_id)
    return purchase_order_out(po, receipts=service.receipts(account_id, po_id))


@router.get("")
def list_purchase_orders(
    status_filter: str | None = Query(default=None, alias="status", max_length=24),
    supplier_id: str | None = Query(default=None, max_length=64),
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    rows = service.list(account_id, status=status_filter, supplier_id=supplier_id, q=q)
    payload: dict = {"data": [purchase_order_out(po) for po in rows], "total": len(rows)}
    if supplier_id:
        payload["supplier_summary"] = service.supplier_summary(account_id, supplier_id)
    return payload


@router.get("/supply-items")
def list_supply_items(
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Core inventory rows that can be bought (ingredients and directly-sold goods)."""
    _, account_id = _shop(db, session)
    rows = PurchaseOrderService(db).supply_items(account_id, q)
    return {"data": [supply_item_out(item) for item in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    try:
        po = service.create(
            account_id,
            user_id=user.id,
            supplier_id=payload.supplier_id,
            lines=_line_inputs(payload.lines),
            status="ordered" if payload.receive_now else payload.status,
            order_date=payload.order_date,
            expected_date=payload.expected_date,
            supplier_invoice_no=payload.supplier_invoice_no,
            discount=payload.discount,
            notes=payload.notes,
        )
        if payload.receive_now:
            service.receive(
                account_id,
                po.id,
                [
                    ReceiveInput(line_id=line.id, quantity=Decimal(str(line.quantity_ordered)))
                    for line in po.lines
                ],
                user_id=user.id,
            )
        if payload.amount_paid:
            service.record_payment(account_id, po.id, payload.amount_paid)
    except (PurchaseOrderError, InsufficientStockError) as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"message": f"Purchase order {po.reference} saved.", "data": _detail(service, account_id, po.id)}


@router.get("/{po_id}")
def show_purchase_order(
    po_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _shop(db, session)
    try:
        return {"data": _detail(PurchaseOrderService(db), account_id, po_id)}
    except PurchaseOrderError as exc:
        _raise(exc)


@router.post("/{po_id}/update")
def update_purchase_order(
    po_id: str,
    payload: PurchaseOrderUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    fields = set(payload.model_dump(exclude_unset=True).keys())
    try:
        service.update(
            account_id,
            po_id,
            supplier_id=payload.supplier_id,
            lines=_line_inputs(payload.lines) if payload.lines is not None else None,
            order_date=payload.order_date,
            expected_date=payload.expected_date,
            supplier_invoice_no=payload.supplier_invoice_no,
            discount=payload.discount,
            notes=payload.notes,
            fields=fields,
        )
    except PurchaseOrderError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"message": "Purchase order updated.", "data": _detail(service, account_id, po_id)}


@router.post("/{po_id}/order")
def mark_purchase_order_ordered(
    po_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    try:
        service.mark_ordered(account_id, po_id)
    except PurchaseOrderError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"message": "Marked as ordered.", "data": _detail(service, account_id, po_id)}


@router.post("/{po_id}/receive")
def receive_purchase_order(
    po_id: str,
    payload: ReceiveRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    try:
        po, movements = service.receive(
            account_id,
            po_id,
            [
                ReceiveInput(line_id=row.line_id, quantity=row.quantity, unit_cost=row.unit_cost)
                for row in payload.lines
            ],
            user_id=user.id,
            note=payload.note,
        )
    except (PurchaseOrderError, InsufficientStockError) as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {
        "message": f"Received {len(movements)} suppl{'y' if len(movements) == 1 else 'ies'} into stock.",
        "data": _detail(service, account_id, po_id),
    }


@router.post("/{po_id}/payments")
def record_purchase_order_payment(
    po_id: str,
    payload: PaymentRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    try:
        service.record_payment(account_id, po_id, payload.amount)
    except PurchaseOrderError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"message": "Payment recorded.", "data": _detail(service, account_id, po_id)}


@router.post("/{po_id}/cancel")
def cancel_purchase_order(
    po_id: str,
    payload: ReasonRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _shop(db, session)
    service = PurchaseOrderService(db)
    try:
        service.cancel(account_id, po_id, payload.reason)
    except PurchaseOrderError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"message": "Purchase order cancelled.", "data": _detail(service, account_id, po_id)}


@router.post("/receipts/{movement_id}/void")
def void_purchase_order_receipt(
    movement_id: str,
    payload: ReasonRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user, account_id = _shop(db, session)
    require_store_admin(user, "Only the store admin can void a delivery.")
    service = PurchaseOrderService(db)
    try:
        po = service.void_receipt(account_id, movement_id, reason=payload.reason, user_id=user.id)
    except (PurchaseOrderError, InsufficientStockError) as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"message": "Delivery voided and stock taken back out.", "data": _detail(service, account_id, po.id)}
