"""Create instagram_beta_events audit table."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        if "instagram_beta_events" not in inspect(conn).get_table_names():
            conn.execute(
                text(
                    """
                    CREATE TABLE instagram_beta_events (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        instagram_account_id VARCHAR(36) NULL,
                        instagram_beta_account_id VARCHAR(36) NULL,
                        event_type VARCHAR(64) NOT NULL,
                        status VARCHAR(32) NOT NULL,
                        instagram_username VARCHAR(255) NULL,
                        message VARCHAR(500) NULL,
                        metadata_json JSON NULL,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        FOREIGN KEY (account_id) REFERENCES accounts(id),
                        FOREIGN KEY (instagram_account_id) REFERENCES instagram_accounts(id),
                        FOREIGN KEY (instagram_beta_account_id) REFERENCES instagram_accounts(id)
                    )
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_instagram_beta_events_account_created
                    ON instagram_beta_events (account_id, created_at)
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_instagram_beta_events_type_status
                    ON instagram_beta_events (event_type, status)
                    """,
                ),
            )
            print("instagram_beta_events table created.")
        else:
            print("Nothing to do — instagram_beta_events already exists.")


if __name__ == "__main__":
    main()
