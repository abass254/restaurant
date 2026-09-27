from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.database import get_db


def test_get_db_rolls_back_and_closes_after_request_error() -> None:
    db = MagicMock()
    with patch("app.database.SessionLocal", return_value=db):
        dependency = get_db()
        assert next(dependency) is db
        with pytest.raises(RuntimeError, match="request failed"):
            dependency.throw(RuntimeError("request failed"))

    db.rollback.assert_called_once_with()
    db.close.assert_called_once_with()
