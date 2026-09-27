import sqlite3
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

_engine_kwargs: dict = {
    "pool_pre_ping": True,
    "pool_recycle": 280,
}
if not settings.database_url.startswith("sqlite"):
    _engine_kwargs["pool_size"] = max(1, settings.db_pool_size)
    _engine_kwargs["max_overflow"] = max(0, settings.db_max_overflow)
    _engine_kwargs["pool_timeout"] = max(1, settings.db_pool_timeout_seconds)
    _engine_kwargs["connect_args"] = {
        "connect_timeout": max(1, settings.db_connect_timeout_seconds),
        "read_timeout": max(1, settings.db_read_timeout_seconds),
        "write_timeout": max(1, settings.db_write_timeout_seconds),
    }
if settings.database_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {
        "check_same_thread": False,
        "timeout": 30,
    }

engine = create_engine(settings.database_url, **_engine_kwargs)


@event.listens_for(Engine, "connect")
def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
