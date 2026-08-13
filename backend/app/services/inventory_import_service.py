"""Bulk inventory import from Odoo-style Excel exports.

Accepts flexible column headers (Odoo export labels vary by version and
language). Each row creates or matches a shared catalog ``Product`` and
creates/updates the shop's ``InventoryItem``.
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

from app.api.v1.products import _next_product_code, _slugify
from app.models import InventoryItem, Product, User
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
    ),
    "barcode": ("barcode", "ean", "upc", "ean13"),
    "category": (
        "product category",
        "category",
        "categ_id",
        "product category/name",
        "category/name",
    ),
    "brand": ("brand",),
    "unit": (
        "unit of measure",
        "uom",
        "unit",
        "uom name",
        "unit of measure/name",
    ),
    "description": (
        "description",
        "sales description",
        "description sale",
        "internal notes",
        "note",
    ),
    "product_type": ("product type", "type", "detailed type"),
    "selling_price": (
        "sales price",
        "list price",
        "sale price",
        "public price",
        "customer price",
        "lst price",
    ),
    "buying_price": (
        "cost",
        "standard price",
        "cost price",
        "purchase price",
    ),
    "stock_quantity": (
        "quantity on hand",
        "qty on hand",
        "on hand",
        "quantity",
        "qty available",
        "available quantity",
        "inventory quantity",
        "forecasted quantity",
    ),
    "low_stock_threshold": (
        "low stock threshold",
        "reorder level",
        "minimum quantity",
        "min quantity",
    ),
    "notes": ("notes", "inventory notes"),
}

# Odoo export columns we ignore but recognise.
IGNORED_HEADERS = frozenset(
    {
        "id",
        "external id",
        "database id",
        "favorite",
        "active",
        "can be sold",
        "can be purchased",
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
    },
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
    notes: str | None = None


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
        return None
    text = str(value).strip()
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
    return int(parsed)


def _map_product_type(raw: str | None) -> str:
    if not raw:
        return "product"
    key = raw.strip().lower()
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
        for idx, header in enumerate(normalized):
            if not header or header in IGNORED_HEADERS:
                continue
            if header == field_name or header in aliases:
                mapping[field_name] = idx
                break
            # Partial match for Odoo paths like "product category / name".
            for alias in aliases:
                if header.endswith(f" / {alias}") or header.endswith(alias):
                    mapping[field_name] = idx
                    break
            if field_name in mapping:
                break

    return mapping


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
            "Could not find a product name column. Export from Odoo with a "
            "'Name' column, or include a column titled Name / Product Name."
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

        product_type = _map_product_type(_cell_str(col("product_type")))
        stock_qty = _cell_int(col("stock_quantity"))
        if product_type == "service":
            stock_qty = None

        parsed_rows.append(
            ParsedRow(
                row_number=row_offset,
                name=name,
                sku=_cell_str(col("sku")),
                barcode=_cell_str(col("barcode")),
                category=_cell_str(col("category")),
                brand=_cell_str(col("brand")),
                unit=_cell_str(col("unit")),
                description=_cell_str(col("description")),
                product_type=product_type,
                selling_price=_cell_float(col("selling_price")),
                buying_price=_cell_float(col("buying_price")),
                stock_quantity=stock_qty,
                low_stock_threshold=_cell_int(col("low_stock_threshold")),
                notes=_cell_str(col("notes")),
            ),
        )

    workbook.close()
    return detected, parsed_rows, early_errors


def _find_product(db: Session, row: ParsedRow) -> Product | None:
    if row.sku:
        match = (
            db.query(Product)
            .filter(func.lower(Product.sku) == row.sku.lower())
            .first()
        )
        if match:
            return match

    if row.name:
        return (
            db.query(Product)
            .filter(func.lower(Product.name) == row.name.lower())
            .first()
        )
    return None


def _create_product(db: Session, row: ParsedRow, user: User, now: datetime) -> Product:
    attributes: dict[str, Any] | None = None
    if row.barcode:
        attributes = {"barcode": row.barcode, "import_source": "odoo_excel"}

    product = Product(
        name=row.name or "Unnamed",
        slug=_slugify(row.name or "item"),
        product_type=row.product_type,
        category=row.category,
        brand=row.brand,
        unit=row.unit,
        description=row.description,
        product_code=_next_product_code(db),
        sku=row.sku,
        attributes=attributes,
        created_by_account_id=active_account_id(user),
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(product)
    db.flush()
    return product


def _upsert_inventory(
    db: Session,
    *,
    account_id: str,
    product: Product,
    row: ParsedRow,
    now: datetime,
) -> tuple[InventoryItem, bool]:
    """Return (item, created)."""
    item = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.product_id == product.id,
        )
        .first()
    )
    created = item is None
    if item is None:
        item = InventoryItem(
            account_id=account_id,
            product_id=product.id,
            is_active=True,
            created_at=now,
        )
        db.add(item)

    if row.selling_price is not None:
        item.selling_price = row.selling_price
    if row.buying_price is not None:
        item.buying_price = row.buying_price
    if product.is_service():
        item.stock_quantity = None
        item.low_stock_threshold = None
    else:
        if row.stock_quantity is not None:
            item.stock_quantity = row.stock_quantity
        if row.low_stock_threshold is not None:
            item.low_stock_threshold = row.low_stock_threshold
    if row.notes is not None:
        item.notes = row.notes

    item.updated_at = now
    db.flush()
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

    for row in parsed_rows:
        try:
            with db.begin_nested():
                product = _find_product(db, row)
                product_created = product is None

                if product is None:
                    product = _create_product(db, row, user, now)
                elif row.barcode:
                    attrs = dict(product.attributes or {})
                    if "barcode" not in attrs:
                        attrs["barcode"] = row.barcode
                        attrs.setdefault("import_source", "odoo_excel")
                        product.attributes = attrs
                        product.updated_at = now

                _item, inventory_created = _upsert_inventory(
                    db,
                    account_id=account_id,
                    product=product,
                    row=row,
                    now=now,
                )

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
        except Exception as exc:
            result.errors += 1
            result.rows.append(
                RowResult(
                    row=row.row_number,
                    name=row.name,
                    sku=row.sku,
                    status="error",
                    message=str(exc) or "Import failed for this row.",
                ),
            )

    # Count skipped from early_results
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
