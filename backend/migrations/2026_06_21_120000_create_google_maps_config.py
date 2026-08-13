"""Create platform Google Maps config table."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.database import engine  # noqa: E402


def main() -> None:
    settings = get_settings()
    env_key = settings.google_maps_api_key.strip()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS google_maps_configurations (
                    id VARCHAR(36) PRIMARY KEY,
                    api_key TEXT NOT NULL,
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

        has_active = conn.execute(
            text(
                "SELECT COUNT(*) FROM google_maps_configurations WHERE is_active = 1",
            ),
        ).scalar()

        if not has_active and env_key:
            conn.execute(
                text(
                    """
                    INSERT INTO google_maps_configurations (
                        id, api_key, default_center_lat, default_center_lng,
                        default_zoom, default_country, is_active, created_at, updated_at
                    ) VALUES (
                        :id, :api_key, -1.2921, 36.8219, 11, 'ke', 1, :now, :now
                    )
                    """,
                ),
                {"id": str(uuid.uuid4()), "api_key": env_key, "now": now},
            )

    print("google_maps_configurations table is ready.")


if __name__ == "__main__":
    main()
