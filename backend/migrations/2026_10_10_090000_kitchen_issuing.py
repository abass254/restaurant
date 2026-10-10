"""Restaurant store-to-kitchen issuing: kitchen stock, issue requisitions, ledger locations.

Additive only: new tables and columns with defaults. Existing ledger rows become
``location = 'store'``, which is what they always were.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

KITCHEN_ISSUES_SQL = """
CREATE TABLE kitchen_issues (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'requested',
    issue_date DATE NULL,
    notes TEXT NULL,
    requested_by VARCHAR(36) NULL,
    issued_by VARCHAR(36) NULL,
    issued_at DATETIME NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id),
    FOREIGN KEY (issued_by) REFERENCES users(id)
)
"""

KITCHEN_ISSUE_LINES_SQL = """
CREATE TABLE kitchen_issue_lines (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    kitchen_issue_id VARCHAR(36) NOT NULL,
    inventory_item_id VARCHAR(36) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    requested_qty DECIMAL(12, 3) NULL,
    issued_qty DECIMAL(12, 3) NULL,
    unit_cost DECIMAL(12, 2) NULL,
    FOREIGN KEY (kitchen_issue_id) REFERENCES kitchen_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
    CONSTRAINT uq_kitchen_issue_lines_item UNIQUE (kitchen_issue_id, inventory_item_id)
)
"""

# (table, column, DDL type, foreign key target or None)
NEW_COLUMNS: list[tuple[str, str, str, str | None]] = [
    ("accounts", "kitchen_issuing_enabled", "BOOLEAN NOT NULL DEFAULT 0", None),
    ("inventory_items", "kitchen_quantity", "DECIMAL(12, 3) NULL", None),
    ("stock_movements", "location", "VARCHAR(16) NOT NULL DEFAULT 'store'", None),
    ("stock_movements", "kitchen_issue_id", "VARCHAR(36) NULL", "kitchen_issues(id)"),
    ("stock_takes", "location", "VARCHAR(16) NOT NULL DEFAULT 'store'", None),
]

NEW_INDEXES: list[tuple[str, str, str]] = [
    ("kitchen_issues", "ix_kitchen_issues_account_date", "account_id, issue_date"),
    ("stock_movements", "ix_stock_movements_kitchen_issue", "kitchen_issue_id"),
]


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _create_table(conn, name: str, sql: str, notes: list[str]) -> None:
    if inspect(conn).has_table(name):
        return
    suffix = (
        " DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        if conn.dialect.name == "mysql"
        else ""
    )
    conn.execute(text(sql.rstrip() + suffix))
    notes.append(f"created table {name}")


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        _create_table(conn, "kitchen_issues", KITCHEN_ISSUES_SQL, notes)
        _create_table(conn, "kitchen_issue_lines", KITCHEN_ISSUE_LINES_SQL, notes)

        for table, column, ddl, fk_target in NEW_COLUMNS:
            if _has_column(conn, table, column):
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            notes.append(f"added {table}.{column}")
            if fk_target and conn.dialect.name == "mysql":
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_{column} "
                        f"FOREIGN KEY ({column}) REFERENCES {fk_target} ON DELETE SET NULL"
                    )
                )

        for table, index, columns in NEW_INDEXES:
            existing = {row["name"] for row in inspect(conn).get_indexes(table)}
            if index in existing:
                continue
            conn.execute(text(f"CREATE INDEX {index} ON {table} ({columns})"))
            notes.append(f"created index {index}")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Kitchen issuing schema already in place.")


if __name__ == "__main__":
    main()
