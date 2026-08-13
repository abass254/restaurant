"""Add dual-confirmation fields for order delivery / pickup completion.

Idempotent — safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

COLUMNS = [
    ("merchant_delivery_confirmed_at", "DATETIME"),
    ("customer_delivery_confirmed_at", "DATETIME"),
    ("completion_reminder_sent_at", "DATETIME"),
    ("delivery_disputed_at", "DATETIME"),
]


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("orders"):
            print("Nothing to do — orders table missing.")
            return

        existing = {col["name"] for col in insp.get_columns("orders")}
        for name, col_type in COLUMNS:
            if name in existing:
                continue
            conn.execute(text(f"ALTER TABLE orders ADD COLUMN {name} {col_type}"))
            notes.append(f"added column orders.{name}")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — completion confirmation columns already present.")


if __name__ == "__main__":
    main()
