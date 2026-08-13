"""Instagram Beta messaging columns."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        if inspect(conn).has_table("instagram_conversations"):
            if not _has_column(conn, "instagram_conversations", "participant_instagram_pk"):
                conn.execute(
                    text(
                        "ALTER TABLE instagram_conversations "
                        "ADD COLUMN participant_instagram_pk VARCHAR(64) NULL",
                    ),
                )
                notes.append("added column instagram_conversations.participant_instagram_pk")

        if inspect(conn).has_table("instagram_messages"):
            if not _has_column(conn, "instagram_messages", "delivery_status"):
                conn.execute(
                    text(
                        "ALTER TABLE instagram_messages "
                        "ADD COLUMN delivery_status VARCHAR(16) NULL",
                    ),
                )
                notes.append("added column instagram_messages.delivery_status")
            if not _has_column(conn, "instagram_messages", "delivery_error"):
                conn.execute(
                    text(
                        "ALTER TABLE instagram_messages "
                        "ADD COLUMN delivery_error TEXT NULL",
                    ),
                )
                notes.append("added column instagram_messages.delivery_error")
            if not _has_column(conn, "instagram_messages", "outbound_transport"):
                conn.execute(
                    text(
                        "ALTER TABLE instagram_messages "
                        "ADD COLUMN outbound_transport VARCHAR(16) NULL",
                    ),
                )
                notes.append("added column instagram_messages.outbound_transport")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — Instagram Beta columns already present.")


if __name__ == "__main__":
    main()
