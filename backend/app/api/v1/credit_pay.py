"""Public credit pay-bill page API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.credit_pay_service import (
    CreditPayError,
    CreditPayService,
    CreditPayUnavailable,
)

router = APIRouter(prefix="/pay-bill", tags=["credit-pay"])


class _PayBillSubmitRequest(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=99_999_999.99)
    consent: bool = False


@router.get("/{token}")
def get_pay_bill_page(token: str, db: Session = Depends(get_db)):
    try:
        return {"data": CreditPayService(db).load(token)}
    except CreditPayUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except CreditPayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/{token}/submit")
def submit_pay_bill(
    token: str,
    payload: _PayBillSubmitRequest,
    db: Session = Depends(get_db),
):
    try:
        result = CreditPayService(db).submit(
            token,
            phone=payload.phone,
            amount=payload.amount,
            consent=payload.consent,
        )
    except CreditPayUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except CreditPayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"data": result}


@router.get("/{token}/collections/{transaction_id}")
def get_pay_bill_collection(
    token: str,
    transaction_id: str,
    db: Session = Depends(get_db),
):
    try:
        return {"data": CreditPayService(db).collection_status(token, transaction_id)}
    except CreditPayUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except CreditPayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
