"""Add composite index on orders (account_id, source, created_at, id) for walkin sales listing."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

INDEX_NAME = "orders_account_id_source_created_at_index"


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("orders"):
            print("orders table missing — run earlier migrations first")
            return

        indexes = {row["name"] for row in insp.get_indexes("orders")}
        if INDEX_NAME not in indexes:
            conn.execute(
                text(
                    f"CREATE INDEX {INDEX_NAME} "
                    "ON orders (account_id, source, created_at, id)",
                ),
            )
            notes.append(f"created index {INDEX_NAME}")
        else:
            notes.append(f"{INDEX_NAME} already exists")

    print("\n".join(notes) if notes else "no changes")


if __name__ == "__main__":
    main()
