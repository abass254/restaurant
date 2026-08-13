"""Add delivery fee per km to Google Maps platform config."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    with engine.begin() as conn:
        if not _has_column(conn, "google_maps_configurations", "delivery_fee_per_km"):
            conn.execute(
                text(
                    """
                    ALTER TABLE google_maps_configurations
                    ADD COLUMN delivery_fee_per_km DECIMAL(12, 2) NULL
                    """,
                ),
            )

    print("delivery_fee_per_km column is ready.")


if __name__ == "__main__":
    main()
