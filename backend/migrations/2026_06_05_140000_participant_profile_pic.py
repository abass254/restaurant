"""Add participant_profile_pic_url to conversations."""

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
        if not _has_column(conn, "instagram_conversations", "participant_profile_pic_url"):
            conn.execute(
                text(
                    """
                    ALTER TABLE instagram_conversations
                    ADD COLUMN participant_profile_pic_url TEXT NULL
                    """,
                ),
            )

    print("participant_profile_pic_url column is ready.")


if __name__ == "__main__":
    main()
