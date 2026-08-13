"""Create platform Mapbox config table and add lat/lng to accounts."""

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
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS mapbox_configurations (
                    id VARCHAR(36) PRIMARY KEY,
                    access_token TEXT NOT NULL,
                    map_style VARCHAR(255) NOT NULL
                        DEFAULT 'mapbox://styles/mapbox/streets-v12',
                    default_center_lat FLOAT NULL,
                    default_center_lng FLOAT NULL,
                    default_zoom FLOAT NULL,
                    default_country VARCHAR(10) NULL,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL
                )
                """,
            ),
        )

        if not _has_column(conn, "accounts", "latitude"):
            conn.execute(text("ALTER TABLE accounts ADD COLUMN latitude FLOAT NULL"))
        if not _has_column(conn, "accounts", "longitude"):
            conn.execute(text("ALTER TABLE accounts ADD COLUMN longitude FLOAT NULL"))

    print("mapbox_configurations table and account coordinates are ready.")


if __name__ == "__main__":
    main()
