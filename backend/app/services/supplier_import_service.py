"""Bulk shop-supplier import from Excel and CSV with extended columns."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from typing import Any, Literal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from app.models import PurchaseOrder, ShopSupplier, StockMovement
from app.services.contact_import_utils import (
    ImportMode,
    clean_money_text,
    contact_key,
    is_repeated_header,
    is_total_row,
    join_notes,
    load_import_workbook,
    phone_problem,
)
from app.services.rider_service import normalize_phone
from app.services.supplier_service import SupplierService, SupplierServiceError

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2_000

RowStatus = Literal["created", "updated", "merged", "skipped", "error", "removed", "kept"]

REQUIRED_COLUMNS_ERROR = (
    "Could not find required columns: Name (or Business Name), Phone. "
    "Include Name, Phone, and optionally Balance, Address, Postal Code, City, Email, Fax, PIN Number, Notes."
)

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "business_name": (
        "business name",
        "business",
        "trading name",
    ),
    "name": (
        "name",
        "supplier name",
        "supplier",
        "vendor name",
        "vendor",
        "company",
        "company name",
        "full name",
    ),
    "phone": (
        "phone",
        "phone number",
        "mobile",
        "mobile number",
        "tel",
        "telephone",
        "contact",
        "contact number",
        "msisdn",
    ),
    "balance": (
        "balance",
        "current balance",
        "opening balance",
        "amount owed",
        "owes",
        "opening",
    ),
    "address": (
        "address",
        "physical address",
        "street",
        "street address",
        "location",
    ),
    "postal_code": (
        "postalcode",
        "postal code",
        "postal_code",
        "postcode",
        "zip",
        "zip code",
        "p.o. box",
        "p.o box",
        "po box",
    ),
    "city": (
        "city",
        "town",
        "county",
    ),
    "email": (
        "email",
        "e-mail",
        "email address",
    ),
    "fax": (
        "fax",
        "fax number",
    ),
    "pin_number": (
        "pin_number",
        "pin number",
        "pin",
        "kra pin",
        "tax pin",
        "vat number",
        "tax id",
    ),
    "notes": (
        "notes",
        "note",
        "remarks",
        "comment",
        "description",
    ),
}


@dataclass
class ParsedRow:
    row_number: int
    name: str | None = None
    phone: str | None = None
    balance: Decimal | float | None = None
    address: str | None = None
    postal_code: str | None = None
    city: str | None = None
    email: str | None = None
    fax: str | None = None
    pin_number: str | None = None
    notes: str | None = None


@dataclass
class RowResult:
    row: int
    name: str | None
    phone: str | None
    status: RowStatus
    message: str | None = None


@dataclass
class ImportResult:
    detected_columns: dict[str, str] = field(default_factory=dict)
    rows: list[RowResult] = field(default_factory=list)
    created: int = 0
    updated: int = 0
    merged: int = 0
    skipped: int = 0
    errors: int = 0
    removed: int = 0
    kept: int = 0

    def summary_message(self) -> str:
        parts = []
        if self.created:
            parts.append(f"{self.created} added")
        if self.updated:
            parts.append(f"{self.updated} updated")
        if self.merged:
            parts.append(f"{self.merged} duplicates merged")
        if self.skipped:
            parts.append(f"{self.skipped} skipped")
        if self.errors:
            parts.append(f"{self.errors} failed")
        if self.removed:
            parts.append(f"{self.removed} old suppliers removed")
        if self.kept:
            parts.append(f"{self.kept} old suppliers kept")
        return ", ".join(parts) or "No rows processed"


def _normalize_header(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    return re.sub(r"\s+", " ", text)


def _cell_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text or None


def _cell_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    text = clean_money_text(str(value))
    if not text:
        return None
    try:
        return Decimal(text)
    except Exception:
        return None


def _build_column_map(headers: list[str]) -> dict[str, int]:
    normalized = [_normalize_header(h) for h in headers]
    mapping: dict[str, int] = {}
    used_indexes: set[int] = set()
    for field_name, aliases in COLUMN_ALIASES.items():
        for idx, header in enumerate(normalized):
            if not header or idx in used_indexes:
                continue
            if header in aliases:
                mapping[field_name] = idx
                used_indexes.add(idx)
                break
        if field_name in mapping:
            continue
        for idx, header in enumerate(normalized):
            if not header or idx in used_indexes:
                continue
            for alias in aliases:
                if header.startswith(f"{alias} (") or header.startswith(f"{alias}("):
                    mapping[field_name] = idx
                    used_indexes.add(idx)
                    break
            if field_name in mapping:
                break
    return mapping


def _has_required_columns(mapping: dict[str, int]) -> bool:
    return "phone" in mapping and ("name" in mapping or "business_name" in mapping)


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

    if is_total_row(raw) or is_repeated_header(raw, column_map, COLUMN_ALIASES):
        return

    name = _cell_str(col("business_name")) or _cell_str(col("name"))
    phone = _cell_str(col("phone"))

    if not name and not phone:
        return

    def reject(status: RowStatus, message: str) -> None:
        early_errors.append(
            RowResult(row=row_offset, name=name, phone=phone, status=status, message=message),
        )

    if not name:
        reject("skipped", "No supplier name.")
        return
    notes = _cell_str(col("notes"))
    if phone and phone_problem(phone, normalize_phone(phone)):
        notes = join_notes(notes, f"Original phone '{phone}' is not usable - check and update")
        phone = None

    balance_raw = col("balance")
    balance = _cell_decimal(balance_raw)
    if balance is None and balance_raw is not None and str(balance_raw).strip():
        notes = join_notes(notes, f"Original balance '{balance_raw}' is not a valid amount - check and update")

    parsed_rows.append(
        ParsedRow(
            row_number=row_offset,
            name=name,
            phone=phone,
            balance=balance,
            address=_cell_str(col("address")),
            postal_code=_cell_str(col("postal_code")),
            city=_cell_str(col("city")),
            email=_cell_str(col("email")),
            fax=_cell_str(col("fax")),
            pin_number=_cell_str(col("pin_number")),
            notes=notes,
        ),
    )


def _parse_workbook(content: bytes) -> tuple[dict[str, str], list[ParsedRow], list[RowResult]]:
    if len(content) > MAX_IMPORT_BYTES:
        raise ValueError(
            f"File is too large (max {MAX_IMPORT_BYTES // (1024 * 1024)} MB)."
        )

    workbook = load_import_workbook(content)

    sheet = workbook.active
    if sheet is None:
        raise ValueError("The Excel file has no worksheets.")

    all_rows = list(sheet.iter_rows(values_only=True))
    if not all_rows:
        workbook.close()
        raise ValueError("The Excel file is empty.")

    header_row_index = None
    column_map: dict[str, int] = {}
    headers: list[str] = []
    # POS exports often put a title on row 1; look for Name + Phone in the first few rows.
    for idx, raw in enumerate(all_rows[:5]):
        candidate = [str(h).strip() if h is not None else "" for h in (raw or ())]
        mapping = _build_column_map(candidate)
        if _has_required_columns(mapping):
            header_row_index = idx
            column_map = mapping
            headers = candidate
            break

    if header_row_index is None:
        workbook.close()
        raise ValueError(REQUIRED_COLUMNS_ERROR)

    detected = {
        field: headers[idx]
        for field, idx in column_map.items()
        if idx < len(headers) and headers[idx]
    }

    parsed_rows: list[ParsedRow] = []
    early_errors: list[RowResult] = []

    for row_offset, raw in enumerate(
        all_rows[header_row_index + 1 :],
        start=header_row_index + 2,
    ):
        if len(parsed_rows) + len(early_errors) >= MAX_IMPORT_ROWS:
            early_errors.append(
                RowResult(
                    row=row_offset,
                    name=None,
                    phone=None,
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

    text_content = None
    for enc in ("utf-8-sig", "utf-8", "latin1", "cp1252"):
        try:
            text_content = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if text_content is None:
        raise ValueError("Could not decode the CSV file. Please encode as UTF-8.")

    sample = text_content[:4096]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except Exception:
        first_line = sample.splitlines()[0] if sample.splitlines() else ""
        if ";" in first_line and "," not in first_line:
            delimiter = ";"
        elif "\t" in first_line and "," not in first_line:
            delimiter = "\t"

    reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
    all_rows = [row for row in reader if row and any(cell.strip() for cell in row)]
    if not all_rows:
        raise ValueError("The CSV file is empty.")

    header_row_index = None
    column_map: dict[str, int] = {}
    headers: list[str] = []
    for idx, raw in enumerate(all_rows[:5]):
        candidate = [str(h).strip() for h in raw]
        mapping = _build_column_map(candidate)
        if _has_required_columns(mapping):
            header_row_index = idx
            column_map = mapping
            headers = candidate
            break

    if header_row_index is None:
        raise ValueError(REQUIRED_COLUMNS_ERROR)

    detected = {
        field: headers[idx]
        for field, idx in column_map.items()
        if idx < len(headers) and headers[idx]
    }

    parsed_rows: list[ParsedRow] = []
    early_errors: list[RowResult] = []

    for row_offset, raw in enumerate(
        all_rows[header_row_index + 1 :],
        start=header_row_index + 2,
    ):
        if len(parsed_rows) + len(early_errors) >= MAX_IMPORT_ROWS:
            early_errors.append(
                RowResult(
                    row=row_offset,
                    name=None,
                    phone=None,
                    status="error",
                    message=f"Import limited to {MAX_IMPORT_ROWS} rows per file.",
                ),
            )
            break

        _parse_row(raw, column_map, row_offset, early_errors, parsed_rows)

    return detected, parsed_rows, early_errors


def parse_suppliers_file(
    content: bytes, filename: str = "suppliers.xlsx"
) -> tuple[dict[str, str], list[ParsedRow], list[RowResult]]:
    lower = (filename or "").lower()
    if lower.endswith(".csv"):
        return _parse_csv(content)
    if lower.endswith(".xlsx") or lower.endswith(".xls") or content.startswith(b"PK\x03\x04"):
        return _parse_workbook(content)
    try:
        return _parse_csv(content)
    except Exception:
        raise ValueError("Upload a valid Excel (.xlsx) or CSV (.csv) file.")


def _merge_duplicate_phones(rows: list[ParsedRow]) -> tuple[list[ParsedRow], list[RowResult]]:
    """Fold rows sharing a phone (or, without one, a name) into the first, adding up balances."""
    first_by_phone: dict[str, ParsedRow] = {}
    unique: list[ParsedRow] = []
    merged: list[RowResult] = []
    for row in rows:
        key = contact_key(row.phone, row.name)
        first = first_by_phone.get(key)
        if first is None:
            first_by_phone[key] = row
            unique.append(row)
            continue
        if row.balance is not None:
            first.balance = Decimal(str(first.balance or 0)) + Decimal(str(row.balance))
        for attr in ("address", "postal_code", "city", "email", "fax", "pin_number"):
            if not getattr(first, attr) and getattr(row, attr):
                setattr(first, attr, getattr(row, attr))
        if row.notes and row.notes != first.notes:
            first.notes = f"{first.notes}; {row.notes}" if first.notes else row.notes
        if row.name and row.name.strip().lower() != (first.name or "").strip().lower():
            also = f"Also listed as: {row.name}"
            first.notes = f"{first.notes}; {also}" if first.notes else also
        merged.append(
            RowResult(
                row=row.row_number,
                name=row.name,
                phone=row.phone,
                status="merged",
                message=(
                    f"Same {'phone' if row.phone else 'name, no phone,'} as row "
                    f"{first.row_number} ({first.name}) — combined into one supplier."
                ),
            ),
        )
    return unique, merged


def _remove_suppliers_not_in_file(
    db: Session,
    account_id: str,
    file_phones: set[str],
    imported_ids: set[str],
    result: ImportResult,
) -> None:
    stale = [
        supplier
        for supplier in db.query(ShopSupplier).filter(ShopSupplier.account_id == account_id)
        if supplier.id not in imported_ids and supplier.phone not in file_phones
    ]
    if not stale:
        return
    stale_ids = [s.id for s in stale]
    with_history = {
        supplier_id
        for model in (PurchaseOrder, StockMovement)
        for (supplier_id,) in db.query(model.supplier_id)
        .filter(model.supplier_id.in_(stale_ids))
        .distinct()
    }
    for supplier in stale:
        balance = Decimal(str(supplier.balance or 0))
        reason = None
        if balance != 0:
            reason = f"Not in file but has a balance of KSh {balance:,.2f} — kept."
        elif supplier.id in with_history:
            reason = "Not in file but has purchase or stock history — kept."
        if reason:
            result.kept += 1
            result.rows.append(
                RowResult(row=0, name=supplier.name, phone=supplier.phone, status="kept", message=reason),
            )
            continue
        db.delete(supplier)
        result.removed += 1
        result.rows.append(
            RowResult(
                row=0,
                name=supplier.name,
                phone=supplier.phone,
                status="removed",
                message="Not in file — removed.",
            ),
        )


def import_suppliers_from_excel(
    db: Session,
    *,
    content: bytes,
    account_id: str,
    filename: str = "suppliers.xlsx",
    mode: ImportMode = "merge",
) -> ImportResult:
    """Import suppliers.

    ``merge`` adds new suppliers and updates matching ones, leaving the rest
    alone. ``replace`` makes the file the supplier list: matched suppliers are
    fully overwritten and suppliers missing from the file are removed (unless
    they carry a balance or purchase/stock history).
    """
    detected, parsed_rows, early_results = parse_suppliers_file(content, filename=filename)
    result = ImportResult(detected_columns=detected)
    result.rows.extend(early_results)

    for early in early_results:
        if early.status == "skipped":
            result.skipped += 1
        elif early.status == "error":
            result.errors += 1

    file_phones = {
        normalize_phone(phone)
        for phone in [r.phone for r in parsed_rows] + [r.phone for r in early_results]
        if phone and normalize_phone(phone)
    }
    parsed_rows, merged_results = _merge_duplicate_phones(parsed_rows)
    result.rows.extend(merged_results)
    result.merged = len(merged_results)

    overwrite = mode == "replace"
    service = SupplierService(db)
    imported_ids: set[str] = set()

    try:
        for row in parsed_rows:
            try:
                supplier, status = service.upsert_import_supplier(
                    account_id,
                    name=row.name or "",
                    phone=row.phone,
                    notes=row.notes,
                    balance=row.balance,
                    address=row.address,
                    postal_code=row.postal_code,
                    city=row.city,
                    email=row.email,
                    fax=row.fax,
                    pin_number=row.pin_number,
                    overwrite=overwrite,
                    commit=False,
                )
                db.flush()
            except SupplierServiceError as exc:
                result.errors += 1
                result.rows.append(
                    RowResult(
                        row=row.row_number,
                        name=row.name,
                        phone=row.phone,
                        status="error",
                        message=str(exc),
                    ),
                )
                continue

            imported_ids.add(supplier.id)
            if status == "created":
                result.created += 1
                message = "Supplier added."
            else:
                result.updated += 1
                message = "Matched existing supplier — updated details."

            result.rows.append(
                RowResult(
                    row=row.row_number,
                    name=supplier.name,
                    phone=supplier.phone,
                    status=status,  # type: ignore[arg-type]
                    message=message,
                ),
            )

        if mode == "replace":
            if result.created + result.updated == 0:
                result.rows.append(
                    RowResult(
                        row=0,
                        name=None,
                        phone=None,
                        status="skipped",
                        message="No rows could be imported, so your existing suppliers were left untouched.",
                    ),
                )
            else:
                _remove_suppliers_not_in_file(db, account_id, file_phones, imported_ids, result)

        db.commit()
    except Exception as exc:
        db.rollback()
        result.created = 0
        result.updated = 0
        result.removed = 0
        result.kept = 0
        result.errors = len(parsed_rows) + result.errors
        result.rows = [
            RowResult(
                row=0,
                name=None,
                phone=None,
                status="error",
                message=str(exc) or "Import failed. No changes were saved.",
            ),
        ]

    return result


def _generate_excel_template() -> tuple[bytes, str, str]:
    wb = Workbook()
    ws = wb.active
    ws.title = "Suppliers"

    headers = [
        "Supplier Name",
        "Phone",
        "Balance",
        "Address",
        "Postal Code",
        "City",
        "Email",
        "Fax",
        "PIN Number",
        "Notes",
    ]

    sample_rows = [
        [
            "Brookside Dairy Ltd",
            "0711002233",
            0.00,
            "Industrial Area, Road A",
            "P.O. Box 45000",
            "Nairobi",
            "orders@brookside.co.ke",
            "020556677",
            "P051234567A",
            "Daily milk deliveries",
        ],
        [
            "Mumias Sugar Distributors",
            "0722334455",
            15000.00,
            "Mombasa Road, Godown 4",
            "P.O. Box 12345",
            "Nairobi",
            "sales@mumiasdist.co.ke",
            "",
            "P059876543B",
            "Sugar wholesaler",
        ],
        [
            "Farmers Fresh Produce",
            "0733445566",
            0.00,
            "Wakulima Market, Stall 12",
            "",
            "Nairobi",
            "info@farmersfresh.co.ke",
            "",
            "",
            "Vegetables and greens supplier",
        ],
    ]

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
            if c_idx == 3:  # Balance
                cell.number_format = "#,##0.00"
                cell.alignment = Alignment(horizontal="right")

    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    # Instructions sheet
    guide_ws = wb.create_sheet(title="Instructions & Guide")
    instructions = [
        ["Suppliers Import Guide", ""],
        ["", ""],
        ["Field", "Required?", "Description & Format"],
        ["Supplier Name", "Yes", "Company name or vendor contact name."],
        ["Phone", "Recommended", "Kenyan phone number (e.g. 0712345678, +254712345678). Used for matching. Leave blank if unknown."],
        ["Balance", "No", "Current balance owed to supplier (defaults to 0.00)."],
        ["Address", "No", "Physical street address or business premises."],
        ["Postal Code", "No", "P.O. Box or postal code."],
        ["City", "No", "Town or city (e.g. Nairobi, Mombasa)."],
        ["Email", "No", "Valid contact email address."],
        ["Fax", "No", "Fax number if applicable."],
        ["PIN Number", "No", "KRA PIN / Tax identification number (e.g. P051234567A)."],
        ["Notes", "No", "Payment terms, bank details, or delivery schedules."],
        ["", ""],
        ["Deduplication Note:", "", "Suppliers with existing phone numbers or PIN numbers in your account are automatically updated without creating duplicate entries. Rows sharing a phone number are merged into one supplier. Rows without a phone are matched by PIN, then by name."],
        ["Replace Mode:", "", "Choose 'Replace list' when importing to make this file your full supplier list. Suppliers not in the file are removed unless they have a balance or purchase history."],
    ]
    for row in instructions:
        guide_ws.append(row)

    guide_ws.column_dimensions["A"].width = 24
    guide_ws.column_dimensions["B"].width = 14
    guide_ws.column_dimensions["C"].width = 65

    buffer = BytesIO()
    wb.save(buffer)
    data = buffer.getvalue()
    wb.close()
    return (
        data,
        "TransChap_suppliers_template.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _generate_csv_template() -> tuple[bytes, str, str]:
    headers = [
        "Supplier Name",
        "Phone",
        "Balance",
        "Address",
        "Postal Code",
        "City",
        "Email",
        "Fax",
        "PIN Number",
        "Notes",
    ]

    sample_rows = [
        [
            "Brookside Dairy Ltd",
            "0711002233",
            "0.00",
            "Industrial Area, Road A",
            "P.O. Box 45000",
            "Nairobi",
            "orders@brookside.co.ke",
            "020556677",
            "P051234567A",
            "Daily milk deliveries",
        ],
        [
            "Mumias Sugar Distributors",
            "0722334455",
            "15000.00",
            "Mombasa Road, Godown 4",
            "P.O. Box 12345",
            "Nairobi",
            "sales@mumiasdist.co.ke",
            "",
            "P059876543B",
            "Sugar wholesaler",
        ],
        [
            "Farmers Fresh Produce",
            "0733445566",
            "0.00",
            "Wakulima Market, Stall 12",
            "",
            "Nairobi",
            "info@farmersfresh.co.ke",
            "",
            "",
            "Vegetables and greens supplier",
        ],
    ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(sample_rows)

    data = output.getvalue().encode("utf-8-sig")
    return (data, "TransChap_suppliers_template.csv", "text/csv; charset=utf-8")


def generate_supplier_template(format: str = "xlsx") -> tuple[bytes, str, str]:
    """Generate sample supplier import template in XLSX or CSV format."""
    if (format or "").strip().lower() == "csv":
        return _generate_csv_template()
    return _generate_excel_template()
