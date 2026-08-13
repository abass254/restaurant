"""Rider PWA: presence, offers, trip phases, and login codes."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


DELIVERY_OFFERS_SQL = """
CREATE TABLE delivery_offers (
    id CHAR(36) NOT NULL PRIMARY KEY,
    account_id CHAR(36) NOT NULL,
    order_id CHAR(36) NOT NULL,
    rider_id CHAR(36) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at DATETIME NOT NULL,
    responded_at DATETIME NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
)
"""

RIDER_LOGIN_CODES_SQL = """
CREATE TABLE rider_login_codes (
    id CHAR(36) NOT NULL PRIMARY KEY,
    rider_id CHAR(36) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NULL,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
)
"""


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in insp_columns(conn, table)


def insp_columns(conn, table: str) -> set[str]:
    return {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)

        if insp.has_table("riders"):
            for column, ddl in (
                ("is_online", "TINYINT(1) NOT NULL DEFAULT 0"),
                ("last_seen_at", "DATETIME NULL"),
                ("last_lat", "DOUBLE NULL"),
                ("last_lng", "DOUBLE NULL"),
            ):
                if not _has_column(conn, "riders", column):
                    conn.execute(text(f"ALTER TABLE riders ADD COLUMN {column} {ddl}"))
                    notes.append(f"added riders.{column}")

        if insp.has_table("orders"):
            if not _has_column(conn, "orders", "rider_trip_phase"):
                conn.execute(
                    text(
                        "ALTER TABLE orders ADD COLUMN rider_trip_phase VARCHAR(32) NULL",
                    ),
                )
                notes.append("added orders.rider_trip_phase")

        insp = inspect(conn)
        if not insp.has_table("delivery_offers"):
            conn.execute(text(DELIVERY_OFFERS_SQL))
            notes.append("created table delivery_offers")

        if not insp.has_table("rider_login_codes"):
            conn.execute(text(RIDER_LOGIN_CODES_SQL))
            notes.append("created table rider_login_codes")

        insp = inspect(conn)
        if insp.has_table("delivery_offers"):
            indexes = {row["name"] for row in insp.get_indexes("delivery_offers")}
            if "delivery_offers_rider_status_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX delivery_offers_rider_status_index "
                        "ON delivery_offers (rider_id, status)",
                    ),
                )
                notes.append("created index delivery_offers_rider_status_index")
            if "delivery_offers_order_status_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX delivery_offers_order_status_index "
                        "ON delivery_offers (order_id, status)",
                    ),
                )
                notes.append("created index delivery_offers_order_status_index")

        if insp.has_table("rider_login_codes"):
            indexes = {row["name"] for row in insp.get_indexes("rider_login_codes")}
            if "rider_login_codes_rider_id_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX rider_login_codes_rider_id_index "
                        "ON rider_login_codes (rider_id)",
                    ),
                )
                notes.append("created index rider_login_codes_rider_id_index")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Rider PWA schema already in place.")


if __name__ == "__main__":
    main()
