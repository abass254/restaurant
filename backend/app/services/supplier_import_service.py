"""Bulk shop-supplier import from Excel (name, phone, notes)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any, Literal

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.services.rider_service import normalize_phone
from app.services.supplier_service import SupplierService, SupplierServiceError

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2_000

RowStatus = Literal["created", "updated", "skipped", "error"]

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
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
    "notes": ("notes", "note", "remarks", "comment", "address", "location"),
}


@dataclass
class ParsedRow:
    row_number: int
    name: str | None = None
    phone: str | None = None
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
        if "name" in mapping and "phone" in mapping:
            header_row_index = idx
            column_map = mapping
            headers = candidate
            break

    if header_row_index is None:
        workbook.close()
        raise ValueError(
            "Could not find required columns: Name, Phone. "
            "Include Name, Phone, and optionally Notes."
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
            # Skip footer / total rows
            joined = " ".join(str(c).strip().lower() for c in raw if c is not None)
            if "total" in joined:
                continue
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

        if name.strip().lower() in {"total", "total:"} or phone.strip().lower() in {
            "total",
            "total:",
        }:
            continue

        parsed_rows.append(
            ParsedRow(
                row_number=row_offset,
                name=name,
                phone=phone,
                notes=_cell_str(col("notes")),
            ),
        )

    workbook.close()
    return detected, parsed_rows, early_errors


def import_suppliers_from_excel(
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

    service = SupplierService(db)
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

                supplier, status = service.upsert_import_supplier(
                    account_id,
                    name=row.name or "",
                    phone=row.phone or "",
                    notes=row.notes,
                    commit=False,
                )
                db.flush()
                if supplier.phone:
                    seen_phones[supplier.phone] = supplier.id
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

            if status == "created":
                result.created += 1
                message = "Supplier added."
            else:
                result.updated += 1
                message = "Matched by phone — updated details."

            result.rows.append(
                RowResult(
                    row=row.row_number,
                    name=supplier.name,
                    phone=supplier.phone,
                    status=status,  # type: ignore[arg-type]
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
