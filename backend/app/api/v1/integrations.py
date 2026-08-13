"""Merchant integration API — API keys + delivery order create (Postman-ready)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import get_bearer_token, require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.services.integration_order_service import (
    IntegrationOrderError,
    IntegrationOrderService,
)
from app.services.merchant_api_key_service import (
    KEY_PREFIX,
    SCOPE_ORDERS_CREATE,
    MerchantApiKeyError,
    MerchantApiKeyService,
)
from app.services.platform_instagram import require_merchant_account_id
from app.support.datetime_utils import as_utc
from app.support.merchant_permissions import assert_merchant_section_any_access

router = APIRouter(prefix="/integrations", tags=["integrations"])


# --- Schemas ----------------------------------------------------------------


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] | None = Field(
        default=None,
        description="Defaults to orders:create. Only this scope is used today.",
    )


class ApiKeyOut(BaseModel):
    id: str
    name: str
    key_prefix: str
    scopes: list[str]
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime | None


class ApiKeyCreatedOut(ApiKeyOut):
    api_key: str = Field(
        description="Full secret — shown once. Store it securely; it cannot be retrieved again.",
    )


class DeliveryOrderItemIn(BaseModel):
    inventory_item_id: str | None = Field(default=None, max_length=64)
    product_name: str | None = Field(default=None, max_length=255)
    product_sku: str | None = Field(default=None, max_length=120)
    quantity: int = Field(ge=1, le=10_000)
    unit_price: float | None = Field(default=None, ge=0, le=99_999_999.99)
    notes: str | None = Field(default=None, max_length=1000)


class DeliveryOrderCreateRequest(BaseModel):
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str = Field(min_length=5, max_length=32)
    delivery_address: str = Field(min_length=3, max_length=2000)
    delivery_notes: str | None = Field(default=None, max_length=2000)
    customer_email: str | None = Field(default=None, max_length=255)
    delivery_fee: float = Field(default=0, ge=0, le=99_999_999.99)
    discount: float = Field(default=0, ge=0, le=99_999_999.99)
    currency: str = Field(default="KES", min_length=2, max_length=8)
    payment_method: Literal["mpesa", "cash", "card", "other"] | None = "cash"
    source: Literal[
        "walkin",
        "phone_call",
        "instagram",
        "whatsapp",
        "tiktok",
        "facebook",
    ] = "phone_call"
    notes: str | None = Field(default=None, max_length=4000)
    external_order_id: str | None = Field(
        default=None,
        max_length=128,
        description="Optional idempotency key from your system. Replays return the same order.",
    )
    items: list[DeliveryOrderItemIn] = Field(min_length=1, max_length=100)


# --- Helpers ----------------------------------------------------------------


def _key_out(row) -> ApiKeyOut:
    return ApiKeyOut(
        id=row.id,
        name=row.name,
        key_prefix=row.key_prefix,
        scopes=[s for s in (row.scopes or "").split(",") if s],
        last_used_at=as_utc(row.last_used_at),
        revoked_at=as_utc(row.revoked_at),
        created_at=as_utc(row.created_at),
    )


def _extract_api_key(
    request: Request,
    x_api_key: str | None,
) -> str:
    """Prefer X-Api-Key; also accept Bearer duk_live_… (not session cookies)."""
    header_key = (x_api_key or "").strip()
    if header_key:
        return header_key

    bearer = get_bearer_token(request)
    if bearer and bearer.startswith(KEY_PREFIX):
        return bearer

    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Missing API key. Send header X-Api-Key: duk_live_… "
            "or Authorization: Bearer duk_live_…"
        ),
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_api_key(
    request: Request,
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
):
    raw = _extract_api_key(request, x_api_key)
    try:
        return MerchantApiKeyService(db).authenticate(
            raw,
            required_scope=SCOPE_ORDERS_CREATE,
        )
    except MerchantApiKeyError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# --- API key management (dashboard / session) -------------------------------


@router.get("/api-keys")
def list_api_keys(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "settings")
    account_id = require_merchant_account_id(user)
    rows = MerchantApiKeyService(db).list_keys(account_id)
    return {"data": [_key_out(row) for row in rows]}


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
def create_api_key(
    payload: ApiKeyCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "settings")
    account_id = require_merchant_account_id(user)

    scopes = payload.scopes or [SCOPE_ORDERS_CREATE]
    try:
        row, raw = MerchantApiKeyService(db).create_key(
            account_id,
            name=payload.name,
            created_by_user_id=user.id,
            scopes=",".join(scopes),
        )
    except MerchantApiKeyError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    out = ApiKeyCreatedOut(**_key_out(row).model_dump(), api_key=raw)
    return {
        "message": "API key created. Copy it now — it will not be shown again.",
        "data": out,
    }


@router.post("/api-keys/{key_id}/revoke")
def revoke_api_key(
    key_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "settings")
    account_id = require_merchant_account_id(user)
    try:
        row = MerchantApiKeyService(db).revoke_key(account_id, key_id)
    except MerchantApiKeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"message": "API key revoked.", "data": _key_out(row)}


# --- Delivery orders (API key) ----------------------------------------------


@router.post("/delivery-orders", status_code=status.HTTP_201_CREATED)
def create_delivery_order(
    payload: DeliveryOrderCreateRequest,
    api_key=Depends(require_api_key),
    db: Session = Depends(get_db),
):
    """Create a delivery order using a merchant API key (Postman-friendly).

    Auth (pick one):
    - ``X-Api-Key: duk_live_…``
    - ``Authorization: Bearer duk_live_…``

    No CSRF cookie required. Create keys via ``POST /api/v1/integrations/api-keys``
    while logged into the merchant dashboard.
    """
    service = IntegrationOrderService(db)
    try:
        order, created = service.create_delivery_order(
            api_key.account_id,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            delivery_address=payload.delivery_address,
            delivery_notes=payload.delivery_notes,
            customer_email=payload.customer_email,
            delivery_fee=payload.delivery_fee,
            discount=payload.discount,
            currency=payload.currency,
            payment_method=payload.payment_method,
            source=payload.source,
            notes=payload.notes,
            external_order_id=payload.external_order_id,
            items=[item.model_dump() for item in payload.items],
        )
    except IntegrationOrderError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    db.refresh(order, attribute_names=["items", "status_history"])
    return {
        "message": "Delivery order created." if created else "Delivery order already exists.",
        "created": created,
        "data": service.order_response(order),
    }
