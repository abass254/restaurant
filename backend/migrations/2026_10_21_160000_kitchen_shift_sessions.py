"""Create kitchen shift handover sessions."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import KitchenShiftSession  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table(KitchenShiftSession.__tablename__):
            KitchenShiftSession.__table__.create(bind=conn)
            print("created kitchen_shift_sessions")
            return
        columns = {column["name"] for column in inspector.get_columns(KitchenShiftSession.__tablename__)}
        if "orders_cleared" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE kitchen_shift_sessions "
                    "ADD COLUMN orders_cleared BOOLEAN NOT NULL DEFAULT FALSE"
                )
            )
            print("added kitchen_shift_sessions.orders_cleared")
        else:
            print("kitchen_shift_sessions already up to date")


if __name__ == "__main__":
    main()
