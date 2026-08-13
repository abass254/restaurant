"""Allow multiple inventory items per social post link."""

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
        if not _has_table(conn, "social_post_links"):
            print("social_post_links table missing — run 2026_06_21_140000_social_post_links.py first.")
            return

        inspector = inspect(conn)
        uniques = {
            tuple(row.get("column_names") or row.get("name") or ())
            for row in inspector.get_unique_constraints("social_post_links")
        }
        target = ("account_id", "platform", "external_post_id", "inventory_item_id")
        if target in uniques:
            print("social_post_links already supports multiple products per post.")
            return

        conn.execute(
            text(
                """
                CREATE TABLE social_post_links_next (
                    id VARCHAR(36) PRIMARY KEY,
                    account_id VARCHAR(36) NOT NULL,
                    platform VARCHAR(32) NOT NULL,
                    external_post_id VARCHAR(255) NOT NULL,
                    inventory_item_id VARCHAR(36) NOT NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    UNIQUE (account_id, platform, external_post_id, inventory_item_id),
                    FOREIGN KEY (account_id) REFERENCES accounts(id),
                    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
                )
                """
            ),
        )
        conn.execute(
            text(
                """
                INSERT INTO social_post_links_next (
                    id, account_id, platform, external_post_id,
                    inventory_item_id, created_at, updated_at
                )
                SELECT
                    id, account_id, platform, external_post_id,
                    inventory_item_id, created_at, updated_at
                FROM social_post_links
                """
            ),
        )
        conn.execute(text("DROP TABLE social_post_links"))
        conn.execute(text("ALTER TABLE social_post_links_next RENAME TO social_post_links"))
        conn.execute(
            text(
                """
                CREATE INDEX ix_social_post_links_inventory_item_id
                ON social_post_links (inventory_item_id)
                """
            ),
        )

    print("social_post_links now supports multiple inventory items per post.")


if __name__ == "__main__":
    main()
