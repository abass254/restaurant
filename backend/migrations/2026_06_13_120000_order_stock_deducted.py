"""Track whether an order already reduced inventory stock.

Idempotent — safe to re-run.
"""

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
        if "stock_deducted" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE orders ADD COLUMN stock_deducted BOOLEAN NOT NULL DEFAULT 0"
                )
            )
            notes.append("added column orders.stock_deducted")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — orders.stock_deducted already present.")


if __name__ == "__main__":
    main()
