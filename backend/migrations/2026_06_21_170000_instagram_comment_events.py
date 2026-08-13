"""Create instagram_comment_events for AI comment reply tracking."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_table(conn, table: str) -> bool:
    return table in inspect(conn).get_table_names()


def main() -> None:
    with engine.begin() as conn:
        if not _has_table(conn, "instagram_comment_events"):
            conn.execute(
                text(
                    """
                    CREATE TABLE instagram_comment_events (
                        id VARCHAR(36) PRIMARY KEY,
                        instagram_account_id VARCHAR(36) NOT NULL,
                        external_comment_id VARCHAR(255) NOT NULL UNIQUE,
                        external_post_id VARCHAR(255) NOT NULL,
                        parent_comment_id VARCHAR(255) NULL,
                        commenter_ig_id VARCHAR(255) NULL,
                        commenter_username VARCHAR(255) NULL,
                        body TEXT NULL,
                        reply_comment_id VARCHAR(255) NULL,
                        reply_body TEXT NULL,
                        auto_replied BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        FOREIGN KEY (instagram_account_id) REFERENCES instagram_accounts(id)
                    )
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_instagram_comment_events_post
                    ON instagram_comment_events (external_post_id)
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_instagram_comment_events_account
                    ON instagram_comment_events (instagram_account_id)
                    """,
                ),
            )

    print("instagram_comment_events table is ready.")


if __name__ == "__main__":
    main()
