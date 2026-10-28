"""Modifier options can use a store item, a menu item or a Kitchen extra for stock."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def migrate() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("modifier_options"):
            print("modifier_options table missing; skip modifier sources.")
            return
        columns = {column["name"] for column in inspector.get_columns("modifier_options")}
        mysql = conn.dialect.name == "mysql"
        if "source_kind" not in columns:
            conn.execute(text("ALTER TABLE modifier_options ADD COLUMN source_kind VARCHAR(16) NULL"))
            notes.append("source_kind")
        if "source_product_id" not in columns:
            conn.execute(text("ALTER TABLE modifier_options ADD COLUMN source_product_id VARCHAR(36) NULL"))
            if mysql:
                conn.execute(
                    text(
                        "ALTER TABLE modifier_options ADD CONSTRAINT fk_modifier_options_source_product "
                        "FOREIGN KEY (source_product_id) REFERENCES catalogue(id) ON DELETE SET NULL"
                    )
                )
            notes.append("source_product_id")
        if "source_option_id" not in columns:
            conn.execute(text("ALTER TABLE modifier_options ADD COLUMN source_option_id VARCHAR(36) NULL"))
            if mysql:
                conn.execute(
                    text(
                        "ALTER TABLE modifier_options ADD CONSTRAINT fk_modifier_options_source_option "
                        "FOREIGN KEY (source_option_id) REFERENCES modifier_options(id) ON DELETE SET NULL"
                    )
                )
            notes.append("source_option_id")
    print(f"Added modifier_options columns: {', '.join(notes)}." if notes else "Modifier sources already in place.")


if __name__ == "__main__":
    migrate()
