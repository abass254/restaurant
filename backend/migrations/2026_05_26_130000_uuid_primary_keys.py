"""Convert every primary key (and every foreign-key column) to UUIDv4 strings.

This is a **destructive** schema rebuild:

1. SQLite can't ALTER a primary-key column's type in place, and walking
   every FK column over a SQL-only rebuild would be huge.
2. The integer ids in the existing rows are not meaningful outside this
   database (no external system references them), so re-keying them
   instead of preserving them is a non-issue.
3. The SQLAlchemy models in ``app.models`` are now the source of truth
   for the schema (every PK is ``String(36)`` with a ``uuid.uuid4``
   default, every FK references a ``String(36)``).

What this script does:

* Backs up the existing SQLite file to ``database/database.sqlite.bak_<ts>``.
* Drops every table the SQLAlchemy ``Base.metadata`` knows about
  (15 tables — see ``app.models``). Any Laravel-era tables that aren't
  part of the SQLAlchemy metadata (e.g. ``migrations``,
  ``password_reset_tokens``, ``cache``, ``jobs``) are left untouched.
* Re-creates all of them via ``Base.metadata.create_all`` so the schema
  matches the models exactly.

After running, the app has an empty schema. You'll need to sign up
again from the UI (or seed accounts/users separately).

Safe to re-run: subsequent runs simply re-drop + re-create the empty
tables.
"""

from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.database import Base, engine  # noqa: E402

# Importing the models module is what populates ``Base.metadata`` with
# every ORM table — without this the metadata is empty and ``drop_all``
# / ``create_all`` are no-ops.
import app.models  # noqa: F401, E402


def _backup_sqlite() -> Path | None:
    """If the active engine is SQLite, copy the .sqlite file aside.

    Returns the backup path so the caller can mention it, or ``None``
    for non-SQLite engines (where we leave the DBA to handle backups).
    """
    settings = get_settings()
    url = settings.database_url
    if not url.startswith("sqlite:"):
        return None
    db_path_str = url.split("sqlite:///", 1)[-1]
    db_path = Path(db_path_str)
    if not db_path.exists():
        return None
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_suffix(db_path.suffix + f".bak_{ts}")
    shutil.copy2(db_path, backup)
    return backup


def main() -> None:
    backup = _backup_sqlite()
    if backup is not None:
        print(f"Backed up existing database to: {backup}")
    else:
        print("Non-SQLite engine — skipping local backup step.")

    table_names = list(Base.metadata.tables.keys())
    print(f"Rebuilding {len(table_names)} tables: {', '.join(sorted(table_names))}")

    # ``drop_all`` walks the dependency graph in the right order so
    # FK-bearing tables are dropped before the tables they reference.
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    print("All tables dropped + recreated with UUIDv4 primary keys.")
    print("Schema is empty — sign up a new account from the UI to get started.")


if __name__ == "__main__":
    main()
