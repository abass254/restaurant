"""Create deliveries, link orders/offers, backfill from existing rider data."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


DELIVERIES_SQL = """
CREATE TABLE deliveries (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36) NULL,
    delivery_number VARCHAR(32) NOT NULL,
    pickup_address TEXT NULL,
    pickup_lat DOUBLE NULL,
    pickup_lng DOUBLE NULL,
    delivery_address TEXT NULL,
    delivery_notes TEXT NULL,
    customer_name VARCHAR(255) NULL,
    customer_phone VARCHAR(32) NULL,
    delivery_fee DECIMAL(12, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'KES',
    status VARCHAR(32) NOT NULL DEFAULT 'searching',
    assigned_rider_id VARCHAR(36) NULL,
    rider_assigned_at DATETIME NULL,
    rider_dispatched_at DATETIME NULL,
    rider_trip_phase VARCHAR(32) NULL,
    rider_search_expires_at DATETIME NULL,
    merchant_delivery_confirmed_at DATETIME NULL,
    customer_delivery_confirmed_at DATETIME NULL,
    created_by_user_id VARCHAR(36) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    completed_at DATETIME NULL,
    cancelled_at DATETIME NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _has_index(conn, table: str, index_name: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return index_name in {idx["name"] for idx in inspect(conn).get_indexes(table)}


def _column_nullable(conn, table: str, column: str) -> bool | None:
    if not inspect(conn).has_table(table):
        return None
    for col in inspect(conn).get_columns(table):
        if col["name"] == column:
            return bool(col.get("nullable"))
    return None


def _delivery_status_for_order(row: dict) -> str:
    status = row.get("status") or ""
    phase = row.get("rider_trip_phase") or ""
    if status == "cancelled" or phase == "cancelled":
        return "cancelled"
    if phase == "completed" or status == "delivered":
        return "completed"
    if row.get("assigned_rider_id"):
        return "active"
    return "searching"


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)

        if not insp.has_table("deliveries"):
            conn.execute(text(DELIVERIES_SQL))
            notes.append("created deliveries table")

        for index_name, ddl in (
            ("deliveries_delivery_number_unique", "CREATE UNIQUE INDEX deliveries_delivery_number_unique ON deliveries (delivery_number)"),
            ("deliveries_account_id_status_index", "CREATE INDEX deliveries_account_id_status_index ON deliveries (account_id, status)"),
            ("deliveries_account_id_created_at_index", "CREATE INDEX deliveries_account_id_created_at_index ON deliveries (account_id, created_at)"),
            ("deliveries_order_id_index", "CREATE INDEX deliveries_order_id_index ON deliveries (order_id)"),
            ("deliveries_assigned_rider_id_index", "CREATE INDEX deliveries_assigned_rider_id_index ON deliveries (assigned_rider_id)"),
        ):
            if insp.has_table("deliveries") and not _has_index(conn, "deliveries", index_name):
                conn.execute(text(ddl))
                notes.append(f"added index {index_name}")

        if insp.has_table("orders") and not _has_column(conn, "orders", "delivery_id"):
            conn.execute(
                text("ALTER TABLE orders ADD COLUMN delivery_id VARCHAR(36) NULL"),
            )
            notes.append("added orders.delivery_id")

        if insp.has_table("delivery_offers") and not _has_column(conn, "delivery_offers", "delivery_id"):
            conn.execute(
                text("ALTER TABLE delivery_offers ADD COLUMN delivery_id VARCHAR(36) NULL"),
            )
            notes.append("added delivery_offers.delivery_id")

        if insp.has_table("delivery_offers") and _column_nullable(conn, "delivery_offers", "order_id") is False:
            conn.execute(
                text("ALTER TABLE delivery_offers MODIFY COLUMN order_id VARCHAR(36) NULL"),
            )
            notes.append("delivery_offers.order_id is now nullable")

        # Backfill deliveries from orders that have rider/delivery activity.
        if inspect(conn).has_table("deliveries") and inspect(conn).has_table("orders"):
            rows = conn.execute(
                text(
                    """
                    SELECT o.*
                    FROM orders o
                    WHERE o.source = 'rider_request'
                       OR o.assigned_rider_id IS NOT NULL
                       OR o.rider_trip_phase IS NOT NULL
                       OR o.delivery_id IS NOT NULL
                       OR EXISTS (
                           SELECT 1 FROM delivery_offers dof WHERE dof.order_id = o.id
                       )
                    """,
                ),
            ).mappings().all()

            existing_for_order = {
                row["order_id"]
                for row in conn.execute(
                    text("SELECT order_id FROM deliveries WHERE order_id IS NOT NULL"),
                ).mappings()
            }
            max_seq_row = conn.execute(
                text(
                    """
                    SELECT MAX(CAST(SUBSTRING(delivery_number, 5) AS UNSIGNED)) AS max_seq
                    FROM deliveries
                    WHERE delivery_number LIKE 'DEL-%'
                    """,
                ),
            ).mappings().first()
            seq = int(max_seq_row["max_seq"] or 0)

            backfilled = 0
            for row in rows:
                if row.get("delivery_id") or row["id"] in existing_for_order:
                    continue
                seq += 1
                delivery_id = str(uuid.uuid4())
                delivery_number = f"DEL-{seq:06d}"
                while conn.execute(
                    text("SELECT id FROM deliveries WHERE delivery_number = :n"),
                    {"n": delivery_number},
                ).first():
                    seq += 1
                    delivery_number = f"DEL-{seq:06d}"

                status = _delivery_status_for_order(dict(row))
                conn.execute(
                    text(
                        """
                        INSERT INTO deliveries (
                            id, account_id, order_id, delivery_number,
                            pickup_address, pickup_lat, pickup_lng,
                            delivery_address, delivery_notes,
                            customer_name, customer_phone,
                            delivery_fee, currency, status,
                            assigned_rider_id, rider_assigned_at, rider_dispatched_at,
                            rider_trip_phase, rider_search_expires_at,
                            merchant_delivery_confirmed_at, customer_delivery_confirmed_at,
                            created_by_user_id, created_at, updated_at,
                            completed_at, cancelled_at
                        ) VALUES (
                            :id, :account_id, :order_id, :delivery_number,
                            :pickup_address, :pickup_lat, :pickup_lng,
                            :delivery_address, :delivery_notes,
                            :customer_name, :customer_phone,
                            :delivery_fee, :currency, :status,
                            :assigned_rider_id, :rider_assigned_at, :rider_dispatched_at,
                            :rider_trip_phase, :rider_search_expires_at,
                            :merchant_delivery_confirmed_at, :customer_delivery_confirmed_at,
                            :placed_by_user_id, :created_at, :updated_at,
                            :completed_at, :cancelled_at
                        )
                        """,
                    ),
                    {
                        "id": delivery_id,
                        "account_id": row["account_id"],
                        "order_id": row["id"],
                        "delivery_number": delivery_number,
                        "pickup_address": row.get("pickup_address"),
                        "pickup_lat": row.get("pickup_lat"),
                        "pickup_lng": row.get("pickup_lng"),
                        "delivery_address": row.get("delivery_address"),
                        "delivery_notes": row.get("delivery_notes"),
                        "customer_name": row.get("customer_name"),
                        "customer_phone": row.get("customer_phone"),
                        "delivery_fee": row.get("delivery_fee") or 0,
                        "currency": row.get("currency") or "KES",
                        "status": status,
                        "assigned_rider_id": row.get("assigned_rider_id"),
                        "rider_assigned_at": row.get("rider_assigned_at"),
                        "rider_dispatched_at": row.get("rider_dispatched_at"),
                        "rider_trip_phase": row.get("rider_trip_phase"),
                        "rider_search_expires_at": row.get("rider_search_expires_at"),
                        "merchant_delivery_confirmed_at": row.get("merchant_delivery_confirmed_at"),
                        "customer_delivery_confirmed_at": row.get("customer_delivery_confirmed_at"),
                        "placed_by_user_id": row.get("placed_by_user_id"),
                        "created_at": row.get("created_at"),
                        "updated_at": row.get("updated_at"),
                        "completed_at": row.get("completed_at"),
                        "cancelled_at": row.get("cancelled_at"),
                    },
                )
                conn.execute(
                    text("UPDATE orders SET delivery_id = :did WHERE id = :oid"),
                    {"did": delivery_id, "oid": row["id"]},
                )
                conn.execute(
                    text(
                        "UPDATE delivery_offers SET delivery_id = :did WHERE order_id = :oid AND delivery_id IS NULL",
                    ),
                    {"did": delivery_id, "oid": row["id"]},
                )
                backfilled += 1
            if backfilled:
                notes.append(f"backfilled {backfilled} deliveries from orders")

    if notes:
        print("Applied:", "; ".join(notes))
    else:
        print("Nothing to apply.")


if __name__ == "__main__":
    main()
