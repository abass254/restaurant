"""Store each shop's available menu equivalence measures."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import KitchenEquivalenceUnit  # noqa: E402


def main() -> None:
    table = KitchenEquivalenceUnit.__table__
    with engine.begin() as conn:
        if not inspect(conn).has_table(table.name):
            table.create(bind=conn)
            print("created kitchen_equivalence_units")
        else:
            print("kitchen_equivalence_units already up to date")
        if inspect(conn).has_table("recipe_serving_units"):
            result = conn.execute(
                text(
                    "INSERT IGNORE INTO kitchen_equivalence_units "
                    "(id, account_id, name, sort_order) "
                    "SELECT UUID(), account_id, serving_unit, 0 "
                    "FROM recipe_serving_units "
                    "WHERE serving_unit IS NOT NULL AND TRIM(serving_unit) <> '' "
                    "GROUP BY account_id, serving_unit"
                )
            )
            if result.rowcount:
                print(f"imported {result.rowcount} existing recipe measures")


if __name__ == "__main__":
    main()
