import os
from pathlib import Path


def test_uploads_dir_defaults_under_backend(monkeypatch) -> None:
    monkeypatch.delenv("UPLOADS_DIR", raising=False)
    import importlib

    import app.core.uploads as uploads

    importlib.reload(uploads)
    assert uploads.UPLOADS_DIR == Path(uploads.__file__).resolve().parents[2] / "uploads"


def test_uploads_dir_respects_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path))
    import importlib

    import app.core.uploads as uploads

    importlib.reload(uploads)
    assert uploads.UPLOADS_DIR == tmp_path.resolve()
    monkeypatch.delenv("UPLOADS_DIR", raising=False)
    importlib.reload(uploads)
