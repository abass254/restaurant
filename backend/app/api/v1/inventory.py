from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
    require_store_admin,
)
from app.core.upload_tokens import (
    UPLOAD_TOKEN_MAX_AGE,
    UploadTokenInvalid,
    mint_product_upload_token,
    read_product_upload_token,
    revoke_product_upload_token,
)
from app.core.uploads import delete_upload, save_upload
from app.database import get_db
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import (
    Account,
    InventoryItem,
    MealAddon,
    Product,
    ShopSupplier,
    StockMovement,
    User,
)
from app.schemas import InventoryItemOut, StockMovementOut
from app.services.inventory_import_service import (
    generate_inventory_template,
    import_inventory_from_excel,
)
from app.services.menu_options import menu_options_loaders
from app.services.inventory_stock_service import (
    InsufficientStockError,
    PurchaseVoidError,
    UntrackedStockError,
    adjust_stock,
    apply_unit_costs,
    lock_item,
    record_movement,
    void_purchase,
)
from app.services.sell_units import normalize_buy_units_payload, normalize_sell_units_payload
from app.support.store_type import is_restaurant_account
from app.services.feed_post_link_service import add_post_link
from app.services.platform_instagram import require_merchant_instagram_account
from app.services.product_media_service import (
    after_inventory_media_change,
    coerce_media,
    inventory_media_for_item,
    is_image_media,
)
from app.services.social_publish_service import (
    publish_instagram_media,
    require_instagram_publish_account,
)
from app.support.barcode import product_matches_barcode

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _require_shop(user: User) -> int:
    return active_account_id(user)


def _auth_inventory_user(
    db: Session,
    session: dict,
    *,
    pos_read_ok: bool = False,
    pos_write_ok: bool = False,
) -> User:
    user = require_user(db, session)
    if pos_read_ok or pos_write_ok:
        assert_merchant_section_any_access(
            user, "inventory", "pos", "services", "dashboard",
        )
    else:
        assert_merchant_section_any_access(user, "inventory", "services")
    return user


def _require_stock_qty_allowed(db: Session, user: User, account_id) -> None:
    """Owners may always change quantities; staff only while the shop's
    "Allow item quantity adjustment" setting is on."""
    from app.support.merchant_permissions import is_membership_owner, get_active_membership

    if user.is_super_admin():
        return
    membership = get_active_membership(user)
    if membership is not None and is_membership_owner(user):
        return
    if membership is None and user.is_system_admin():
        return
    account = db.get(Account, account_id)
    if account is not None and account.allow_item_quantity_adjustment:
        return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail="Item quantity adjustment is turned off. Ask the shop owner to enable it in Settings.",
    )


class InventoryCreate(BaseModel):
    product_id: str = Field(min_length=1, max_length=64)
    selling_price: float | None = Field(default=None, ge=0, le=99_999_999.99)
    buying_price: float | None = Field(default=None, ge=0, le=99_999_999.99)
    stock_quantity: Decimal | None = Field(
        default=None,
        ge=0,
        le=99_999_999.999,
        decimal_places=3,
    )
    low_stock_threshold: Decimal | None = Field(
        default=None,
        ge=0,
        le=99_999_999.999,
        decimal_places=3,
    )
    inventory_role: Literal["for_sale", "raw_material", "both"] | None = None
    is_active: bool | None = None
    supplier: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    attributes: dict[str, Any] | None = None


class InventoryUpdate(BaseModel):
    selling_price: float | None = Field(default=None, ge=0, le=99_999_999.99)
    buying_price: float | None = Field(default=None, ge=0, le=99_999_999.99)
    stock_quantity: Decimal | None = Field(
        default=None,
        ge=0,
        le=99_999_999.999,
        decimal_places=3,
    )
    low_stock_threshold: Decimal | None = Field(
        default=None,
        ge=0,
        le=99_999_999.999,
        decimal_places=3,
    )
    inventory_role: Literal["for_sale", "raw_material", "both"] | None = None
    is_active: bool | None = None
    supplier: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    attributes: dict[str, Any] | None = None
    preferred_supplier_id: str | None = Field(default=None, max_length=64)


class StockMovementLineIn(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(gt=0, le=1_000_000, decimal_places=3)
    unit_cost: float | None = Field(default=None, ge=0, le=99_999_999.99)


class StockMovementsCreate(BaseModel):
    direction: Literal["in", "out"]
    reason: Literal["receive", "adjustment", "damage", "other"] = "receive"
    note: str | None = Field(default=None, max_length=500)
    record_only: bool = False
    lines: list[StockMovementLineIn] = Field(min_length=1, max_length=200)


class StockMovementVoid(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


@router.get("")
def list_inventory(
    q: str | None = Query(default=None, max_length=255),
    type: Literal["product", "retail", "meal", "combo", "addon", "service"] | None = Query(default=None),
    role: Literal["for_sale", "raw_material", "both"] | None = Query(default=None),
    active: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = _auth_inventory_user(db, session, pos_read_ok=True)
    account_id = _require_shop(user)

    query = (
        db.query(InventoryItem)
        .options(
            joinedload(InventoryItem.product)
            .selectinload(Product.available_addons)
            .selectinload(MealAddon.addon),
            *menu_options_loaders(joinedload(InventoryItem.product)),
        )
        .filter(InventoryItem.account_id == account_id)
        .order_by(
            InventoryItem.updated_at.is_(None),
            InventoryItem.updated_at.desc(),
            InventoryItem.id.desc(),
        )
    )

    if active is not None:
        query = query.filter(InventoryItem.is_active == active)

    if role is not None:
        query = query.filter(InventoryItem.inventory_role == role)

    if q or type:
        query = query.join(Product, Product.id == InventoryItem.product_id)
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

    rows = query.all()
    return {"data": [InventoryItemOut.from_model(row) for row in rows]}


@router.post("/import")
async def import_inventory_file(
    request: Request,
    file: UploadFile = File(..., description="Inventory Excel (.xlsx) or CSV (.csv) file"),
    stock_mode: Literal["replace", "add", "keep"] = Query(
        default="replace",
        description="Stock mode for existing core inventory items: replace, add, or keep",
    ),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Bulk-import products and stock from an Excel (.xlsx) or CSV (.csv) file."""
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)
    account_id = _require_shop(user)

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
        result = import_inventory_from_excel(
            db,
            content=content,
            account_id=account_id,
            user=user,
            filename=file.filename or "import.xlsx",
            stock_mode=stock_mode,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    return {
        "message": f"Import complete: {result.summary_message()}.",
        "summary": {
            "created": result.created,
            "updated": result.updated,
            "matched_existing": result.matched_existing,
            "skipped": result.skipped,
            "errors": result.errors,
        },
        "detected_columns": result.detected_columns,
        "rows": [
            {
                "row": row.row,
                "name": row.name,
                "sku": row.sku,
                "status": row.status,
                "message": row.message,
            }
            for row in result.rows
        ][:100],
    }


@router.get("/template")
def download_inventory_template_endpoint(
    format: Literal["xlsx", "csv"] = Query(default="xlsx"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Download an inventory import template in Excel (.xlsx) or CSV (.csv) format."""
    _auth_inventory_user(db, session, pos_read_ok=True)
    content, filename, media_type = generate_inventory_template(format)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get("/by-code")
def get_inventory_by_code(
    code: str = Query(..., min_length=1, max_length=120),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Look up an inventory item by products.sku (barcode / SKU scan)."""
    user = _auth_inventory_user(db, session, pos_read_ok=True)
    account_id = _require_shop(user)
    scanned = code.strip()
    if not scanned:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Barcode code is required.",
        )

    rows = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .join(Product, Product.id == InventoryItem.product_id)
        .filter(InventoryItem.account_id == account_id)
        .all()
    )
    matched = [
        row for row in rows if product_matches_barcode(row.product, scanned)
    ]
    if not matched:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f'No product matched "{scanned}".',
        )
    if len(matched) > 1:
        # Prefer exact sku when multiple fuzzy hits.
        exact = [
            row
            for row in matched
            if row.product
            and (row.product.sku or "").strip().lower() == scanned.lower()
        ]
        matched = exact or matched

    return {"data": InventoryItemOut.from_model(matched[0])}


@router.get("/stock-movements")
def list_stock_movements(
    direction: Literal["in", "out"] | None = Query(default=None),
    reason: Literal["receive", "adjustment", "damage", "other"] | None = Query(
        default=None,
    ),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = _auth_inventory_user(db, session, pos_read_ok=True)
    account_id = _require_shop(user)

    query = db.query(StockMovement).filter(StockMovement.account_id == account_id)
    if direction:
        query = query.filter(StockMovement.direction == direction)
    if reason:
        query = query.filter(StockMovement.reason == reason)

    total = query.count()
    rows = (
        query.options(
            joinedload(StockMovement.inventory_item).joinedload(InventoryItem.product),
        )
        .order_by(
            StockMovement.created_at.is_(None),
            StockMovement.created_at.desc(),
            StockMovement.id.desc(),
        )
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    last_page = max(1, (total + per_page - 1) // per_page)
    return {
        "data": [StockMovementOut.from_model(row, include_item=True) for row in rows],
        "meta": {
            "current_page": page,
            "last_page": last_page,
            "per_page": per_page,
            "total": total,
        },
    }


@router.post("/stock-movements", status_code=status.HTTP_201_CREATED)
def create_stock_movements(
    payload: StockMovementsCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Commit a stock-in or stock-out session as atomic delta adjustments."""
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session, pos_write_ok=True)
    account_id = _require_shop(user)

    reason = payload.reason
    if payload.direction == "out" and reason == "receive":
        reason = "adjustment"
    if payload.record_only and (payload.direction != "in" or reason != "receive"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="History-only stock rows can only be recorded as purchases.",
        )

    # Purchases (stock-in / receive) are allowed for inventory staff; other
    # quantity changes need the owner or the quantity-adjustment setting.
    is_purchase = payload.direction == "in" and reason == "receive"
    if not is_purchase:
        _require_stock_qty_allowed(db, user, account_id)

    lines = [(line.inventory_item_id, line.quantity) for line in payload.lines]
    try:
        movements = adjust_stock(
            db,
            lines,
            direction=payload.direction,
            account_id=str(account_id),
            reason=reason,
            note=payload.note,
            user_id=str(user.id),
            record_only=payload.record_only,
        )
    except InsufficientStockError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except UntrackedStockError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    costs = {
        line.inventory_item_id: line.unit_cost
        for line in payload.lines
        if line.unit_cost is not None
    }
    if costs:
        apply_unit_costs(
            movements,
            costs,
            update_buying_price=not payload.record_only,
        )

    db.commit()
    for movement in movements:
        db.refresh(movement)
        db.refresh(movement, attribute_names=["inventory_item"])
        if movement.inventory_item is not None:
            db.refresh(movement.inventory_item, attribute_names=["product"])

    verb = "received" if payload.direction == "in" else "issued"
    return {
        "message": f"Stock {verb} for {len(movements)} item(s).",
        "data": [
            StockMovementOut.from_model(m, include_item=True) for m in movements
        ],
    }


@router.post("/stock-movements/{movement_id}/void")
def void_stock_movement(
    movement_id: str,
    payload: StockMovementVoid,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Void a purchase and remove the stock it added."""
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session, pos_write_ok=True)
    require_store_admin(user, "Only the store admin can void a purchase.")
    account_id = _require_shop(user)

    try:
        movement = void_purchase(
            db,
            movement_id,
            account_id=str(account_id),
            reason=payload.reason,
            user_id=str(user.id),
        )
    except InsufficientStockError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Only {format(exc.available.normalize(), 'f')} of {exc.product_name} "
                f"left in stock, so {format(exc.requested.normalize(), 'f')} cannot be "
                "taken back out. Adjust the stock first."
            ),
        ) from exc
    except PurchaseVoidError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    if movement is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Purchase not found.")

    db.commit()
    db.refresh(movement)
    db.refresh(movement, attribute_names=["inventory_item"])
    if movement.inventory_item is not None:
        db.refresh(movement.inventory_item, attribute_names=["product"])
    return {
        "message": "Purchase voided.",
        "data": StockMovementOut.from_model(movement, include_item=True),
    }


@router.get("/{item_id}")
def get_inventory_item(
    item_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = _auth_inventory_user(db, session, pos_read_ok=True)
    account_id = _require_shop(user)
    item = _get_owned_item(db, account_id, item_id)
    return {"data": InventoryItemOut.from_model(item)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    payload: InventoryCreate,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session, pos_write_ok=True)
    account_id = _require_shop(user)

    product = db.get(Product, payload.product_id)
    if not product:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": {"product_id": ["Catalog product not found."]}},
        )

    existing = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.product_id == product.id,
        )
        .first()
    )
    if existing is not None:
        if payload.stock_quantity:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"errors": {"product_id": ["This product is already in your inventory."]}},
            )
        # Purchase forms only list active items, so buying a switched-off item
        # lands here; hand back the existing row instead of failing mid-purchase.
        if not existing.is_active:
            existing.is_active = True
            existing.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(existing)
        db.refresh(existing, attribute_names=["product"])
        response.status_code = status.HTTP_200_OK
        return {
            "message": "Already in inventory.",
            "data": InventoryItemOut.from_model(existing),
        }

    stock_quantity = payload.stock_quantity
    low_stock_threshold = payload.low_stock_threshold
    if product.is_service():
        stock_quantity = None
        low_stock_threshold = None
    elif stock_quantity is not None and stock_quantity != 0:
        # Zero qty is used when staff add a new product then record a purchase.
        _require_stock_qty_allowed(db, user, account_id)

    now = datetime.utcnow()
    item = InventoryItem(
        account_id=account_id,
        product_id=product.id,
        buying_price=payload.buying_price,
        selling_price=payload.selling_price,
        stock_quantity=stock_quantity,
        low_stock_threshold=low_stock_threshold,
        inventory_role=payload.inventory_role or "both",
        is_active=True if payload.is_active is None else payload.is_active,
        supplier=payload.supplier,
        location=payload.location,
        notes=payload.notes,
        attributes=payload.attributes,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # Re-load product so the response includes catalog details.
    db.refresh(item, attribute_names=["product"])

    return {
        "message": "Added to inventory.",
        "data": InventoryItemOut.from_model(item),
    }


@router.patch("/{item_id}")
def update_inventory_item(
    item_id: str,
    payload: InventoryUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session, pos_write_ok=True)
    account_id = _require_shop(user)

    item = _get_owned_item(db, account_id, item_id)
    data = payload.model_dump(exclude_unset=True)

    if "stock_quantity" in data:
        _require_stock_qty_allowed(db, user, account_id)

    if data.get("inventory_role") is None:
        data.pop("inventory_role", None)

    if "attributes" in data and data["attributes"] is not None:
        attrs = dict(data["attributes"])
        if "sell_units" in attrs:
            packs = normalize_sell_units_payload(attrs.get("sell_units"))
            if packs:
                attrs["sell_units"] = packs
            else:
                attrs.pop("sell_units", None)
        if "buy_units" in attrs:
            buy_units = normalize_buy_units_payload(attrs.get("buy_units"))
            if buy_units:
                attrs["buy_units"] = buy_units
            else:
                attrs.pop("buy_units", None)
        data["attributes"] = attrs or None

    if item.product and item.product.is_service():
        data["stock_quantity"] = None
        data["low_stock_threshold"] = None

    restaurant = is_restaurant_account(db, account_id)
    if "preferred_supplier_id" in data:
        supplier_id = (data["preferred_supplier_id"] or "").strip() or None
        if supplier_id and not restaurant:
            data.pop("preferred_supplier_id")
        elif supplier_id and not (
            db.query(ShopSupplier.id)
            .filter(ShopSupplier.id == supplier_id, ShopSupplier.account_id == account_id)
            .first()
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"errors": {"preferred_supplier_id": ["Supplier not found."]}},
            )
        else:
            data["preferred_supplier_id"] = supplier_id

    # Restaurants: a typed-in quantity change goes through the ledger as an adjustment.
    new_qty = data.get("stock_quantity") if "stock_quantity" in data else None
    if (
        restaurant
        and new_qty is not None
        and item.stock_quantity is not None
        and Decimal(str(new_qty)) != Decimal(str(item.stock_quantity))
    ):
        data.pop("stock_quantity")
        locked = lock_item(db, item.id, account_id=account_id)
        delta = Decimal(str(new_qty)) - Decimal(str(locked.stock_quantity))
        record_movement(
            db,
            locked,
            account_id=str(account_id),
            direction="in" if delta > 0 else "out",
            quantity=abs(delta),
            reason="adjustment",
            allow_negative=True,
            note="Quantity edited on item",
            user_id=user.id,
        )

    for key, value in data.items():
        setattr(item, key, value)
    item.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(item)

    return {
        "message": "Inventory item updated.",
        "data": InventoryItemOut.from_model(item),
    }


@router.delete("/{item_id}")
def delete_inventory_item(
    item_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)
    account_id = _require_shop(user)

    item = _get_owned_item(db, account_id, item_id)
    db.delete(item)
    db.commit()
    return {"message": "Removed from inventory."}


def _get_owned_item(db: Session, account_id: str, item_id: str) -> InventoryItem:
    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.id == item_id,
            InventoryItem.account_id == account_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    return item


# --- Store-scoped media (photos + videos) --------------------------------


@router.post("/{item_id}/media", status_code=status.HTTP_201_CREATED)
async def upload_inventory_media(
    item_id: str,
    request: Request,
    files: list[UploadFile] = File(..., description="One or more photo/video files."),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Upload media for this shop's inventory row only."""
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)
    account_id = _require_shop(user)

    item = _get_owned_item(db, account_id, item_id)
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No files provided.")

    existing = inventory_media_for_item(item)
    existing_urls = {img["url"] for img in existing}
    added: list[dict[str, Any]] = []

    for file in files:
        record = await save_upload(item.product_id, file, uploader_id=user.id)
        if record["url"] in existing_urls:
            continue
        existing_urls.add(record["url"])
        existing.append(record)
        added.append(record)

    item.media = existing
    flag_modified(item, "media")
    item.updated_at = datetime.utcnow()
    after_inventory_media_change(db, item.product_id)
    db.commit()
    db.refresh(item)

    kind = "file" if len(added) != 1 else (
        "video" if str(added[0].get("content_type", "")).startswith("video/") else "photo"
    )
    return {
        "message": f"Uploaded {len(added)} {kind}{'' if len(added) == 1 else 's'}.",
        "added": added,
        "data": InventoryItemOut.from_model(item),
    }


class PostInventoryMediaRequest(BaseModel):
    url: str = Field(min_length=1, max_length=1024)
    platform: Literal["instagram"] = "instagram"
    caption: str | None = Field(default=None, max_length=2200)


@router.post("/{item_id}/media/post")
def post_inventory_media_to_social(
    item_id: str,
    payload: PostInventoryMediaRequest,
    request: Request,
    db: Session = Depends(get_db),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Publish one inventory photo or video to a connected social channel."""
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)
    account_id = _require_shop(user)

    item = _get_owned_item(db, account_id, item_id)
    existing = inventory_media_for_item(item)
    media = next((img for img in existing if img["url"] == payload.url), None)
    if media is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="That file is not attached to your inventory item.",
        )
    if not str(media.get("content_type") or "").startswith(("image/", "video/")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG, PNG, MP4, or MOV files can be posted to Instagram.",
        )

    ig_account = require_instagram_publish_account(db, user)

    caption = payload.caption.strip() if payload.caption else None
    result = publish_instagram_media(
        services,
        ig_account,
        payload.url,
        content_type=str(media["content_type"]),
        caption=caption,
    )
    media_id = str(result.get("media_id") or result.get("post", {}).get("id") or "")
    if media_id:
        linked = add_post_link(
            db,
            account_id=account_id,
            platform=payload.platform,
            external_post_id=media_id,
            inventory_item_id=item.id,
        )
        if result.get("post"):
            result["post"]["linked_inventory"] = linked
    return result


@router.delete("/{item_id}/media")
def delete_inventory_media(
    item_id: str,
    request: Request,
    url: str = Query(..., min_length=1, max_length=1024),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Remove one media file from this shop's gallery."""
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)
    account_id = _require_shop(user)

    item = _get_owned_item(db, account_id, item_id)
    existing = inventory_media_for_item(item)
    new_media = [img for img in existing if img["url"] != url]
    if len(new_media) == len(existing):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="That file is not attached to your inventory item.",
        )

    item.media = new_media
    flag_modified(item, "media")
    item.updated_at = datetime.utcnow()
    after_inventory_media_change(db, item.product_id)
    db.commit()
    delete_upload(url)
    db.refresh(item)

    return {
        "message": "Media removed.",
        "data": InventoryItemOut.from_model(item),
    }


# --- Mobile QR upload flow (store-scoped) ----------------------------------


class _UploadTokenRequest(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=64)


@router.post("/upload-tokens", status_code=status.HTTP_201_CREATED)
def create_inventory_upload_token(
    payload: _UploadTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)
    account_id = _require_shop(user)

    item = _get_owned_item(db, account_id, payload.inventory_item_id)
    product = item.product
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Catalog product not found.")

    token = mint_product_upload_token(product.id, user.id, inventory_item_id=item.id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=UPLOAD_TOKEN_MAX_AGE)

    from app.config import get_settings

    settings = get_settings()
    base = settings.frontend_url or str(request.base_url).rstrip("/")
    upload_url = f"{base.rstrip('/')}/m/upload/{token}"

    return {
        "token": token,
        "upload_url": upload_url,
        "expires_at": expires_at.isoformat(),
        "expires_in": UPLOAD_TOKEN_MAX_AGE,
        "product": {
            "id": product.id,
            "name": product.name,
            "image_url": product.image_url,
        },
        "inventory_item_id": item.id,
    }


class _RevokeTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=2048)


@router.post("/upload-tokens/revoke")
def revoke_inventory_upload_token(
    payload: _RevokeTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_inventory_user(db, session)

    try:
        data = read_product_upload_token(payload.token, check_revoked=False)
    except UploadTokenInvalid:
        return {"message": "Link is already invalid.", "revoked": False}

    minter_id = data.get("uid")
    if minter_id is not None and str(minter_id) != str(user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="This link was created by a different user.",
        )

    revoke_product_upload_token(payload.token)
    return {"message": "Link expired.", "revoked": True}


@router.get("/upload-by-token/{token}")
def describe_inventory_upload_token(token: str, db: Session = Depends(get_db)):
    try:
        payload = read_product_upload_token(token)
    except UploadTokenInvalid as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))

    inventory_item_id = str(payload.get("iid") or "")
    if not inventory_item_id:
        raise HTTPException(
            status.HTTP_410_GONE,
            detail="This upload link is outdated. Generate a new one from your shop.",
        )

    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.id == inventory_item_id)
        .first()
    )
    if item is None or str(payload.get("pid")) != item.product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")

    product = item.product
    return {
        "data": {
            "product_id": product.id if product else item.product_id,
            "inventory_item_id": item.id,
            "name": product.name if product else "Product",
            "brand": product.brand if product else None,
            "image_url": product.image_url if product else None,
        },
        "expires_in": UPLOAD_TOKEN_MAX_AGE,
    }


@router.post("/upload-by-token/{token}", status_code=status.HTTP_201_CREATED)
async def upload_inventory_media_via_token(
    token: str,
    files: list[UploadFile] = File(..., description="One or more photo/video files."),
    db: Session = Depends(get_db),
):
    try:
        payload = read_product_upload_token(token)
    except UploadTokenInvalid as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))

    inventory_item_id = str(payload.get("iid") or "")
    if not inventory_item_id:
        raise HTTPException(
            status.HTTP_410_GONE,
            detail="This upload link is outdated. Generate a new one from your shop.",
        )

    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.id == inventory_item_id)
        .first()
    )
    if item is None or str(payload.get("pid")) != item.product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No files provided.")

    uploader_id = payload.get("uid")
    uploader_id = str(uploader_id) if isinstance(uploader_id, str) else None

    existing = inventory_media_for_item(item)
    existing_urls = {img["url"] for img in existing}
    added: list[dict[str, Any]] = []

    for file in files:
        record = await save_upload(item.product_id, file, uploader_id=uploader_id)
        if record["url"] in existing_urls:
            continue
        existing_urls.add(record["url"])
        existing.append(record)
        added.append(record)

    item.media = existing
    flag_modified(item, "media")
    item.updated_at = datetime.utcnow()
    after_inventory_media_change(db, item.product_id)
    db.commit()
    db.refresh(item)

    return {
        "message": f"Uploaded {len(added)} file{'s' if len(added) != 1 else ''}.",
        "added": added,
        "count": len(existing),
    }
