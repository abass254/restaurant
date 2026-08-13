"""Add external order sync fields to orders."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("orders"):
            print("Nothing to do — orders table missing.")
            return

        existing = {col["name"] for col in insp.get_columns("orders")}
        if "external_order_id" not in existing:
            conn.execute(text("ALTER TABLE orders ADD COLUMN external_order_id VARCHAR(128) NULL"))
            notes.append("added column orders.external_order_id")
        if "external_sync_status" not in existing:
            conn.execute(text("ALTER TABLE orders ADD COLUMN external_sync_status VARCHAR(32) NULL"))
            notes.append("added column orders.external_sync_status")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — external order columns already present.")


if __name__ == "__main__":
    main()
