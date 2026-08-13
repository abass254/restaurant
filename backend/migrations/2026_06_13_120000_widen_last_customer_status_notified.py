"""Widen orders.last_customer_status_notified for completion prompt keys.

Completion prompts store keys like ``cmp:awaiting_delivery_confirmation`` which
exceed the original VARCHAR(32) limit and caused confirm-handoff 500 errors.

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
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("orders"):
            print("Nothing to do — orders table missing.")
            return

        existing = {col["name"]: col for col in insp.get_columns("orders")}
        col = existing.get("last_customer_status_notified")
        if col is None:
            conn.execute(
                text(
                    "ALTER TABLE orders ADD COLUMN last_customer_status_notified VARCHAR(64)",
                ),
            )
            print("Migration applied:")
            print("  - added column orders.last_customer_status_notified VARCHAR(64)")
            return

        col_type = str(col.get("type") or "").upper()
        if "64" in col_type:
            print("Nothing to do — last_customer_status_notified already wide enough.")
            return

        dialect = engine.dialect.name
        if dialect == "mysql":
            conn.execute(
                text(
                    "ALTER TABLE orders MODIFY COLUMN last_customer_status_notified VARCHAR(64)",
                ),
            )
        elif dialect == "sqlite":
            # SQLite cannot alter column types; recreate is out of scope for this fix.
            print("Nothing to do — SQLite column width is not enforced at alter time.")
            return
        else:
            conn.execute(
                text(
                    "ALTER TABLE orders ALTER COLUMN last_customer_status_notified TYPE VARCHAR(64)",
                ),
            )
        print("Migration applied:")
        print("  - widened orders.last_customer_status_notified to VARCHAR(64)")


if __name__ == "__main__":
    main()
