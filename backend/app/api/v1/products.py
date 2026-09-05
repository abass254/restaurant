from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
)
from app.database import get_db
from app.dependencies import get_request_session
from app.models import InventoryItem, Product, User
from app.schemas import ProductOut

router = APIRouter(prefix="/products", tags=["products"])


_SLUG_NON_WORD = re.compile(r"[^a-z0-9]+")
_CODE_INVALID = re.compile(r"[^A-Z0-9_-]")


def _slugify(value: str) -> str:
    """Lowercase kebab-case slug. Matches Laravel `Str::slug` closely enough."""
    return _SLUG_NON_WORD.sub("-", value.lower()).strip("-") or "item"


def _normalize_code(value: str) -> str:
    return _CODE_INVALID.sub("", value.upper().strip())


def _ensure_code_unique(db: Session, code: str, exclude_id: str | None = None) -> None:
    """Raise 422 if `code` is already used by another product."""
    q = db.query(Product.id).filter(Product.product_code == code)
    if exclude_id is not None:
        q = q.filter(Product.id != exclude_id)
    if q.first():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": {"product_code": ["That product code is already taken."]}},
        )


def _next_product_code(db: Session) -> str:
    """Generate the next sequential ``PRD-NNNNNN`` code (skips collisions).

    Product IDs are UUIDs so the counter is derived from the row count
    instead of the highest existing id. The unique index on
    ``product_code`` makes the walk-forward loop safe under concurrency.
    """
    seq = (db.query(func.count(Product.id)).scalar() or 0) + 1
    while True:
        candidate = f"PRD-{seq:06d}"
        exists = db.query(Product.id).filter(Product.product_code == candidate).first()
        if not exists:
            return candidate
        seq += 1


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    product_type: Literal["product", "service"]
    category: str | None = Field(default=None, max_length=120)
    brand: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=4000)
    image_url: HttpUrl | None = None
    product_code: str | None = Field(default=None, max_length=64)
    sku: str | None = Field(default=None, max_length=120)
    attributes: dict[str, Any] | None = None


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    product_type: Literal["product", "service"] | None = None
    category: str | None = Field(default=None, max_length=120)
    brand: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=4000)
    image_url: HttpUrl | None = None
    product_code: str | None = Field(default=None, max_length=64)
    sku: str | None = Field(default=None, max_length=120)
    attributes: dict[str, Any] | None = None


@router.get("")
def list_products(
    q: str | None = Query(default=None, max_length=255),
    type: Literal["product", "service"] | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "pos", "services")

    query = db.query(Product).order_by(Product.name.asc())

    if q:
        term = f"%{q}%"
        query = query.filter(
            or_(
                Product.name.ilike(term),
                Product.brand.ilike(term),
                Product.category.ilike(term),
                Product.product_code.ilike(term),
                Product.sku.ilike(term),
            ),
        )

    if type:
        query = query.filter(Product.product_type == type)

    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()

    product_ids = [row.id for row in rows]
    counts: dict[int, int] = {}
    if product_ids:
        rows_counts = (
            db.query(
                InventoryItem.product_id,
                func.count(func.distinct(InventoryItem.account_id)),
            )
            .filter(InventoryItem.product_id.in_(product_ids))
            .group_by(InventoryItem.product_id)
            .all()
        )
        counts = {pid: cnt for pid, cnt in rows_counts}

    items: list[ProductOut] = []
    for row in rows:
        out = ProductOut.model_validate(row)
        out.shops_carrying_count = counts.get(row.id, 0)
        items.append(out)

    last_page = max(1, (total + per_page - 1) // per_page)
    return {
        "data": items,
        "meta": {
            "current_page": page,
            "last_page": last_page,
            "per_page": per_page,
            "total": total,
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "pos", "services", "dashboard")

    def _clean(value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    explicit_code = _clean(payload.product_code)
    product_code = _normalize_code(explicit_code) if explicit_code else None
    if product_code:
        _ensure_code_unique(db, product_code)
    else:
        product_code = _next_product_code(db)

    now = datetime.utcnow()
    product = Product(
        name=payload.name.strip(),
        slug=_slugify(payload.name),
        product_type=payload.product_type,
        category=_clean(payload.category),
        brand=_clean(payload.brand),
        unit=_clean(payload.unit),
        description=payload.description,
        image_url=str(payload.image_url) if payload.image_url else None,
        product_code=product_code,
        sku=_clean(payload.sku),
        attributes=payload.attributes or None,
        created_by_account_id=active_account_id(user),
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    return {
        "message": "Product added to catalog.",
        "data": ProductOut.model_validate(product),
    }


@router.patch("/{product_id}")
def update_product(
    product_id: str,
    payload: ProductUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "services")

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        data["slug"] = _slugify(data["name"])
    if "image_url" in data and data["image_url"] is not None:
        data["image_url"] = str(data["image_url"])
    if "product_code" in data:
        new_code = data["product_code"]
        if new_code:
            new_code = _normalize_code(new_code)
            _ensure_code_unique(db, new_code, exclude_id=product.id)
            data["product_code"] = new_code
        else:
            data["product_code"] = product.product_code

    for key, value in data.items():
        setattr(product, key, value)
    product.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(product)
    return {
        "message": "Catalog product updated.",
        "data": ProductOut.model_validate(product),
    }


@router.delete("/{product_id}")
def delete_product(
    product_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "services")

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")

    db.delete(product)
    db.commit()
    return {"message": "Catalog product removed."}


@router.get("/{product_id}")
def get_product(
    product_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Single-product detail (used by the inventory detail view)."""
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "pos", "services")
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")

    shops_count = (
        db.query(func.count(func.distinct(InventoryItem.account_id)))
        .filter(InventoryItem.product_id == product.id)
        .scalar()
        or 0
    )
    out = ProductOut.model_validate(product)
    out.shops_carrying_count = shops_count
    return {"data": out}
