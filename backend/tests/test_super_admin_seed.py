"""Default super-admin seed must not reset an existing password."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.support.super_admin_seed import (
    SUPER_ADMIN_USERNAME,
    allow_default_super_admin_seed,
    seed_super_admin,
)


def test_allow_default_seed_in_debug() -> None:
    settings = MagicMock()
    settings.app_debug = True
    settings.app_env = "production"
    assert allow_default_super_admin_seed(settings) is True


def test_disallow_default_seed_in_production() -> None:
    settings = MagicMock()
    settings.app_debug = False
    settings.app_env = "production"
    assert allow_default_super_admin_seed(settings) is False


def test_existing_user_password_not_reset() -> None:
    user = MagicMock()
    user.password = "already-hashed"
    user.username = SUPER_ADMIN_USERNAME
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    status = seed_super_admin(db, allow_default_seed=True)
    assert status == "already present"
    assert user.password == "already-hashed"
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_missing_user_skipped_when_seed_disallowed() -> None:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    status = seed_super_admin(db, allow_default_seed=False)
    assert status == "skipped"
    db.add.assert_not_called()
