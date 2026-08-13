"""Add riders.email for OTP login and invite persistence."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("riders"):
            print("riders table missing — skip.")
            return

        columns = {col["name"] for col in insp.get_columns("riders")}
        if "email" not in columns:
            conn.execute(
                text("ALTER TABLE riders ADD COLUMN email VARCHAR(255) NULL"),
            )
            notes.append("added riders.email")

        indexes = {row["name"] for row in insp.get_indexes("riders")}
        if "riders_email_index" not in indexes:
            conn.execute(text("CREATE INDEX riders_email_index ON riders (email)"))
            notes.append("created index riders_email_index")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Rider email column already in place.")


if __name__ == "__main__":
    main()
