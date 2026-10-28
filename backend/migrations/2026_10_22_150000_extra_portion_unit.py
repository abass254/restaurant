"""Give each extra its own recipe: a supply batch, the portions it makes, and the portion name."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("modifier_options"):
            print("modifier_options table missing; skip extra recipes.")
            return
        columns = {column["name"] for column in inspector.get_columns("modifier_options")}
        if "batch_yield" not in columns:
            conn.execute(
                text("ALTER TABLE modifier_options ADD COLUMN batch_yield NUMERIC(10, 3) NOT NULL DEFAULT 1")
            )
        if "portion_unit" not in columns:
            conn.execute(text("ALTER TABLE modifier_options ADD COLUMN portion_unit VARCHAR(32)"))
    print("Extras can have their own recipe.")


if __name__ == "__main__":
    migrate()
