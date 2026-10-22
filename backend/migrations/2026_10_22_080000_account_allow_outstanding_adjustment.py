import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("accounts"):
            print("accounts table missing; run earlier migrations first.")
            return
        columns = {column["name"] for column in inspect(conn).get_columns("accounts")}
        if "allow_outstanding_adjustment" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE accounts "
                    "ADD COLUMN allow_outstanding_adjustment BOOLEAN NOT NULL DEFAULT FALSE"
                )
            )
    print("Account allow_outstanding_adjustment column is ready.")


if __name__ == "__main__":
    migrate()
