"""Add a JSON `images` column to products for the gallery of uploaded photos.

Each entry in the list is a small dict:

    {
        "url":           "/uploads/products/3/abc123.jpg",  // path served by /uploads/*
        "original_name": "salon-shot.jpg",
        "size":          129843,                             // bytes
        "uploaded_at":   "2026-05-25T15:30:00Z",
        "uploaded_by":   12                                  // users.id
    }

The existing `image_url` column stays — it now points at the *cover* photo
(typically the first uploaded image, or any external URL the user set).

Idempotent — safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        cols = {row["name"] for row in inspect(conn).get_columns("products")}
        if "images" not in cols:
            conn.execute(text("ALTER TABLE products ADD COLUMN images TEXT"))
            notes.append("added products.images")
    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — products.images already exists.")


if __name__ == "__main__":
    main()
