"""Create per-merchant KRA ETR/TIMS profile table."""

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
                CREATE TABLE IF NOT EXISTS merchant_kra_profiles (
                    id VARCHAR(36) PRIMARY KEY,
                    account_id VARCHAR(36) NOT NULL UNIQUE,
                    enabled BOOLEAN NOT NULL DEFAULT 0,
                    kra_pin VARCHAR(20) NULL,
                    integration_type VARCHAR(20) NOT NULL DEFAULT 'vscu',
                    control_unit_serial VARCHAR(50) NULL,
                    branch_id VARCHAR(50) NULL,
                    vat_registered BOOLEAN NOT NULL DEFAULT 1,
                    middleware_provider VARCHAR(100) NULL,
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
                CREATE INDEX IF NOT EXISTS merchant_kra_profiles_account_id_index
                ON merchant_kra_profiles (account_id)
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS merchant_kra_profiles_updated_by_user_id_index
                ON merchant_kra_profiles (updated_by_user_id)
                """,
            ),
        )

    print("merchant_kra_profiles table is ready.")


if __name__ == "__main__":
    main()
