"""Preserve the recipe batch amount and its menu-serving yield."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("recipe_lines"):
            print("recipe_lines does not exist; run the recipe migrations first")
            return

        columns = {column["name"] for column in inspector.get_columns("recipe_lines")}
        if "batch_quantity" not in columns:
            conn.execute(text("ALTER TABLE recipe_lines ADD COLUMN batch_quantity DECIMAL(14, 6) NULL"))
            columns.add("batch_quantity")
            notes.append("added recipe_lines.batch_quantity")
        if "batch_yield" not in columns:
            conn.execute(text("ALTER TABLE recipe_lines ADD COLUMN batch_yield DECIMAL(14, 6) NULL"))
            notes.append("added recipe_lines.batch_yield")

        conn.execute(
            text(
                "UPDATE recipe_lines SET batch_quantity = quantity "
                "WHERE batch_quantity IS NULL"
            )
        )
        conn.execute(
            text(
                "UPDATE recipe_lines SET batch_yield = 1 "
                "WHERE batch_yield IS NULL OR batch_yield <= 0"
            )
        )

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Recipe batch columns already exist.")


if __name__ == "__main__":
    main()
