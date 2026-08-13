"""Create per-merchant M-PESA profile table (paybill/till settings)."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS merchant_mpesa_profiles (
                    id VARCHAR(36) PRIMARY KEY,
                    account_id VARCHAR(36) NOT NULL UNIQUE,
                    shortcode VARCHAR(20) NOT NULL,
                    shortcode_type VARCHAR(20) NOT NULL DEFAULT 'paybill',
                    updated_by_user_id VARCHAR(36) NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL
                )
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS merchant_mpesa_profiles_account_id_index
                ON merchant_mpesa_profiles (account_id)
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS merchant_mpesa_profiles_updated_by_user_id_index
                ON merchant_mpesa_profiles (updated_by_user_id)
                """,
            ),
        )

    print("merchant_mpesa_profiles table is ready.")


if __name__ == "__main__":
    main()
