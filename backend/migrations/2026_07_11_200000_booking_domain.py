"""Create salon/booking tables: settings, providers, hours, bookings."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        tables = set(inspect(conn).get_table_names())

        if "booking_settings" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE booking_settings (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        booking_slug VARCHAR(80) NULL,
                        header_text VARCHAR(255) NULL,
                        brand_color VARCHAR(16) NULL,
                        deposit_type VARCHAR(20) NOT NULL DEFAULT 'none',
                        deposit_amount DECIMAL(12, 2) NULL,
                        deposit_percent DECIMAL(5, 2) NULL,
                        min_notice_minutes INTEGER NOT NULL DEFAULT 60,
                        timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
                        go_live BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        UNIQUE (account_id),
                        UNIQUE (booking_slug),
                        FOREIGN KEY (account_id) REFERENCES accounts(id)
                    )
                    """
                ),
            )
            notes.append("created booking_settings")

        if "booking_providers" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE booking_providers (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        display_name VARCHAR(255) NOT NULL,
                        role VARCHAR(120) NULL,
                        bio TEXT NULL,
                        photo_url VARCHAR(1024) NULL,
                        is_active BOOLEAN NOT NULL DEFAULT 1,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        FOREIGN KEY (account_id) REFERENCES accounts(id)
                    )
                    """
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX booking_providers_account_active
                    ON booking_providers (account_id, is_active)
                    """
                ),
            )
            notes.append("created booking_providers")

        if "booking_provider_services" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE booking_provider_services (
                        id VARCHAR(36) PRIMARY KEY,
                        provider_id VARCHAR(36) NOT NULL,
                        inventory_item_id VARCHAR(36) NOT NULL,
                        created_at DATETIME NULL,
                        UNIQUE (provider_id, inventory_item_id),
                        FOREIGN KEY (provider_id) REFERENCES booking_providers(id),
                        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
                    )
                    """
                ),
            )
            notes.append("created booking_provider_services")

        if "booking_weekly_hours" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE booking_weekly_hours (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        provider_id VARCHAR(36) NULL,
                        weekday INTEGER NOT NULL,
                        open_time VARCHAR(5) NOT NULL DEFAULT '09:00',
                        close_time VARCHAR(5) NOT NULL DEFAULT '17:00',
                        is_closed BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        FOREIGN KEY (account_id) REFERENCES accounts(id),
                        FOREIGN KEY (provider_id) REFERENCES booking_providers(id)
                    )
                    """
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX booking_weekly_hours_scope
                    ON booking_weekly_hours (account_id, provider_id, weekday)
                    """
                ),
            )
            notes.append("created booking_weekly_hours")

        if "bookings" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE bookings (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        provider_id VARCHAR(36) NULL,
                        inventory_item_id VARCHAR(36) NOT NULL,
                        starts_at DATETIME NOT NULL,
                        ends_at DATETIME NOT NULL,
                        customer_name VARCHAR(255) NOT NULL,
                        customer_phone VARCHAR(32) NOT NULL,
                        status VARCHAR(32) NOT NULL DEFAULT 'confirmed',
                        deposit_amount DECIMAL(12, 2) NULL,
                        deposit_mpesa_txn_id VARCHAR(64) NULL,
                        public_token VARCHAR(36) NOT NULL,
                        notes TEXT NULL,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        UNIQUE (public_token),
                        FOREIGN KEY (account_id) REFERENCES accounts(id),
                        FOREIGN KEY (provider_id) REFERENCES booking_providers(id),
                        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
                    )
                    """
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX bookings_account_starts
                    ON bookings (account_id, starts_at)
                    """
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX bookings_provider_starts
                    ON bookings (provider_id, starts_at)
                    """
                ),
            )
            notes.append("created bookings")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Booking schema already in place.")


if __name__ == "__main__":
    main()
