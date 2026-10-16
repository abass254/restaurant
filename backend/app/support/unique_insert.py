"""Insert a row whose human reference (order number, PO reference) must be unique."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


def insert_unique(
    db: Session,
    row: Any,
    renumber: Callable[[], None],
    *,
    attempts: int = 5,
) -> None:
    """Add and flush ``row``; when a concurrent insert took its reference, ``renumber`` and retry.

    Each try runs in a SAVEPOINT so a clash only undoes this insert. pysqlite
    commits a SAVEPOINT that opens the transaction, so SQLite (single writer)
    inserts directly.
    """
    db.flush()
    if db.get_bind().dialect.name == "sqlite":
        db.add(row)
        db.flush()
        return
    for attempt in range(attempts):
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
            return
        except IntegrityError:
            if attempt == attempts - 1:
                raise
            renumber()
