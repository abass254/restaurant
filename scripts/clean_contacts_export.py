#!/usr/bin/env python3
"""Clean POS customer / supplier exports into DukAI contact import CSVs.

Phones are optional on import: a row without a usable, unique phone is written
with a blank Phone (DukAI keeps M-PESA prompts, WhatsApp reminders and credit
sales off for it until a number is added) and the original value is kept in
Notes so nothing is lost.

Usage: clean_contacts_export.py customers|suppliers INPUT.csv OUTPUT.csv [NOTES.txt]
"""

from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

CUSTOMER_HEADERS = [
    "Customer Name",
    "Phone",
    "Credit Limit",
    "Opening Balance",
    "Address",
    "Postal Code",
    "City",
    "Email",
    "Fax",
    "Notes",
]

SUPPLIER_HEADERS = [
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

# Raw column order of each export (the customer export's header row is wrong;
# its data actually follows this layout).
CUSTOMER_RAW = ["name", "phone", "credit_limit", "balance", "address", "postal_code", "city", "email", "fax", "notes"]
SUPPLIER_RAW = ["name", "phone", "balance", "address", "postal_code", "city", "email", "fax", "pin_number", "notes"]

# Values copied from the DukAI download template's sample rows into real rows.
SAMPLE_VALUES = {
    "regular customer, pays weekly",
    "opening debt carried over from ledger",
    "buys wholesale items on 30-day credit",
    "daily milk deliveries",
    "sugar wholesaler",
    "vegetables and greens supplier",
    "orders@brookside.co.ke",
    "sales@mumiasdist.co.ke",
    "info@farmersfresh.co.ke",
    "alice.wanjiku@gmail.com",
    "njeri.retail@yahoo.com",
    "p.o. box 45000",
    "p.o. box 12345",
    "p.o. box 10100",
    "p.o. box 80100",
    "020556677",
    "041223344",
}

FILLER = {"1", "0"}
PIN_RE = re.compile(r"^[AP]\d{9}[A-Z]$")
HEADER_NAMES = {"name", "customer name", "supplier name"}


@dataclass
class Contact:
    line: int
    values: dict[str, str]
    extra_notes: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.values["name"]


def _clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _money(value: str) -> float | None:
    text = value.replace(",", "").strip()
    if not text:
        return None
    return round(float(text), 2) + 0.0


def _fmt_money(value: float | None) -> str:
    return "" if value is None else f"{value:.2f}"


def _phone(raw: str) -> tuple[str | None, str | None]:
    """Return (usable 0XXXXXXXXX phone, reason it was rejected)."""
    text = raw.strip()
    if not text or text in FILLER:
        return None, None
    if re.search(r"e[+-]?\d+$", text, re.IGNORECASE):
        return None, f"phone '{text}' was cut short by Excel (scientific notation)"
    digits = re.sub(r"\D", "", text)
    if len(digits) == 10 and digits.startswith("0"):
        return digits, None
    if len(digits) == 9 and digits[0] in "712":
        return f"0{digits}", None
    if len(digits) == 12 and digits.startswith("254"):
        return f"0{digits[3:]}", None
    return None, f"phone '{text}' is not a valid Kenyan number"


def _pin(raw: str) -> str:
    pin = re.sub(r"\s+", "", raw).upper()
    if pin in FILLER:
        return ""
    if not PIN_RE.match(pin) and len(pin) > 1:
        fixed = pin[0] + pin[1:-1].replace("O", "0") + pin[-1]
        if PIN_RE.match(fixed):
            return fixed
    return pin


def _postal(raw: str) -> str:
    if raw.isdigit() and len(raw) < 5:
        return raw.zfill(5)
    return raw


def read_rows(path: Path, layout: list[str]) -> list[Contact]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))
    contacts = []
    for line, row in enumerate(rows, start=1):
        cells = [_clean_text(c) for c in row]
        if not any(cells):
            continue
        if cells[0].lower() in HEADER_NAMES:
            continue
        values = {key: (cells[i] if i < len(cells) else "") for i, key in enumerate(layout)}
        contacts.append(Contact(line=line, values=values))
    return contacts


def clean(kind: str, contacts: list[Contact], notes: list[str]) -> list[Contact]:
    is_customer = kind == "customers"
    kept: list[Contact] = []
    seen_rows: dict[tuple, Contact] = {}

    for c in contacts:
        v = c.values
        label = f"Line {c.line} '{v['name']}'"

        sample_hits = [k for k, val in v.items() if val.lower() in SAMPLE_VALUES]
        if sample_hits:
            for key in sample_hits:
                v[key] = ""
            if is_customer and v.get("credit_limit"):
                v["credit_limit"] = ""
                sample_hits.append("credit_limit")
            if not is_customer and v.get("city", "").lower() == "nairobi":
                v["city"] = ""
                sample_hits.append("city")
            notes.append(f"{label}: removed values copied from the template sample rows ({', '.join(sample_hits)}).")

        for key in ("address", "postal_code", "city", "email", "fax", "pin_number"):
            if v.get(key) in FILLER:
                v[key] = ""

        if "@" in v["phone"]:
            if not v["email"]:
                v["email"] = v["phone"].lower()
            notes.append(f"{label}: email '{v['phone']}' was in the phone column; moved to Email.")
            v["phone"] = ""

        if v["email"] and "@" not in v["email"]:
            moved = v["email"]
            v["email"] = ""
            if not v["city"]:
                v["city"] = moved
                notes.append(f"{label}: '{moved}' was in the Email column; moved to City.")
            else:
                c.extra_notes.append(moved)
                notes.append(f"{label}: '{moved}' was in the Email column; moved to Notes.")

        if v["fax"] and not v["phone"]:
            fax_phone, _ = _phone(v["fax"])
            if fax_phone and fax_phone.startswith(("07", "01")):
                notes.append(f"{label}: mobile number '{v['fax']}' was in the Fax column; moved to Phone.")
                v["phone"] = v["fax"]
                v["fax"] = ""

        if v["postal_code"] and not re.search(r"\d", v["postal_code"]):
            moved = v["postal_code"]
            v["postal_code"] = ""
            v["address"] = ", ".join(p for p in (v["address"], moved) if p)
            notes.append(f"{label}: '{moved}' was in the Postal Code column; moved to Address.")
        v["postal_code"] = _postal(v["postal_code"])

        phone_parts = [p for p in re.split(r"[\s/,;]+", v["phone"]) if p] if re.search(r"\d[\s/,;]+0?\d", v["phone"]) else [v["phone"]]
        phone, problem = _phone(phone_parts[0])
        if len(phone_parts) > 1:
            c.extra_notes.append(f"Other phone: {' '.join(phone_parts[1:])}")
            notes.append(f"{label}: has several phones; used the first, kept the rest in Notes.")
        if problem:
            c.extra_notes.append(f"Original {problem} - check and update")
            notes.append(f"{label}: {problem}; kept it in Notes.")
        v["phone"] = phone or ""

        if "pin_number" in v:
            pin = _pin(v["pin_number"])
            if pin != v["pin_number"] and v["pin_number"] not in FILLER:
                notes.append(f"{label}: PIN '{v['pin_number']}' tidied to '{pin}'.")
            v["pin_number"] = pin

        for key in ("balance", "credit_limit"):
            if key not in v:
                continue
            try:
                amount = _money(v[key])
            except ValueError:
                c.extra_notes.append(f"Original {key.replace('_', ' ')}: {v[key]}")
                notes.append(f"{label}: {key} '{v[key]}' is not a number; kept it in Notes.")
                amount = None
            if is_customer and key == "balance" and amount is not None and amount < 0:
                if amount <= -0.01:
                    c.extra_notes.append(f"Customer has a credit of KSh {-amount:,.2f} (opening balance was {amount:.2f})")
                    notes.append(f"{label}: negative opening balance {amount:.2f} can't be stored; set to 0 and noted.")
                amount = 0.0
            v[key] = _fmt_money(amount)

        key = tuple(v.values())
        if key in seen_rows:
            notes.append(f"{label}: exact duplicate of line {seen_rows[key].line}; dropped.")
            continue
        seen_rows[key] = c
        kept.append(c)

    if not is_customer:
        pin_owner: dict[str, Contact] = {}
        for c in kept:
            pin = c.values["pin_number"]
            if not pin:
                continue
            owner = pin_owner.get(pin)
            if owner is None:
                pin_owner[pin] = c
                continue
            c.values["pin_number"] = ""
            c.extra_notes.append(f"KRA PIN {pin} (also on {owner.name}) - check which is correct")
            notes.append(
                f"Line {c.line} '{c.name}': PIN {pin} is also on '{owner.name}'; "
                "moved to Notes so the import doesn't merge them."
            )

    phone_owner: dict[str, Contact] = {}
    name_owner: dict[str, Contact] = {}
    without_phone = 0
    for c in kept:
        phone = c.values["phone"]
        if phone and phone in phone_owner:
            owner = phone_owner[phone]
            c.extra_notes.append(f"Shares phone {phone} with {owner.name}")
            notes.append(
                f"Line {c.line} '{c.name}': phone {phone} is also on '{owner.name}'; "
                "left blank so the import doesn't merge them."
            )
            phone = ""
        if phone:
            phone_owner[phone] = c
        else:
            without_phone += 1
            name_key = c.name.lower()
            if name_key in name_owner:
                notes.append(
                    f"Line {c.line} '{c.name}': no phone and same name as line "
                    f"{name_owner[name_key].line}; the import will combine them."
                )
            name_owner.setdefault(name_key, c)
        c.values["phone"] = phone

        merged = [n for n in (c.values["notes"], *c.extra_notes) if n]
        c.values["notes"] = "; ".join(merged)

    notes.insert(0, f"{len(kept)} {kind} written ({without_phone} without a phone).")
    return kept


def write_rows(path: Path, kind: str, contacts: list[Contact]) -> None:
    headers = CUSTOMER_HEADERS if kind == "customers" else SUPPLIER_HEADERS
    layout = CUSTOMER_RAW if kind == "customers" else SUPPLIER_RAW
    order = ["name", "phone", *(k for k in layout if k not in {"name", "phone", "notes"}), "notes"]
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow(headers)
        for c in contacts:
            writer.writerow([c.values[k] for k in order])


def main() -> None:
    if len(sys.argv) < 4 or sys.argv[1] not in {"customers", "suppliers"}:
        sys.exit(__doc__)
    kind = sys.argv[1]
    src, dst = Path(sys.argv[2]), Path(sys.argv[3])
    notes_path = Path(sys.argv[4]) if len(sys.argv) > 4 else None

    layout = CUSTOMER_RAW if kind == "customers" else SUPPLIER_RAW
    notes: list[str] = []
    contacts = clean(kind, read_rows(src, layout), notes)
    write_rows(dst, kind, contacts)

    text = "\n".join(notes) + "\n"
    if notes_path:
        notes_path.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
