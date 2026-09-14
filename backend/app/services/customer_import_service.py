"""Bulk shop-customer import from Excel (name, phone, limit, opening balance)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from typing import Any, Literal

from openpyxl import load_workbook
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
    "address": ("address", "location"),
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

    missing: list[str] = []
    if "name" not in column_map:
        missing.append("Name")
    if "phone" not in column_map:
        missing.append("Phone")
    if missing:
        workbook.close()
        raise ValueError(
            "Could not find required columns: "
            + ", ".join(missing)
            + ". Include Name, Phone, and optionally Credit Limit and Opening Balance."
        )

    parsed_rows: list[ParsedRow] = []
    early_errors: list[RowResult] = []

    for row_offset, raw in enumerate(rows_iter, start=2):
        if row_offset > MAX_IMPORT_ROWS + 1:
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

        if raw is None or all(cell is None or str(cell).strip() == "" for cell in raw):
            continue

        def col(field: str) -> Any:
            idx = column_map.get(field)
            if idx is None or idx >= len(raw):
                return None
            return raw[idx]

        name = _cell_str(col("name"))
        phone = _cell_str(col("phone"))
        if not name and not phone:
            continue
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
            continue

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
            continue
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
            continue

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

    workbook.close()
    return detected, parsed_rows, early_errors


def import_customers_from_excel(
    db: Session,
    *,
    content: bytes,
    account_id: str,
) -> ImportResult:
    detected, parsed_rows, early_results = _parse_workbook(content)
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
                message = "Matched by phone — updated details."

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
