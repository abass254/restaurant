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
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any, Literal

from openpyxl import load_workbook
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.products import _slugify
from app.models import InventoryItem, Product, User, _new_uuid
from app.services.sell_units import (
    detect_pack,
    infer_pack_factor,
    merge_pack_into_attributes,
    unit_kind,
)
from app.support.merchant_permissions import active_account_id

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2_000
BASE_PIECE_UNIT = "Pcs"

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
        "code",
        "item code",
        "item_code",
        "item id",
        "item_id",
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
        "sellingprice",
        "single price",
        "single_price",
        "price",
    ),
    "buying_price": (
        "cost",
        "buying price",
        "buyingprice",
        "single buying price",
        "single_buying_price",
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
        "qty",
        "stock",
        "qty available",
        "available quantity",
        "inventory quantity",
        "forecasted quantity",
        "opening stock",
        "ordered quantities",
        "itemsbalance",
        "items balance",
    ),
    # One-row-per-item layout: the row is the single unit, plus one bulk pack.
    "bulk_unit": ("bulk unit", "bulk_unit"),
    "bulk_qty": ("qty per bulk", "qty_per_bulk", "quantity per bulk"),
    "bulk_buying_price": ("bulk buying price", "bulk_buying_price", "bulk cost"),
    "bulk_selling_price": ("bulk price", "bulk_price", "bulk selling price"),
    "pack_size": (
        "pcs per pack",
        "pieces per pack",
        "units per pack",
        "qty per pack",
        "pack size",
        "pcs per ctn",
        "pcs per carton",
        "units per carton",
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
    stock_quantity: Decimal | None = None
    low_stock_threshold: Decimal | None = None
    supplier: str | None = None
    location: str | None = None
    image_url: str | None = None
    notes: str | None = None
    inventory_role: str | None = None
    manage_stock: bool | None = None
    product_attributes: dict[str, Any] = field(default_factory=dict)
    inventory_attributes: dict[str, Any] = field(default_factory=dict)
    # Set when the row is in a pack unit (CTN, Dozen…) and was converted to pieces.
    pack_name: str | None = None
    pack_factor: int | None = None
    pack_quantity: Decimal | None = None
    pack_selling_price: float | None = None
    pack_buying_price: float | None = None
    pack_warning: str | None = None
    # Base unit of the sibling piece row when this pack row was merged into it.
    pack_of: str | None = None
    pack_size_given: bool = False
    # Packs declared on the same row (bulk_unit / qty_per_bulk / bulk_price).
    extra_packs: list[dict[str, Any]] = field(default_factory=list)
    # File has bulk columns, so it is authoritative for this item's packs.
    replace_packs: bool = False


@dataclass
class RowResult:
    row: int
    name: str | None
    sku: str | None
    status: RowStatus
    message: str | None = None
    warning: bool = False


@dataclass
class ImportResult:
    detected_columns: dict[str, str] = field(default_factory=dict)
    rows: list[RowResult] = field(default_factory=list)
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    matched_existing: int = 0
    converted: int = 0
    warnings: int = 0

    def summary_message(self) -> str:
        parts = []
        if self.created:
            parts.append(f"{self.created} added")
        if self.updated:
            parts.append(f"{self.updated} updated")
        if self.matched_existing:
            parts.append(f"{self.matched_existing} matched core inventory")
        if self.converted:
            parts.append(f"{self.converted} converted from packs to pieces")
        if self.warnings:
            parts.append(f"{self.warnings} need pack size")
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


def _cell_quantity(value: Any) -> Decimal | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.001"))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _format_qty(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


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


def _pack_size_warning(label: str) -> str:
    return (
        f"Couldn't detect pieces per {label} from name; add a "
        "'Pcs per pack' column or edit the item."
    )


def _row_group_key(row: ParsedRow) -> str:
    codes = sorted(_row_code_keys(row))
    if codes:
        return f"code:{codes[0]}"
    return f"name:{_normalize_name(row.name)}"


def _link_pack_rows(rows: list[ParsedRow]) -> None:
    """Merge CTN/Dozen rows into the PC row of the same product.

    Exports often list one product twice (same code), once per unit. The piece
    row owns stock and piece prices; the pack row only contributes a sell unit,
    with its size inferred from the price ratio when the name doesn't say.
    """
    groups: dict[str, list[ParsedRow]] = {}
    for row in rows:
        groups.setdefault(_row_group_key(row), []).append(row)

    for group in groups.values():
        base_rows = [r for r in group if r.pack_name is None]
        piece_row = next(
            (r for r in base_rows if unit_kind(r.unit) == "piece"),
            base_rows[0] if base_rows else None,
        )
        if piece_row is None:
            continue
        for row in group:
            if row is piece_row or row.pack_name is None:
                continue
            # An explicit "Pcs per Pack" wins; otherwise the price ratio beats
            # name parsing ("MAGGI 20*39*4GM" is 20 per carton, not 39).
            inferred = infer_pack_factor(
                row.pack_buying_price, piece_row.buying_price
            ) or infer_pack_factor(row.pack_selling_price, piece_row.selling_price)
            factor = (
                row.pack_factor
                if row.pack_size_given
                else inferred or row.pack_factor
            )
            row.pack_of = piece_row.unit
            row.pack_factor = factor
            row.pack_warning = None if factor else _pack_size_warning(row.pack_name)
            row.unit = piece_row.unit
            row.stock_quantity = None
            row.low_stock_threshold = None
            row.selling_price = None
            row.buying_price = None


def _parse_row(
    raw: tuple[Any, ...] | list[Any],
    column_map: dict[str, int],
    row_offset: int,
    early_errors: list[RowResult],
    parsed_rows: list[ParsedRow],
) -> None:
    if raw is None or all(cell is None or str(cell).strip() == "" for cell in raw):
        return

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
        return

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
    stock_qty = _cell_quantity(col("stock_quantity"))
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
    selling_price = _cell_float(col("selling_price"))
    low_stock_threshold = _cell_quantity(col("low_stock_threshold"))

    pack_name: str | None = None
    pack_factor: int | None = None
    pack_quantity: Decimal | None = None
    pack_selling_price: float | None = None
    pack_buying_price: float | None = None
    pack_warning: str | None = None
    # "Pcs per Pack" = 1, or a one-row-per-item file (bulk columns), marks the
    # row as the base unit: never convert it.
    pack = (
        detect_pack(packaging, name, col("pack_size"))
        if product_type != "service"
        and _cell_float(col("pack_size")) != 1
        and "bulk_qty" not in column_map
        else None
    )
    if pack is not None:
        label, factor = pack
        pack_name = label
        pack_quantity = stock_qty
        pack_selling_price = selling_price
        pack_buying_price = buying_price
        if factor is None:
            pack_warning = _pack_size_warning(label)
        else:
            pack_factor = factor
            packaging = BASE_PIECE_UNIT
            if stock_qty is not None:
                stock_qty = stock_qty * factor
            if low_stock_threshold is not None:
                low_stock_threshold = low_stock_threshold * factor
            selling_price = (
                round(selling_price / factor, 2) if selling_price is not None else None
            )
            buying_price = (
                round(buying_price / factor, 2) if buying_price is not None else None
            )

    extra_packs: list[dict[str, Any]] = []
    bulk_qty = _cell_float(col("bulk_qty"))
    if bulk_qty is not None and bulk_qty >= 2 and float(bulk_qty).is_integer():
        bulk: dict[str, Any] = {
            "name": _cell_str(col("bulk_unit")) or "Bulk",
            "factor": int(bulk_qty),
        }
        bulk_buy = _cell_float(col("bulk_buying_price"))
        bulk_sell = _cell_float(col("bulk_selling_price"))
        if bulk_buy is not None:
            bulk["buying_price"] = bulk_buy
        if bulk_sell is not None:
            bulk["selling_price"] = bulk_sell
        extra_packs.append(bulk)

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
            selling_price=selling_price,
            buying_price=buying_price,
            stock_quantity=stock_qty,
            low_stock_threshold=low_stock_threshold,
            supplier=_cell_str(col("supplier")),
            location=location,
            image_url=_cell_str(col("image_url")),
            notes=_cell_str(col("notes")),
            inventory_role=inventory_role,
            manage_stock=manage_stock,
            product_attributes=product_attrs,
            inventory_attributes=inventory_attrs,
            pack_name=pack_name,
            pack_factor=pack_factor,
            pack_quantity=pack_quantity,
            pack_selling_price=pack_selling_price,
            pack_buying_price=pack_buying_price,
            pack_warning=pack_warning,
            pack_size_given=(_cell_float(col("pack_size")) or 0) >= 2,
            extra_packs=extra_packs,
            replace_packs="bulk_qty" in column_map and product_type != "service",
        ),
    )


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
            "Could not find a product name column. Include a "
            "'Name' or 'Product Name' column."
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
        _parse_row(raw, column_map, row_offset, early_errors, parsed_rows)

    workbook.close()
    return detected, parsed_rows, early_errors


def _parse_csv(content: bytes) -> tuple[dict[str, str], list[ParsedRow], list[RowResult]]:
    if len(content) > MAX_IMPORT_BYTES:
        raise ValueError(
            f"File is too large (max {MAX_IMPORT_BYTES // (1024 * 1024)} MB)."
        )

    import csv
    import io

    text = ""
    for enc in ("utf-8-sig", "utf-8", "latin1", "cp1252"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if not text:
        raise ValueError("Could not read the CSV file encoding.")

    sample = text[:4096]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        delimiter = dialect.delimiter
    except Exception:
        if "\t" in sample and sample.count("\t") > sample.count(","):
            delimiter = "\t"
        elif ";" in sample and sample.count(";") > sample.count(","):
            delimiter = ";"

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header_row = next(reader)
    except StopIteration:
        raise ValueError("The CSV file is empty.")

    headers = [str(h).strip() if h is not None else "" for h in header_row]
    column_map = _build_column_map(headers)
    detected = {
        field: headers[idx]
        for field, idx in column_map.items()
        if idx < len(headers) and headers[idx]
    }

    if "name" not in column_map:
        raise ValueError(
            "Could not find a product name column. Include a "
            "'Name' or 'Product Name' column in your CSV."
        )

    parsed_rows: list[ParsedRow] = []
    early_errors: list[RowResult] = []

    for row_offset, raw in enumerate(reader, start=2):
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
        _parse_row(raw, column_map, row_offset, early_errors, parsed_rows)

    return detected, parsed_rows, early_errors


def parse_import_file(
    content: bytes, filename: str = "import.xlsx"
) -> tuple[dict[str, str], list[ParsedRow], list[RowResult]]:
    detected, rows, early = _parse_file(content, filename)
    _link_pack_rows(rows)
    return detected, rows, early


def _parse_file(
    content: bytes, filename: str
) -> tuple[dict[str, str], list[ParsedRow], list[RowResult]]:
    lower = (filename or "").lower()
    if lower.endswith(".csv"):
        return _parse_csv(content)
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        return _parse_workbook(content)

    # Check magic header for zip / xlsx
    if content.startswith(b"PK\x03\x04"):
        return _parse_workbook(content)

    # Fallback to CSV
    try:
        return _parse_csv(content)
    except Exception:
        raise ValueError("Upload a valid Excel (.xlsx) or CSV (.csv) file.")


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
    if row.unit and (not product.unit or (allow_overwrite and not row.pack_factor)):
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
    stock_mode: str = "replace",
) -> tuple[InventoryItem, bool]:
    """Return (item, created).

    stock_mode:
        - "replace": overwrite current stock with imported quantity
        - "add": add imported quantity to current stock
        - "keep": keep existing stock, only set if current stock is unset
    """
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

    # Pack rows derive piece prices; keep a piece price the shop already set.
    if row.selling_price is not None and (
        not row.pack_factor or item.selling_price is None
    ):
        item.selling_price = row.selling_price
    if row.buying_price is not None and (
        not row.pack_factor or item.buying_price is None
    ):
        item.buying_price = row.buying_price
    if row.pack_name and row.pack_factor:
        pack: dict[str, Any] = {"name": row.pack_name, "factor": row.pack_factor}
        if row.pack_selling_price is not None:
            pack["selling_price"] = row.pack_selling_price
        if row.pack_buying_price is not None:
            pack["buying_price"] = row.pack_buying_price
        item.attributes = merge_pack_into_attributes(item.attributes, pack) or None
    if row.replace_packs:
        attrs = dict(item.attributes or {})
        attrs.pop("sell_units", None)
        item.attributes = attrs or None
    for extra in row.extra_packs:
        item.attributes = merge_pack_into_attributes(item.attributes, extra) or None
    if product.is_service():
        item.stock_quantity = None
        item.low_stock_threshold = None
    else:
        if row.manage_stock is False:
            item.stock_quantity = None
        elif row.stock_quantity is not None:
            if created or stock_mode == "replace":
                item.stock_quantity = row.stock_quantity
            elif stock_mode == "add":
                current_qty = item.stock_quantity or Decimal("0")
                item.stock_quantity = current_qty + row.stock_quantity
            elif stock_mode == "keep":
                if item.stock_quantity is None:
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
    filename: str = "inventory.xlsx",
    stock_mode: str = "replace",
) -> ImportResult:
    """Import inventory from Excel or CSV file.

    Handles matching with core inventory by SKU, Barcode, Product Code, or Name,
    updating existing items without duplication according to stock_mode.
    """
    detected, parsed_rows, early_results = parse_import_file(content, filename=filename)
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
            if row.pack_of and not row.pack_factor:
                result.warnings += 1
                result.skipped += 1
                result.rows.append(
                    RowResult(
                        row=row.row_number,
                        name=row.name,
                        sku=row.sku,
                        status="skipped",
                        message=(
                            f"Same product as the {row.pack_of} row, but pieces per "
                            f"{row.pack_name} couldn't be worked out from the name or "
                            "prices. Add a 'Pcs per pack' column to add this pack."
                        ),
                        warning=True,
                    ),
                )
                continue

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
                stock_mode=stock_mode,
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
                message = "New product added to catalog and inventory."
                result.created += 1
            elif inventory_created:
                status = "created"
                message = f"Matched existing catalog product ({matched_by or 'core'}) — linked to your inventory."
                result.created += 1
                result.matched_existing += 1
            else:
                status = "updated"
                result.matched_existing += 1
                stock_note = ""
                if row.stock_quantity is not None:
                    if stock_mode == "add":
                        stock_note = " (+stock added)"
                    elif stock_mode == "replace":
                        stock_note = " (stock replaced)"
                    elif stock_mode == "keep":
                        stock_note = " (stock kept)"

                if renamed:
                    message = f"Matched core inventory item ({matched_by or 'code'}) — updated name & stock{stock_note}."
                elif matched_by:
                    message = f"Matched core inventory item by {matched_by} — updated pricing & stock{stock_note}."
                else:
                    message = f"Updated existing inventory item{stock_note}."
                result.updated += 1

            if row.pack_of and row.pack_factor:
                message = (
                    f"{message} Added {row.pack_name} x{row.pack_factor} as a pack of "
                    f"{row.pack_of}; stock is taken from the {row.pack_of} row."
                )
            elif row.pack_name and row.pack_factor:
                result.converted += 1
                base_unit = (product.unit or BASE_PIECE_UNIT).strip() or BASE_PIECE_UNIT
                conversion = f"Converted {row.pack_name} x{row.pack_factor}"
                if row.pack_quantity is not None and row.stock_quantity is not None:
                    conversion += (
                        f": {_format_qty(row.pack_quantity)} {row.pack_name} → "
                        f"{_format_qty(row.stock_quantity)} {base_unit}"
                    )
                message = f"{message} {conversion}."
            if row.pack_warning:
                result.warnings += 1
                message = f"{message} {row.pack_warning}"

            result.rows.append(
                RowResult(
                    row=row.row_number,
                    name=row.name,
                    sku=row.sku,
                    status=status,
                    message=message,
                    warning=bool(row.pack_warning),
                ),
            )

        if pending_since_flush:
            db.flush()
    except Exception as exc:
        db.rollback()
        any_success = False
        result.created = 0
        result.updated = 0
        result.converted = 0
        result.warnings = 0
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


_TEMPLATE_HEADERS = (
    "Name",
    "SKU",
    "Barcode",
    "Category",
    "Unit",
    "Pcs per Pack",
    "Buying Price",
    "Selling Price",
    "Quantity",
    "Low Stock Threshold",
    "Product Type",
    "Description",
    "Supplier",
)

_TEMPLATE_ROWS: tuple[tuple[Any, ...], ...] = (
    (
        "Fresh Milk 500ml",
        "MLK-001",
        "6161101234567",
        "Dairy",
        "Pcs",
        None,
        55.00,
        65.00,
        40,
        10,
        "product",
        "Pasteurized fresh whole milk 500ml pouch",
        "Brookside Dairy",
    ),
    (
        "White Sugar 1kg",
        "SGR-001",
        "6161102345678",
        "Groceries",
        "Kg",
        None,
        130.00,
        155.00,
        50,
        15,
        "product",
        "Premium white refined sugar 1kg bag",
        "Mumias Sugar",
    ),
    (
        "Coca Cola 500ml 24s",
        "COK-024",
        "5449000000996",
        "Beverages",
        "CTN",
        24,
        1100.00,
        1320.00,
        5,
        1,
        "product",
        "Carton of 24 x 500ml bottles - stock is saved as 120 Pcs",
        "Coca-Cola Beverages Africa",
    ),
    (
        "Bic Pens Blue",
        "BIC-012",
        "3086123456789",
        "Stationery",
        "Dozen",
        None,
        180.00,
        240.00,
        10,
        2,
        "product",
        "Sold per dozen or per piece - stock is saved as 120 Pcs",
        "Bic Kenya",
    ),
)


def _generate_excel_template() -> tuple[bytes, str, str]:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Inventory Template"

    headers = list(_TEMPLATE_HEADERS)
    sample_rows = [list(row) for row in _TEMPLATE_ROWS]

    ws.append(headers)

    header_font = Font(name="Calibri", size=11, bold=True, color="1E293B")
    header_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    ws.row_dimensions[1].height = 28
    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    data_font = Font(name="Calibri", size=10, color="0F172A")
    for r_idx, row_data in enumerate(sample_rows, start=2):
        ws.row_dimensions[r_idx].height = 20
        ws.append(row_data)
        for c_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.font = data_font
            cell.border = thin_border
            if c_idx in (7, 8):  # Buying & Selling Price
                cell.number_format = "#,##0.00"
                cell.alignment = Alignment(horizontal="right")
            elif c_idx in (6, 9, 10):  # Pcs per Pack, Quantity & Threshold
                cell.number_format = "#,##0"
                cell.alignment = Alignment(horizontal="right")

    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    # Instructions sheet
    guide_ws = wb.create_sheet(title="Instructions & Guide")
    guide_ws.column_dimensions["A"].width = 24
    guide_ws.column_dimensions["B"].width = 75

    guide_headers = ["Field / Topic", "Description & Usage Instructions"]
    guide_ws.append(guide_headers)
    guide_cell_1 = guide_ws.cell(row=1, column=1)
    guide_cell_2 = guide_ws.cell(row=1, column=2)
    for c in (guide_cell_1, guide_cell_2):
        c.font = header_font
        c.fill = header_fill
        c.alignment = header_alignment
        c.border = thin_border

    guide_rows = [
        ("Name (Required)", "The product name. Every row must have a name (e.g. 'Fresh Milk 500ml')."),
        ("SKU (Recommended)", "Unique internal code or SKU. Used to identify existing items and prevent duplicates."),
        ("Barcode (Recommended)", "EAN-13, UPC, or numeric barcode. Scannable at checkout/POS."),
        ("Prices & Numbers", "Enter numbers without currency symbols (e.g. 65.00, not 'KSh 65')."),
        ("Unit: CTN / Dozen / PCS", "Rows can be in pieces (Pcs) or packs (CTN, Box, Crate, Tray, Pkt, Dozen). Pack rows are converted to pieces: Quantity and Low Stock Threshold are multiplied by the pieces per pack, prices are treated as the price per pack, and the pack is added as a sell unit so you can still sell by the carton or by the piece."),
        ("Pcs per Pack", "Pieces in one pack (e.g. 24 for a carton of 24). Enter 1 for the base unit row (no conversion). Optional: if blank, TransChap reads it from the name ('Coke 500ml 24s', '24x500ml', 'Eggs Tray of 30', 'Biscuits (12)'). Dozen is always 12. Rows where it can't be found are imported unconverted and flagged in the import log."),
        ("Same product in several units", "List the product once per unit with the same SKU: the base unit row (Pcs per Pack = 1) carries the Quantity; pack rows (CTN, Outer, Bale…) carry their Pcs per Pack and prices with Quantity left blank."),
        ("Existing Core Inventory", "If an item already exists in core inventory (matched by SKU, Barcode, or Name), TransChap updates the existing item without creating duplicates."),
        ("Stock Modes", "During import, you can choose to Replace stock, Add to existing stock, or Keep current stock."),
        ("File Support", "Supports both Excel (.xlsx) and CSV (.csv) formats."),
    ]

    for g_idx, (topic, desc) in enumerate(guide_rows, start=2):
        guide_ws.append([topic, desc])
        c1 = guide_ws.cell(row=g_idx, column=1)
        c2 = guide_ws.cell(row=g_idx, column=2)
        c1.font = Font(name="Calibri", size=10, bold=True, color="1E293B")
        c2.font = data_font
        c1.border = thin_border
        c2.border = thin_border
        c2.alignment = Alignment(wrap_text=True)

    buf = BytesIO()
    wb.save(buf)
    return (
        buf.getvalue(),
        "TransChap_inventory_template.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _generate_csv_template() -> tuple[bytes, str, str]:
    import csv
    import io

    headers = list(_TEMPLATE_HEADERS)
    sample_rows = [
        [
            "" if value is None else f"{value:.2f}" if isinstance(value, float) else str(value)
            for value in row
        ]
        for row in _TEMPLATE_ROWS
    ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(sample_rows)

    data = output.getvalue().encode("utf-8-sig")
    return (data, "TransChap_inventory_template.csv", "text/csv; charset=utf-8")


def generate_inventory_template(format: str = "xlsx") -> tuple[bytes, str, str]:
    """Generate sample inventory import template in XLSX or CSV format."""
    if (format or "").strip().lower() == "csv":
        return _generate_csv_template()
    return _generate_excel_template()
