"""Store each shop's menu recipe output unit."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import RecipeServingUnit  # noqa: E402


def main() -> None:
    table = RecipeServingUnit.__table__
    with engine.begin() as conn:
        if not inspect(conn).has_table(table.name):
            table.create(bind=conn)
            print("created recipe_serving_units")
        else:
            print("recipe_serving_units already up to date")


if __name__ == "__main__":
    main()
