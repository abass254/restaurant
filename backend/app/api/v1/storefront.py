"""Public, token-authed storefront endpoints.

These routes are intentionally unauthenticated (no merchant session / CSRF) —
exactly like the mobile upload-by-token flow. The signed, single-use token in
the URL is the only credential, and it is scoped to one conversation.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.storefront_service import (
    StorefrontError,
    StorefrontService,
    StorefrontUnavailable,
)

router = APIRouter(prefix="/shop", tags=["storefront"])


class _CheckoutItem(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=999)


class _CheckoutRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=32)
    items: list[_CheckoutItem] = Field(min_length=1, max_length=50)


@router.get("/{token}")
def get_storefront(token: str, db: Session = Depends(get_db)):
    """Resolve a token to the shop's active catalogue.

    Public — used by the storefront page to render products before the
    customer picks anything. Does not consume the token (so the page can be
    refreshed); checkout is what makes the link single-use.
    """
    try:
        return {"data": StorefrontService(db).load_catalogue(token)}
    except StorefrontUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except StorefrontError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/{token}/checkout")
def checkout_storefront(
    token: str,
    payload: _CheckoutRequest,
    db: Session = Depends(get_db),
):
    """Place a multi-item order from the storefront cart and trigger M-PESA."""
    try:
        result = StorefrontService(db).checkout(
            token,
            [item.model_dump() for item in payload.items],
            payload.phone,
        )
    except StorefrontUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except StorefrontError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"data": result}
