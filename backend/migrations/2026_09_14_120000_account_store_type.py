"""Add accounts.store_type (retail | restaurant).

Idempotent — safe to re-run. Defaults existing shops to retail.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    with engine.begin() as conn:
        if _has_column(conn, "accounts", "store_type"):
            print("accounts.store_type already exists.")
            return
        conn.execute(
            text(
                "ALTER TABLE accounts ADD COLUMN store_type VARCHAR(32) "
                "NOT NULL DEFAULT 'retail'"
            )
        )
        print("added accounts.store_type")


if __name__ == "__main__":
    main()
