"""Bulk shop-customer import from Excel and CSV (name, phone, limit, opening balance)."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from typing import Any, Literal

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from app.services.customer_service import CustomerService, CustomerServiceError
from app.services.rider_service import normalize_phone

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2_000

RowStatus = Literal["created", "updated", "skipped", "error"]

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "name": (
        "name",
        "customer name",
        "customer",
        "full name",
        "client name",
        "client",
    ),
    "phone": (
        "phone",
        "phone number",
        "mobile",
        "mobile number",
        "tel",
        "telephone",
        "contact",
        "msisdn",
    ),
    "credit_limit": (
        "credit limit",
        "limit",
        "tab limit",
        "credit",
        "max credit",
    ),
    "opening_balance": (
        "opening balance",
        "outstanding balance",
        "outstanding",
        "balance",
        "owes",
        "amount owed",
        "opening",
        "tab balance",
    ),
    "notes": ("notes", "note", "remarks", "comment"),
    "email": ("email", "e-mail", "email address"),
    "address": ("address", "location", "physical address", "physical location"),
}


@dataclass
class ParsedRow:
    row_number: int
    name: str | None = None
    phone: str | None = None
    credit_limit: float | None = None
    opening_balance: float | None = None
    notes: str | None = None
    email: str | None = None
    address: str | None = None


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


def _cell_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
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
    phone = _cell_str(col("phone"))

    if not name and not phone:
        # Check for footer / summary row
        joined = " ".join(str(c).strip().lower() for c in raw if c is not None)
        if "total" in joined:
            return
        return

    if not name or not phone:
        early_errors.append(
            RowResult(
                row=row_offset,
                name=name,
                phone=phone,
                status="skipped",
                message="Name and phone are required.",
            ),
        )
        return

    if name.strip().lower() in {"total", "total:"} or phone.strip().lower() in {
        "total",
        "total:",
    }:
        return

    credit_raw = col("credit_limit")
    opening_raw = col("opening_balance")
    credit_limit = _cell_float(credit_raw) if credit_raw not in (None, "") else 0.0
    opening_balance = (
        _cell_float(opening_raw) if opening_raw not in (None, "") else 0.0
    )
    if credit_limit is None:
        early_errors.append(
            RowResult(
                row=row_offset,
                name=name,
                phone=phone,
                status="error",
                message="Credit limit must be a valid amount.",
            ),
        )
        return
    if opening_balance is None:
        early_errors.append(
            RowResult(
                row=row_offset,
                name=name,
                phone=phone,
                status="error",
                message="Opening balance must be a valid amount.",
            ),
        )
        return

    parsed_rows.append(
        ParsedRow(
            row_number=row_offset,
            name=name,
            phone=phone,
            credit_limit=credit_limit,
            opening_balance=opening_balance,
            notes=_cell_str(col("notes")),
            email=_cell_str(col("email")),
            address=_cell_str(col("address")),
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

    all_rows = list(sheet.iter_rows(values_only=True))
    if not all_rows:
        workbook.close()
        raise ValueError("The Excel file is empty.")

    header_row_index = None
    column_map: dict[str, int] = {}
    headers: list[str] = []
    for idx, raw in enumerate(all_rows[:5]):
        candidate = [str(h).strip() if h is not None else "" for h in (raw or ())]
        mapping = _build_column_map(candidate)
        if "name" in mapping and "phone" in mapping:
            header_row_index = idx
            column_map = mapping
            headers = candidate
            break

    if header_row_index is None:
        workbook.close()
        raise ValueError(
            "Could not find required columns: Name, Phone. "
            "Include Name, Phone, and optionally Credit Limit and Opening Balance."
        )

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
        if "name" in mapping and "phone" in mapping:
            header_row_index = idx
            column_map = mapping
            headers = candidate
            break

    if header_row_index is None:
        raise ValueError(
            "Could not find required columns: Name, Phone. "
            "Include Name, Phone, and optionally Credit Limit and Opening Balance."
        )

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


def parse_customers_file(
    content: bytes, filename: str = "customers.xlsx"
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


def import_customers_from_excel(
    db: Session,
    *,
    content: bytes,
    account_id: str,
    filename: str = "customers.xlsx",
) -> ImportResult:
    detected, parsed_rows, early_results = parse_customers_file(content, filename=filename)
    result = ImportResult(detected_columns=detected)
    result.rows.extend(early_results)

    for early in early_results:
        if early.status == "skipped":
            result.skipped += 1
        elif early.status == "error":
            result.errors += 1

    service = CustomerService(db)
    seen_phones: dict[str, str] = {}

    try:
        for row in parsed_rows:
            try:
                normalized = normalize_phone(row.phone or "")
                if normalized and normalized in seen_phones:
                    result.errors += 1
                    result.rows.append(
                        RowResult(
                            row=row.row_number,
                            name=row.name,
                            phone=row.phone,
                            status="error",
                            message="Duplicate phone in this file.",
                        ),
                    )
                    continue

                customer, status = service.upsert_import_customer(
                    account_id,
                    name=row.name or "",
                    phone=row.phone or "",
                    email=row.email,
                    address=row.address,
                    notes=row.notes,
                    credit_limit=row.credit_limit if row.credit_limit is not None else 0,
                    outstanding_balance=(
                        row.opening_balance if row.opening_balance is not None else 0
                    ),
                    commit=False,
                )
                db.flush()
                if customer.phone:
                    seen_phones[customer.phone] = customer.id
            except CustomerServiceError as exc:
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

            if status == "created":
                result.created += 1
                message = "Customer added."
                if Decimal(str(customer.outstanding_balance or 0)) > 0:
                    message = "Customer added with opening balance."
            else:
                result.updated += 1
                message = "Matched existing customer — updated details."

            result.rows.append(
                RowResult(
                    row=row.row_number,
                    name=customer.name,
                    phone=customer.phone,
                    status=status,
                    message=message,
                ),
            )

        db.commit()
    except Exception as exc:
        db.rollback()
        result.created = 0
        result.updated = 0
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
    ws.title = "Customers"

    headers = [
        "Customer Name",
        "Phone",
        "Credit Limit",
        "Opening Balance",
        "Physical Address",
        "Email",
        "Notes",
    ]

    sample_rows = [
        [
            "Alice Wanjiku",
            "0712345678",
            5000.00,
            0.00,
            "Kibera Olympic Stage, House 12",
            "alice.wanjiku@gmail.com",
            "Regular customer, pays weekly",
        ],
        [
            "Brian Otieno",
            "0723456789",
            2000.00,
            750.00,
            "South B, Sanaa Court Apt 3B",
            "",
            "Opening debt carried over from ledger",
        ],
        [
            "Mama Njeri Shop",
            "0734567890",
            10000.00,
            0.00,
            "Ngara Market Stall 44",
            "njeri.retail@yahoo.com",
            "Buys wholesale items on 30-day credit",
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
            if c_idx in (3, 4):  # Credit Limit & Opening Balance
                cell.number_format = "#,##0.00"
                cell.alignment = Alignment(horizontal="right")

    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 15)

    # Instructions sheet
    guide_ws = wb.create_sheet(title="Instructions & Guide")
    instructions = [
        ["Customers Import Guide", ""],
        ["", ""],
        ["Field", "Required?", "Description & Format"],
        ["Customer Name", "Yes", "Full name or business name of your client."],
        ["Phone", "Yes", "Kenyan phone number (e.g. 0712345678, +254712345678). Used for matching."],
        ["Credit Limit", "No", "Maximum credit limit allowed in KES (default: 0.00)."],
        ["Opening Balance", "No", "Existing outstanding balance owed by customer in KES (default: 0.00)."],
        ["Physical Address", "No", "Street name, estate, estate landmark or stall number."],
        ["Email", "No", "Email address for digital receipts and statements."],
        ["Notes", "No", "General remarks, guarantor info, or special agreements."],
        ["", ""],
        ["Deduplication Note:", "", "Customers with existing phone numbers in your account are automatically updated without creating duplicate entries."],
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
        "dukai_customers_template.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _generate_csv_template() -> tuple[bytes, str, str]:
    headers = [
        "Customer Name",
        "Phone",
        "Credit Limit",
        "Opening Balance",
        "Physical Address",
        "Email",
        "Notes",
    ]

    sample_rows = [
        [
            "Alice Wanjiku",
            "0712345678",
            "5000.00",
            "0.00",
            "Kibera Olympic Stage, House 12",
            "alice.wanjiku@gmail.com",
            "Regular customer, pays weekly",
        ],
        [
            "Brian Otieno",
            "0723456789",
            "2000.00",
            "750.00",
            "South B, Sanaa Court Apt 3B",
            "",
            "Opening debt carried over from ledger",
        ],
        [
            "Mama Njeri Shop",
            "0734567890",
            "10000.00",
            "0.00",
            "Ngara Market Stall 44",
            "njeri.retail@yahoo.com",
            "Buys wholesale items on 30-day credit",
        ],
    ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(sample_rows)

    data = output.getvalue().encode("utf-8-sig")
    return (data, "dukai_customers_template.csv", "text/csv; charset=utf-8")


def generate_customer_template(format: str = "xlsx") -> tuple[bytes, str, str]:
    """Generate sample customer import template in XLSX or CSV format."""
    if (format or "").strip().lower() == "csv":
        return _generate_csv_template()
    return _generate_excel_template()
