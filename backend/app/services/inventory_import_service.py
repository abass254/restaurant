"""Bulk inventory import from Excel product exports.

Accepts flexible column headers from Odoo and SmartSales POS–style exports.
Each row creates or matches a shared catalog ``Product`` and creates/updates
the shop's ``InventoryItem``. Extra Excel columns are stored on
``product.attributes`` / ``inventory_item.attributes``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO
from typing import Any, Literal

from openpyxl import load_workbook
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.products import _slugify
from app.models import InventoryItem, Product, User, _new_uuid
from app.support.merchant_permissions import active_account_id

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2_000

RowStatus = Literal["created", "updated", "skipped", "error"]

# Canonical field -> acceptable Excel header labels (lowercase).
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "name": (
        "name",
        "product name",
        "display name",
        "product",
        "product/name",
    ),
    "sku": (
        "internal reference",
        "default code",
        "sku",
        "reference",
        "product reference",
        "internal ref",
        "sku (leave blank to auto generate sku)",
    ),
    "barcode": ("barcode", "barcodes", "ean", "upc", "ean13"),
    "category": (
        "product category",
        "category",
        "categ_id",
        "product category/name",
        "category/name",
    ),
    "sub_category": ("sub-category", "sub category", "subcategory"),
    "brand": ("brand", "product brand name", "product brand"),
    "unit": (
        "unit of measure",
        "uom",
        "unit",
        "uom name",
        "unit of measure/name",
        "packaging unit",
    ),
    "description": (
        "description",
        "sales description",
        "description sale",
        "internal notes",
        "note",
        "product description",
    ),
    "product_type": (
        "detailed type",
        "type",
        # Exact "product type" only — not "product type (single or variable)".
        "product type",
    ),
    "selling_price": (
        "sales price",
        "list price",
        "sale price",
        "public price",
        "customer price",
        "lst price",
        "selling price",
    ),
    "buying_price": (
        "cost",
        "standard price",
        "cost price",
        "purchase price",
        "unit purchase price",
        "purchase price (excluding tax)",
        "purchase price (including tax)",
    ),
    "buying_price_excl": ("purchase price (excluding tax)",),
    "buying_price_incl": ("purchase price (including tax)",),
    "stock_quantity": (
        "quantity on hand",
        "qty on hand",
        "on hand",
        "current stock",
        "quantity",
        "qty available",
        "available quantity",
        "inventory quantity",
        "forecasted quantity",
        "opening stock",
        "ordered quantities",
    ),
    "low_stock_threshold": (
        "low stock threshold",
        "reorder level",
        "minimum quantity",
        "min quantity",
        "alert quantity",
    ),
    "supplier": (
        "supplier",
        "primary supplier",
        "vendor",
        "vendor name",
    ),
    "location": (
        "product locations",
        "product location",
        "location",
        "warehouse",
        "stock location",
    ),
    "opening_stock_location": ("opening stock location",),
    "image_url": ("image", "image url", "image path", "photo"),
    "notes": ("notes", "inventory notes"),
    "barcode_type": ("barcode type",),
    "manage_stock": (
        "manage stock",
        "manage stock (1=yes 0=no)",
        "track inventory",
    ),
    "expires_in": ("expires in",),
    "expiry_period_unit": (
        "expiry period unit",
        "expiry period unit (months/days)",
    ),
    "expiry_date": ("expiry date",),
    "applicable_tax": ("applicable tax", "taxes_id", "tax"),
    "tax_type": (
        "selling price tax type",
        "selling price tax type (inclusive or exclusive)",
        "tax type",
    ),
    "variant_mode": (
        "product type (single or variable)",
    ),
    "variation_name": (
        "variation name",
        "variation name (keep blank if product type is single)",
    ),
    "variation_values": (
        "variation values",
        "variation values (| seperated values & blank if product type if single)",
        "variation values (| separated values & blank if product type is single)",
    ),
    "variation_skus": (
        "variation skus",
        "variation skus (| seperated values & blank if product type if single)",
        "variation skus (| separated values & blank if product type is single)",
    ),
    "profit_margin": ("profit margin",),
    "enable_imei": (
        "enable imei or serial number",
        "enable imei or serial number(1=yes 0=no)",
    ),
    "weight": ("weight",),
    "rack": ("rack",),
    "shelf_row": ("row",),
    "position": ("position",),
    "custom_field_1": ("custom field 1",),
    "custom_field_2": ("custom field 2",),
    "custom_field_3": ("custom field 3",),
    "custom_field_4": ("custom field 4",),
    "not_for_selling": (
        "not for selling",
        "not for selling(1=yes 0=no)",
    ),
    "origin_country": ("origin country", "country of origin"),
    "etims_product_type": ("etims product type",),
    "unspsc": ("unspsc", "unspsc category"),
    "available_in_pos": ("available in pos",),
}

# Headers we recognise but do not import.
IGNORED_HEADERS = frozenset(
    {
        "id",
        "external id",
        "database id",
        "favorite",
        "active",
        "can be sold",
        "can be purchased",
        "sale_ok",
        "purchase_ok",
        "pos_categ_id/id",
        "pos_categ_id / id",
    },
)

_SERVICE_TYPES = frozenset({"service", "services"})
_PRODUCT_TYPES = frozenset(
    {
        "product",
        "products",
        "storable",
        "storable product",
        "consumable",
        "goods",
        "stockable",
        "stockable product",
        # SmartSales uses single/variable for variants — not catalog type.
        "single",
        "variable",
    },
)

# Product-level attribute keys copied from Excel extras.
_PRODUCT_ATTR_FIELDS = (
    "sub_category",
    "barcode_type",
    "expires_in",
    "expiry_period_unit",
    "expiry_date",
    "applicable_tax",
    "variant_mode",
    "variation_name",
    "variation_values",
    "variation_skus",
    "enable_imei",
    "weight",
    "custom_field_1",
    "custom_field_2",
    "custom_field_3",
    "custom_field_4",
    "origin_country",
    "etims_product_type",
    "unspsc",
    "packaging_unit",
)

# Shop-level attribute keys stored on InventoryItem.attributes.
_INVENTORY_ATTR_FIELDS = (
    "tax_type",
    "profit_margin",
    "manage_stock",
    "rack",
    "shelf_row",
    "position",
    "opening_stock_location",
    "available_in_pos",
)


@dataclass
class ParsedRow:
    row_number: int
    name: str | None = None
    sku: str | None = None
    barcode: str | None = None
    category: str | None = None
    brand: str | None = None
    unit: str | None = None
    description: str | None = None
    product_type: str = "product"
    selling_price: float | None = None
    buying_price: float | None = None
    stock_quantity: int | None = None
    low_stock_threshold: int | None = None
    supplier: str | None = None
    location: str | None = None
    image_url: str | None = None
    notes: str | None = None
    inventory_role: str | None = None
    manage_stock: bool | None = None
    product_attributes: dict[str, Any] = field(default_factory=dict)
    inventory_attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class RowResult:
    row: int
    name: str | None
    sku: str | None
    status: RowStatus
    message: str | None = None


@dataclass
class ImportResult:
    detected_columns: dict[str, str] = field(default_factory=dict)
    rows: list[RowResult] = field(default_factory=list)
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0

    def summary_message(self) -> str:
        parts = []
        if self.created:
            parts.append(f"{self.created} added")
        if self.updated:
            parts.append(f"{self.updated} updated")
        if self.skipped:
            parts.append(f"{self.skipped} skipped")
        if self.errors:
            parts.append(f"{self.errors} failed")
        return ", ".join(parts) or "No rows processed"


def _normalize_header(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = re.sub(r"\s+", " ", text)
    # Odoo relation fields often export as "Field / Subfield".
    text = text.replace("/", " / ")
    text = re.sub(r"\s*/\s*", " / ", text)
    return text.strip()


def _cell_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    # Excel often stores numeric SKUs as floats (1698.0) — keep integer form.
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text or None


def _cell_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _cell_int(value: Any) -> int | None:
    parsed = _cell_float(value)
    if parsed is None:
        return None
    # POS exports often send "12.00" / fractional kg — store nearest whole unit.
    return int(round(parsed))


def _cell_bool01(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "yes", "true", "y"}:
        return True
    if text in {"0", "no", "false", "n"}:
        return False
    return None


def _normalize_code(value: str | None) -> str:
    """Normalize SKU / barcode / product codes for duplicate matching."""
    if not value:
        return ""
    text = str(value).strip().lower()
    if re.fullmatch(r"\d+\.0+", text):
        text = text.split(".", 1)[0]
    return "".join(ch for ch in text if ch.isalnum())


def _normalize_name(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value).strip().lower())


def _product_code_keys(product: Product) -> set[str]:
    keys: set[str] = set()
    for raw in (product.sku, product.product_code):
        key = _normalize_code(raw)
        if key:
            keys.add(key)
    attrs = product.attributes if isinstance(product.attributes, dict) else {}
    for raw in (
        attrs.get("barcode"),
        attrs.get("variation_skus"),
    ):
        if raw is None:
            continue
        # variation_skus may be pipe-separated
        for part in str(raw).split("|"):
            key = _normalize_code(part)
            if key:
                keys.add(key)
    return keys


def _row_code_keys(row: ParsedRow) -> set[str]:
    keys: set[str] = set()
    for raw in (row.sku, row.barcode):
        key = _normalize_code(raw)
        if key:
            keys.add(key)
    for raw in (
        row.product_attributes.get("barcode"),
        row.product_attributes.get("variation_skus"),
    ):
        if raw is None:
            continue
        for part in str(raw).split("|"):
            key = _normalize_code(part)
            if key:
                keys.add(key)
    return keys


def _build_product_indexes(
    db: Session,
) -> tuple[dict[str, Product], dict[str, Product]]:
    """Load catalog once for code/name matching during bulk import."""
    by_code: dict[str, Product] = {}
    by_name: dict[str, Product] = {}
    for product in db.query(Product).all():
        for key in _product_code_keys(product):
            by_code.setdefault(key, product)
        name_key = _normalize_name(product.name)
        if name_key:
            by_name.setdefault(name_key, product)
    return by_code, by_name


def _next_code_allocator(db: Session):
    """Allocate sequential PRD-###### codes without a COUNT query per row."""
    seq = (db.query(func.count(Product.id)).scalar() or 0) + 1
    used = {
        code
        for (code,) in db.query(Product.product_code)
        .filter(Product.product_code.isnot(None))
        .all()
    }

    def allocate() -> str:
        nonlocal seq
        while True:
            candidate = f"PRD-{seq:06d}"
            seq += 1
            if candidate not in used:
                used.add(candidate)
                return candidate

    return allocate


def _index_product(
    product: Product,
    *,
    by_code: dict[str, Product],
    by_name: dict[str, Product],
) -> None:
    for key in _product_code_keys(product):
        by_code[key] = product
    name_key = _normalize_name(product.name)
    if name_key:
        by_name[name_key] = product


def _lookup_product(
    row: ParsedRow,
    *,
    by_code: dict[str, Product],
    by_name: dict[str, Product],
) -> tuple[Product | None, str | None]:
    """Match an existing catalog product to avoid duplicates.

    Priority: SKU / barcode / product_code / variation SKUs, then normalized name.
    """
    for key in _row_code_keys(row):
        match = by_code.get(key)
        if match:
            return match, "code"

    name_key = _normalize_name(row.name)
    if name_key:
        match = by_name.get(name_key)
        if match:
            return match, "name"
    return None, None


def _create_product(
    db: Session,
    row: ParsedRow,
    user: User,
    now: datetime,
    *,
    account_id: str,
    allocate_code,
) -> Product:
    attributes: dict[str, Any] = dict(row.product_attributes)
    if row.barcode:
        attributes.setdefault("barcode", row.barcode)
    attributes.setdefault("import_source", "excel")

    image_url = row.image_url
    if image_url and "default.png" in image_url.lower():
        image_url = None

    product = Product(
        id=_new_uuid(),
        name=row.name or "Unnamed",
        slug=_slugify(row.name or "item"),
        product_type=row.product_type,
        category=row.category,
        brand=row.brand,
        unit=row.unit,
        description=row.description,
        image_url=image_url,
        product_code=allocate_code(),
        sku=row.sku or row.barcode,
        attributes=attributes or None,
        created_by_account_id=account_id,
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(product)
    return product


def _map_product_type(raw: str | None) -> str:
    if not raw:
        return "product"
    key = raw.strip().lower()
    # SmartSales single/variable is variant mode, not product vs service.
    if key in {"single", "variable"}:
        return "product"
    if key in _SERVICE_TYPES:
        return "service"
    if key in _PRODUCT_TYPES:
        return "product"
    if "service" in key:
        return "service"
    return "product"


def _build_column_map(headers: list[str]) -> dict[str, int]:
    """Map canonical field names to column indexes."""
    normalized = [_normalize_header(h) for h in headers]
    mapping: dict[str, int] = {}

    for field_name, aliases in COLUMN_ALIASES.items():
        exact_only = field_name == "product_type"
        for idx, header in enumerate(normalized):
            if not header or header in IGNORED_HEADERS:
                continue
            if header == field_name or header in aliases:
                mapping[field_name] = idx
                break
            if exact_only:
                continue
            # Partial match for Odoo paths / SmartSales long labels.
            for alias in aliases:
                if (
                    header.endswith(f" / {alias}")
                    or header.startswith(f"{alias} (")
                    or header.startswith(f"{alias}(")
                ):
                    mapping[field_name] = idx
                    break
            if field_name in mapping:
                break

    return mapping


def _merge_attrs(
    existing: dict[str, Any] | None,
    incoming: dict[str, Any],
) -> dict[str, Any] | None:
    if not incoming:
        return existing
    merged = dict(existing or {})
    for key, value in incoming.items():
        if value is None or value == "":
            continue
        merged[key] = value
    return merged or None


def _parse_workbook(content: bytes) -> tuple[dict[str, str], list[ParsedRow], list[RowResult]]:
    if len(content) > MAX_IMPORT_BYTES:
        raise ValueError(
            f"File is too large (max {MAX_IMPORT_BYTES // (1024 * 1024)} MB)."
        )

    try:
        workbook = load_workbook(filename=BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError("Could not read the Excel file. Upload a valid .xlsx file.") from exc

    sheet = workbook.active
    if sheet is None:
        raise ValueError("The Excel file has no worksheets.")

    rows_iter = sheet.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise ValueError("The Excel file is empty.")

    headers = [str(h).strip() if h is not None else "" for h in header_row]
    column_map = _build_column_map(headers)
    detected = {
        field: headers[idx]
        for field, idx in column_map.items()
        if idx < len(headers) and headers[idx]
    }

    if "name" not in column_map:
        workbook.close()
        raise ValueError(
            "Could not find a product name column. Export with a "
            "'Name' column (Odoo or SmartSales product export)."
        )

    parsed_rows: list[ParsedRow] = []
    early_errors: list[RowResult] = []

    for row_offset, raw in enumerate(rows_iter, start=2):
        if row_offset > MAX_IMPORT_ROWS + 1:
            early_errors.append(
                RowResult(
                    row=row_offset,
                    name=None,
                    sku=None,
                    status="error",
                    message=f"Import limited to {MAX_IMPORT_ROWS} rows per file.",
                ),
            )
            break

        if raw is None or all(cell is None or str(cell).strip() == "" for cell in raw):
            continue

        def col(field: str) -> Any:
            idx = column_map.get(field)
            if idx is None or idx >= len(raw):
                return None
            return raw[idx]

        name = _cell_str(col("name"))
        if not name:
            early_errors.append(
                RowResult(
                    row=row_offset,
                    name=None,
                    sku=_cell_str(col("sku")),
                    status="skipped",
                    message="Missing product name.",
                ),
            )
            continue

        raw_product_type = _cell_str(col("product_type"))
        variant_mode = _cell_str(col("variant_mode"))
        if not variant_mode and raw_product_type and raw_product_type.lower() in {
            "single",
            "variable",
        }:
            variant_mode = raw_product_type

        product_type = _map_product_type(raw_product_type)

        buying_excl = _cell_float(col("buying_price_excl"))
        buying_incl = _cell_float(col("buying_price_incl"))
        buying_generic = _cell_float(col("buying_price"))
        buying_price = buying_excl if buying_excl is not None else (
            buying_generic if buying_generic is not None else buying_incl
        )

        manage_stock = _cell_bool01(col("manage_stock"))
        stock_qty = _cell_int(col("stock_quantity"))
        if product_type == "service" or manage_stock is False:
            stock_qty = None

        not_for_selling = _cell_bool01(col("not_for_selling"))
        inventory_role = "raw_material" if not_for_selling else None

        product_attrs: dict[str, Any] = {}
        inventory_attrs: dict[str, Any] = {}

        for key in _PRODUCT_ATTR_FIELDS:
            if key == "variant_mode":
                continue
            value = _cell_str(col(key))
            if value is not None:
                product_attrs[key] = value
        if variant_mode:
            product_attrs["variant_mode"] = variant_mode.lower()

        enable_imei = _cell_bool01(col("enable_imei"))
        if enable_imei is not None:
            product_attrs["enable_imei"] = enable_imei

        for key in _INVENTORY_ATTR_FIELDS:
            if key in {"manage_stock", "profit_margin"}:
                continue
            value = _cell_str(col(key))
            if value is not None:
                inventory_attrs[key] = value

        if manage_stock is not None:
            inventory_attrs["manage_stock"] = manage_stock
        profit_margin = _cell_float(col("profit_margin"))
        if profit_margin is not None:
            inventory_attrs["profit_margin"] = profit_margin

        tax_type = _cell_str(col("tax_type"))
        if tax_type:
            inventory_attrs["tax_type"] = tax_type.lower()

        # Prefer dedicated location column; keep opening stock location as attr.
        location = _cell_str(col("location"))
        opening_loc = _cell_str(col("opening_stock_location"))
        if opening_loc:
            inventory_attrs["opening_stock_location"] = opening_loc
            if not location:
                location = opening_loc

        packaging = _cell_str(col("unit"))

        parsed_rows.append(
            ParsedRow(
                row_number=row_offset,
                name=name,
                sku=_cell_str(col("sku")),
                barcode=_cell_str(col("barcode")),
                category=_cell_str(col("category")),
                brand=_cell_str(col("brand")),
                unit=packaging,
                description=_cell_str(col("description")),
                product_type=product_type,
                selling_price=_cell_float(col("selling_price")),
                buying_price=buying_price,
                stock_quantity=stock_qty,
                low_stock_threshold=_cell_int(col("low_stock_threshold")),
                supplier=_cell_str(col("supplier")),
                location=location,
                image_url=_cell_str(col("image_url")),
                notes=_cell_str(col("notes")),
                inventory_role=inventory_role,
                manage_stock=manage_stock,
                product_attributes=product_attrs,
                inventory_attributes=inventory_attrs,
            ),
        )

    workbook.close()
    return detected, parsed_rows, early_errors


def _update_product_from_row(
    product: Product,
    row: ParsedRow,
    now: datetime,
    *,
    matched_by: str | None,
) -> bool:
    """Apply Excel fields onto an existing catalog product.

    Returns True when the display name was changed (code match + different name).
    """
    renamed = False
    attrs = dict(product.attributes or {})
    if row.barcode and "barcode" not in attrs:
        attrs["barcode"] = row.barcode
    attrs = _merge_attrs(attrs, row.product_attributes) or {}
    attrs.setdefault("import_source", "excel")
    product.attributes = attrs or None

    # Code match (SKU/barcode): Excel NAME is authoritative.
    allow_overwrite = matched_by in {"code", "sku"}
    if (
        allow_overwrite
        and row.name
        and row.name.strip()
        and _normalize_name(row.name) != _normalize_name(product.name)
    ):
        product.name = row.name.strip()
        product.slug = _slugify(row.name)
        renamed = True

    if row.category and (not product.category or allow_overwrite):
        product.category = row.category
    if row.brand and (not product.brand or allow_overwrite):
        product.brand = row.brand
    if row.unit and (not product.unit or allow_overwrite):
        product.unit = row.unit
    if row.description and (not product.description or allow_overwrite):
        product.description = row.description
    if row.sku and not product.sku:
        product.sku = row.sku
    elif row.barcode and not product.sku:
        product.sku = row.barcode
    if row.image_url and (not product.image_url or allow_overwrite):
        if "default.png" not in row.image_url.lower():
            product.image_url = row.image_url
    product.updated_at = now
    return renamed


def _upsert_inventory(
    *,
    account_id: str,
    product: Product,
    row: ParsedRow,
    now: datetime,
    existing: InventoryItem | None,
) -> tuple[InventoryItem, bool]:
    """Return (item, created)."""
    created = existing is None
    item = existing
    if item is None:
        item = InventoryItem(
            id=_new_uuid(),
            account_id=account_id,
            product_id=product.id,
            is_active=True,
            created_at=now,
        )

    if row.selling_price is not None:
        item.selling_price = row.selling_price
    if row.buying_price is not None:
        item.buying_price = row.buying_price
    if product.is_service():
        item.stock_quantity = None
        item.low_stock_threshold = None
    else:
        if row.manage_stock is False:
            item.stock_quantity = None
        elif row.stock_quantity is not None:
            item.stock_quantity = row.stock_quantity
        if row.low_stock_threshold is not None:
            item.low_stock_threshold = row.low_stock_threshold
    if row.notes is not None:
        item.notes = row.notes
    if row.supplier is not None:
        item.supplier = row.supplier
    if row.location is not None:
        item.location = row.location
    if row.inventory_role is not None:
        item.inventory_role = row.inventory_role
    if row.inventory_attributes:
        item.attributes = _merge_attrs(item.attributes, row.inventory_attributes)

    item.updated_at = now
    return item, created


def import_inventory_from_excel(
    db: Session,
    *,
    content: bytes,
    account_id: str,
    user: User,
) -> ImportResult:
    detected, parsed_rows, early_results = _parse_workbook(content)
    result = ImportResult(detected_columns=detected)
    result.rows.extend(early_results)

    now = datetime.utcnow()
    any_success = False

    by_code, by_name = _build_product_indexes(db)
    inventory_by_product_id = {
        item.product_id: item
        for item in db.query(InventoryItem)
        .filter(InventoryItem.account_id == account_id)
        .all()
    }
    allocate_code = _next_code_allocator(db)
    creator_account_id = active_account_id(user)

    # Remote MySQL: avoid a savepoint + flush round-trip per row.
    FLUSH_EVERY = 50
    pending_since_flush = 0

    try:
        for row in parsed_rows:
            product, matched_by = _lookup_product(
                row, by_code=by_code, by_name=by_name
            )
            product_created = product is None
            renamed = False

            if product is None:
                product = _create_product(
                    db,
                    row,
                    user,
                    now,
                    account_id=creator_account_id,
                    allocate_code=allocate_code,
                )
            else:
                renamed = _update_product_from_row(
                    product, row, now, matched_by=matched_by
                )

            existing_item = inventory_by_product_id.get(product.id)
            item, inventory_created = _upsert_inventory(
                account_id=account_id,
                product=product,
                row=row,
                now=now,
                existing=existing_item,
            )
            if inventory_created:
                db.add(item)
                inventory_by_product_id[product.id] = item

            # Keep indexes warm so later rows in this file also dedupe.
            _index_product(product, by_code=by_code, by_name=by_name)

            pending_since_flush += 1
            if pending_since_flush >= FLUSH_EVERY:
                db.flush()
                pending_since_flush = 0

            any_success = True
            if product_created:
                status: RowStatus = "created"
                message = "Added to catalog and inventory."
                result.created += 1
            elif inventory_created:
                status = "created"
                message = "Linked existing catalog product to your inventory."
                result.created += 1
            else:
                status = "updated"
                if renamed:
                    message = "Matched existing product — updated name and inventory."
                elif matched_by:
                    message = "Matched existing product — updated inventory (no duplicate)."
                else:
                    message = "Updated inventory pricing/stock."
                result.updated += 1

            result.rows.append(
                RowResult(
                    row=row.row_number,
                    name=row.name,
                    sku=row.sku,
                    status=status,
                    message=message,
                ),
            )

        if pending_since_flush:
            db.flush()
    except Exception as exc:
        db.rollback()
        any_success = False
        result.created = 0
        result.updated = 0
        result.errors = len(parsed_rows)
        result.rows = [
            RowResult(
                row=0,
                name=None,
                sku=None,
                status="error",
                message=str(exc) or "Import failed. No changes were saved.",
            ),
        ]

    for row_result in early_results:
        if row_result.status == "skipped":
            result.skipped += 1
        elif row_result.status == "error":
            result.errors += 1

    if any_success:
        db.commit()
    else:
        db.rollback()

    return result
