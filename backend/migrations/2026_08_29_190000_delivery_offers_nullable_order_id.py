"""Allow delivery_offers.order_id to be null (standalone deliveries have no order)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _column_nullable(conn, table: str, column: str) -> bool | None:
    if not inspect(conn).has_table(table):
        return None
    for col in inspect(conn).get_columns(table):
        if col["name"] == column:
            return bool(col.get("nullable"))
    return None


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        if not inspect(conn).has_table("delivery_offers"):
            print("delivery_offers table missing — skip.")
            return

        nullable = _column_nullable(conn, "delivery_offers", "order_id")
        if nullable is False:
            conn.execute(
                text("ALTER TABLE delivery_offers MODIFY COLUMN order_id VARCHAR(36) NULL"),
            )
            notes.append("delivery_offers.order_id is now nullable")

    if notes:
        print("Applied:", "; ".join(notes))
    else:
        print("Nothing to apply.")


if __name__ == "__main__":
    main()
