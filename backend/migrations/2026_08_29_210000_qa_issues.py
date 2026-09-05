"""Create ``qa_issues`` for internal QA tracking."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

SQL = """
CREATE TABLE qa_issues (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    issue_number INT NOT NULL,
    account_id VARCHAR(36) NULL,
    reporter_id VARCHAR(36) NOT NULL,
    summary VARCHAR(255) NOT NULL,
    description TEXT NULL,
    issue_type VARCHAR(32) NOT NULL DEFAULT 'bug',
    priority VARCHAR(16) NOT NULL DEFAULT 'medium',
    component VARCHAR(64) NOT NULL DEFAULT 'general',
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    page_url VARCHAR(500) NULL,
    steps_to_reproduce TEXT NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("qa_issues"):
            indexes = insp.get_indexes("qa_issues")
            if not any(idx.get("name") == "qa_issues_issue_number_index" for idx in indexes):
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX qa_issues_issue_number_index "
                        "ON qa_issues (issue_number)",
                    ),
                )
            print("qa_issues already exists")
            return
        if not insp.has_table("users"):
            print("users table missing — run earlier migrations first")
            return
        conn.execute(text(SQL))
        if not any(
            idx.get("name") == "qa_issues_issue_number_index"
            for idx in insp.get_indexes("qa_issues")
        ):
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX qa_issues_issue_number_index "
                    "ON qa_issues (issue_number)",
                ),
            )
        print("created qa_issues")


if __name__ == "__main__":
    main()
