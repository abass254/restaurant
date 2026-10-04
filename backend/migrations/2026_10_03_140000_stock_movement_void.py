"""Let purchases (stock-in movements) be voided."""

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
        if not inspect(conn).has_table("stock_movements"):
            print("stock_movements table missing; nothing to do.")
            return
        timestamp = "TIMESTAMP" if conn.dialect.name == "postgresql" else "DATETIME"
        columns = {
            "voided_at": f"{timestamp} NULL",
            "voided_by": "VARCHAR(36) NULL",
            "void_reason": "VARCHAR(1000) NULL",
        }
        for column, ddl in columns.items():
            if not _has_column(conn, "stock_movements", column):
                conn.execute(
                    text(f"ALTER TABLE stock_movements ADD COLUMN {column} {ddl}")
                )
    print("Stock movement void columns are ready.")


if __name__ == "__main__":
    migrate()
