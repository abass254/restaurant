"""Add assignee_id to qa_issues."""

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
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("qa_issues"):
            print("qa_issues missing — run earlier migration first")
            return
        if _has_column(conn, "qa_issues", "assignee_id"):
            print("qa_issues.assignee_id already exists")
            return
        conn.execute(
            text(
                "ALTER TABLE qa_issues "
                "ADD COLUMN assignee_id VARCHAR(36) NULL AFTER reporter_id",
            ),
        )
        conn.execute(
            text(
                "ALTER TABLE qa_issues "
                "ADD CONSTRAINT qa_issues_assignee_id_fk "
                "FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL",
            ),
        )
        print("added qa_issues.assignee_id")


if __name__ == "__main__":
    main()
