"""Move product media to per-shop inventory rows and add platform primary locking.

Changes:
  inventory_items:
    + media  TEXT/JSON  (store-specific photos and videos)
  products:
    + primary_image_locked  BOOLEAN  (admin-picked platform primary)
    ~ images  migrated into inventory_items.media, then cleared

Idempotent — safe to re-run.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.product_media_service import coerce_media  # noqa: E402


def _columns(conn, table: str) -> set[str]:
    return {row["name"] for row in inspect(conn).get_columns(table)}


def _table_exists(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def _parse_json(value) -> list[dict]:
    if value is None:
        return []
    if isinstance(value, list):
        return coerce_media(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return coerce_media(parsed)
    return []


def upgrade_inventory_items(conn) -> list[str]:
    notes: list[str] = []
    if not _table_exists(conn, "inventory_items"):
        return notes
    cols = _columns(conn, "inventory_items")
    if "media" not in cols:
        conn.execute(text("ALTER TABLE inventory_items ADD COLUMN media TEXT"))
        notes.append("added inventory_items.media")
    return notes


def upgrade_products(conn) -> list[str]:
    notes: list[str] = []
    if not _table_exists(conn, "products"):
        return notes
    cols = _columns(conn, "products")
    if "primary_image_locked" not in cols:
        conn.execute(
            text(
                "ALTER TABLE products ADD COLUMN primary_image_locked "
                "BOOLEAN NOT NULL DEFAULT 0",
            ),
        )
        notes.append("added products.primary_image_locked")
    return notes


def migrate_legacy_product_images(conn) -> list[str]:
    """Copy ``products.images`` into each shop's inventory row, then clear."""
    notes: list[str] = []
    if not _table_exists(conn, "products") or not _table_exists(conn, "inventory_items"):
        return notes

    product_cols = _columns(conn, "products")
    if "images" not in product_cols:
        return notes

    rows = conn.execute(
        text("SELECT id, images, created_by_account_id FROM products"),
    ).fetchall()
    migrated_products = 0

    for product_id, raw_images, created_by_account_id in rows:
        legacy = _parse_json(raw_images)
        if not legacy:
            continue

        inv_rows = conn.execute(
            text(
                "SELECT id, account_id, media FROM inventory_items "
                "WHERE product_id = :pid",
            ),
            {"pid": product_id},
        ).fetchall()
        if not inv_rows:
            continue

        # Prefer the creating shop's inventory row; otherwise fan out to all.
        targets = [
            row
            for row in inv_rows
            if created_by_account_id and row[1] == created_by_account_id
        ] or list(inv_rows)

        for inv_id, _account_id, raw_media in targets:
            existing = _parse_json(raw_media)
            existing_urls = {m["url"] for m in existing}
            merged = list(existing)
            for record in legacy:
                if record["url"] not in existing_urls:
                    existing_urls.add(record["url"])
                    merged.append(record)
            conn.execute(
                text("UPDATE inventory_items SET media = :media WHERE id = :id"),
                {"media": json.dumps(merged), "id": inv_id},
            )

        conn.execute(
            text("UPDATE products SET images = NULL WHERE id = :id"),
            {"id": product_id},
        )
        migrated_products += 1

    if migrated_products:
        notes.append(
            f"migrated legacy products.images for {migrated_products} product(s)",
        )
    return notes


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        notes.extend(upgrade_inventory_items(conn))
        notes.extend(upgrade_products(conn))
        notes.extend(migrate_legacy_product_images(conn))

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — store product media schema is already up to date.")


if __name__ == "__main__":
    main()
