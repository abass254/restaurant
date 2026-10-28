"""Remember the selected inventory unit on each recipe line."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402
from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("recipe_lines"):
            print("recipe_lines does not exist; migration skipped")
            return
        columns = {column["name"] for column in inspector.get_columns("recipe_lines")}
        if "ingredient_unit" not in columns:
            conn.execute(text("ALTER TABLE recipe_lines ADD COLUMN ingredient_unit VARCHAR(64) NULL"))
            print("added recipe_lines.ingredient_unit")
        else:
            print("recipe_lines.ingredient_unit already exists")


if __name__ == "__main__":
    main()
