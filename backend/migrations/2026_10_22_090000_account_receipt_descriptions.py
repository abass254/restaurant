"""Lines a merchant can print under the shop name on till receipts."""

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


def migrate() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("accounts"):
            print("accounts table missing; run earlier migrations first.")
            return
        if not _has_column(conn, "accounts", "receipt_descriptions"):
            conn.execute(text("ALTER TABLE accounts ADD COLUMN receipt_descriptions JSON NULL"))
    print("Account receipt descriptions column is ready.")


if __name__ == "__main__":
    migrate()
