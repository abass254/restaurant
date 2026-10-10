"""Option groups whose choices are included in the dish price (free) instead of charged.

Existing groups with no priced option are marked included so their picks stay free now that
supply-linked options charge the supply's selling price.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def migrate() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("modifier_groups"):
            print("modifier_groups table missing; run the modifier groups migration first.")
            return
        if not _has_column(conn, "modifier_groups", "included"):
            conn.execute(
                text("ALTER TABLE modifier_groups ADD COLUMN included TINYINT(1) NOT NULL DEFAULT 0")
            )
            conn.execute(
                text(
                    """
                    UPDATE modifier_groups g
                    SET g.included = 1
                    WHERE NOT EXISTS (
                        SELECT 1 FROM modifier_options o
                        WHERE o.group_id = g.id AND o.price_delta > 0
                    )
                    """
                )
            )
    print("Modifier group included column is ready.")


if __name__ == "__main__":
    migrate()
