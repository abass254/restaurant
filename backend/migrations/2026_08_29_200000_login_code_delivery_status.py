"""Track login-code channel and delivery status for merchant/rider OTP."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        for table in ("user_login_codes", "rider_login_codes"):
            if not inspect(conn).has_table(table):
                continue
            if not _has_column(conn, table, "channel"):
                conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN channel VARCHAR(16) NULL"),
                )
                notes.append(f"added {table}.channel")
            if not _has_column(conn, table, "delivery_status"):
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN delivery_status VARCHAR(16) NULL",
                    ),
                )
                notes.append(f"added {table}.delivery_status")
            if table == "user_login_codes" and not _has_column(conn, table, "purpose"):
                conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN purpose VARCHAR(16) NULL"),
                )
                notes.append("added user_login_codes.purpose")

    if notes:
        print("Applied:", "; ".join(notes))
    else:
        print("Nothing to apply.")


if __name__ == "__main__":
    main()
