"""Public order payment page API."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.order_payment_service import (
    OrderPaymentError,
    OrderPaymentService,
    OrderPaymentUnavailable,
)
from app.support.order_status import ALL_FULFILLMENT_TYPES

router = APIRouter(prefix="/pay", tags=["order-payment"])


class _PaymentSubmitRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    phone: str = Field(min_length=6, max_length=32)
    consent: bool = False
    fulfillment_type: Literal["pickup", "delivery"] = "delivery"
    delivery_location: str | None = Field(default=None, max_length=2000)
    delivery_instructions: str | None = Field(default=None, max_length=2000)


@router.get("/{token}")
def get_payment_page(token: str, db: Session = Depends(get_db)):
    try:
        return {"data": OrderPaymentService(db).load(token)}
    except OrderPaymentUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except OrderPaymentError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/{token}/submit")
def submit_payment(
    token: str,
    payload: _PaymentSubmitRequest,
    db: Session = Depends(get_db),
):
    try:
        if payload.fulfillment_type not in ALL_FULFILLMENT_TYPES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown fulfillment type: {payload.fulfillment_type}",
            )
        result = OrderPaymentService(db).submit(
            token,
            name=payload.name,
            phone=payload.phone,
            consent=payload.consent,
            fulfillment_type=payload.fulfillment_type,
            delivery_location=payload.delivery_location,
            delivery_instructions=payload.delivery_instructions,
        )
    except OrderPaymentUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except OrderPaymentError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"data": result}
