from __future__ import annotations

from unittest.mock import MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import selectinload, sessionmaker

from app.database import Base
from app.models import User
from app.schemas import build_user_out


def test_build_user_out_uses_eagerly_loaded_instagram_relationship() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(
        User(
            id="user-1",
            name="Amina",
            email="shop@example.com",
            is_activated=True,
            require_change_password=False,
        )
    )
    db.commit()
    user = (
        db.query(User)
        .options(
            selectinload(User.account),
            selectinload(User.instagram_account),
            selectinload(User.memberships),
        )
        .filter(User.id == "user-1")
        .one()
    )
    db.execute = MagicMock(side_effect=AssertionError("unexpected query"))  # type: ignore[method-assign]

    result = build_user_out(db, user)

    assert result.id == "user-1"
    assert result.instagram_account is None
    db.close()
