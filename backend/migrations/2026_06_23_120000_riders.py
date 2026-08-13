"""Create riders fleet tables and order rider assignment columns."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


RIDERS_SQL = """
CREATE TABLE riders (
    id CHAR(36) NOT NULL PRIMARY KEY,
    account_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'invited',
    user_id CHAR(36) NULL,
    vehicle_type VARCHAR(64) NULL,
    notes TEXT NULL,
    invited_at DATETIME NULL,
    activated_at DATETIME NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
)
"""

RIDER_INVITES_SQL = """
CREATE TABLE rider_invites (
    id CHAR(36) NOT NULL PRIMARY KEY,
    rider_id CHAR(36) NOT NULL,
    token_jti VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    accepted_at DATETIME NULL,
    created_at DATETIME NULL,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
)
"""


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)

        if not insp.has_table("riders"):
            conn.execute(text(RIDERS_SQL))
            notes.append("created table riders")
        if not insp.has_table("rider_invites"):
            conn.execute(text(RIDER_INVITES_SQL))
            notes.append("created table rider_invites")

        insp = inspect(conn)
        if insp.has_table("riders"):
            indexes = {row["name"] for row in insp.get_indexes("riders")}
            if "riders_account_id_status_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX riders_account_id_status_index "
                        "ON riders (account_id, status)",
                    ),
                )
                notes.append("created index riders_account_id_status_index")
            if "riders_account_id_phone_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX riders_account_id_phone_index "
                        "ON riders (account_id, phone)",
                    ),
                )
                notes.append("created index riders_account_id_phone_index")

        if insp.has_table("rider_invites"):
            indexes = {row["name"] for row in insp.get_indexes("rider_invites")}
            if "rider_invites_token_jti_unique" not in indexes:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX rider_invites_token_jti_unique "
                        "ON rider_invites (token_jti)",
                    ),
                )
                notes.append("created index rider_invites_token_jti_unique")

        for column, ddl in (
            ("assigned_rider_id", "CHAR(36) NULL"),
            ("rider_assigned_at", "DATETIME NULL"),
            ("rider_dispatched_at", "DATETIME NULL"),
        ):
            if not _has_column(conn, "orders", column):
                conn.execute(text(f"ALTER TABLE orders ADD COLUMN {column} {ddl}"))
                notes.append(f"added orders.{column}")

        if _has_column(conn, "orders", "assigned_rider_id"):
            insp = inspect(conn)
            fks = {fk["name"] for fk in insp.get_foreign_keys("orders")}
            if "orders_assigned_rider_id_fkey" not in fks:
                try:
                    conn.execute(
                        text(
                            """
                            ALTER TABLE orders
                            ADD CONSTRAINT orders_assigned_rider_id_fkey
                            FOREIGN KEY (assigned_rider_id) REFERENCES riders(id)
                            ON DELETE SET NULL
                            """,
                        ),
                    )
                    notes.append("added FK orders.assigned_rider_id")
                except Exception:
                    pass

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Riders schema already in place.")


if __name__ == "__main__":
    main()
