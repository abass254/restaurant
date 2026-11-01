"""Local-disk storage for uploaded product photos.

Files are written under `UPLOADS_DIR` (default `backend/uploads/`, or
`/app/uploads` in Docker) as `products/<product_id>/<sha1>.<ext>` and served
by the `/uploads/*` static mount in `app.main`. The URLs we store in the DB
are *relative* (e.g. `/uploads/products/3/abc.jpg`) so the public host comes
from `APP_URL` / `FRONTEND_URL` (prod: `https://merchants.transchap.app/uploads/...`).

Override the on-disk root with `UPLOADS_DIR` (bare metal) or bind-mount the
host folder onto `/app/uploads` via Compose `UPLOADS_HOST_PATH`.

Why local disk for now?
- Zero external infra; runs the same on every dev laptop.
- Easy to swap for S3/Cloudinary later — replace `save_upload` and `delete_upload`
  and nothing else changes.
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status

_DEFAULT_UPLOADS_DIR = Path(__file__).resolve().parents[2] / "uploads"


def _resolve_uploads_dir() -> Path:
    raw = (os.environ.get("UPLOADS_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return _DEFAULT_UPLOADS_DIR


# Default: `backend/uploads/` (repo) or `/app/uploads` (Docker image layout).
UPLOADS_DIR = _resolve_uploads_dir()

# Per-file limit, by media kind. Videos can be considerably larger than
# photos so we treat them separately. Both still fit comfortably in memory on
# the dev server.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 50 * 1024 * 1024

# Legacy name — some callers still import this. Use the larger of the two so
# nothing accidentally rejects videos.
MAX_FILE_BYTES = MAX_VIDEO_BYTES

# We accept these mime types and map them to a deterministic file extension.
ALLOWED_TYPES: dict[str, str] = {
    # Images
    "image/jpeg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    # Videos
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


def _max_bytes_for(content_type: str) -> int:
    return MAX_VIDEO_BYTES if content_type.startswith("video/") else MAX_IMAGE_BYTES


def _human_mb(num_bytes: int) -> int:
    return num_bytes // (1024 * 1024)


def _product_dir(product_id: str) -> Path:
    return UPLOADS_DIR / "products" / str(product_id)


def _url_for(product_id: str, filename: str) -> str:
    return f"/uploads/products/{product_id}/{filename}"


def _feed_dir(account_id: str) -> Path:
    return UPLOADS_DIR / "feed" / str(account_id)


def _feed_url_for(account_id: str, filename: str) -> str:
    return f"/uploads/feed/{account_id}/{filename}"


def _logo_dir(account_id: str) -> Path:
    return UPLOADS_DIR / "logos" / str(account_id)


def _logo_url_for(account_id: str, filename: str) -> str:
    return f"/uploads/logos/{account_id}/{filename}"


IMAGE_ONLY_TYPES: dict[str, str] = {
    key: value for key, value in ALLOWED_TYPES.items() if key.startswith("image/")
}

# Instagram Content Publishing API — JPEG photos and MP4/MOV video.
FEED_ALLOWED_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/pjpeg": ".jpg",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
}


async def save_upload(
    product_id: str,
    file: UploadFile,
    uploader_id: str | None,
) -> dict[str, Any]:
    """Persist `file` under the product's directory.

    Returns the small JSON dict we append to inventory ``media``.
    Raises HTTPException(415/413) if the file type or size is rejected.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported file type '{file.content_type}'. "
                "Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM."
            ),
        )

    body = await file.read()
    if not body:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Upload was empty.",
        )
    cap = _max_bytes_for(file.content_type)
    if len(body) > cap:
        kind = "Video" if file.content_type.startswith("video/") else "Image"
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{kind} is larger than {_human_mb(cap)} MB.",
        )

    digest = hashlib.sha1(body).hexdigest()
    ext = ALLOWED_TYPES[file.content_type]
    filename = f"{digest}{ext}"

    target_dir = _product_dir(product_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    # SHA-based filenames give us free dedupe — if we've already saved an
    # identical file, just overwrite (cheaper than checking-and-skipping).
    target_path.write_bytes(body)

    return {
        "url": _url_for(product_id, filename),
        "original_name": (file.filename or filename)[:255],
        "content_type": file.content_type,
        "size": len(body),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": uploader_id,
    }


async def save_feed_upload(
    account_id: str,
    file: UploadFile,
    uploader_id: str | None,
) -> dict[str, Any]:
    """Persist a feed post photo or video under the merchant's feed directory."""
    if file.content_type not in FEED_ALLOWED_TYPES:
        allowed = "JPEG, MP4, or MOV"
        hint = ""
        if file.content_type in {"image/heic", "image/heif", "image/png", "image/webp"}:
            hint = " Save the photo as JPEG first, or pick one from your camera roll that is not HEIC/PNG."
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported file type '{file.content_type}'. "
                f"Allowed: {allowed}.{hint}"
            ),
        )

    body = await file.read()
    if not body:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Upload was empty.",
        )
    cap = _max_bytes_for(file.content_type)
    if len(body) > cap:
        kind = "Video" if file.content_type.startswith("video/") else "Image"
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{kind} is larger than {_human_mb(cap)} MB.",
        )

    digest = hashlib.sha1(body).hexdigest()
    ext = FEED_ALLOWED_TYPES[file.content_type]
    filename = f"{digest}{ext}"

    target_dir = _feed_dir(account_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    target_path.write_bytes(body)

    return {
        "url": _feed_url_for(account_id, filename),
        "original_name": (file.filename or filename)[:255],
        "content_type": file.content_type,
        "size": len(body),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": uploader_id,
    }


async def save_logo_upload(
    account_id: str,
    file: UploadFile,
    uploader_id: str | None,
) -> dict[str, Any]:
    """Persist a store logo image under the merchant's logos directory."""
    if file.content_type not in IMAGE_ONLY_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported file type '{file.content_type}'. "
                "Allowed: JPEG, PNG, WebP, GIF."
            ),
        )

    body = await file.read()
    if not body:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Upload was empty.",
        )
    cap = MAX_IMAGE_BYTES
    if len(body) > cap:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image is larger than {_human_mb(cap)} MB.",
        )

    digest = hashlib.sha1(body).hexdigest()
    ext = IMAGE_ONLY_TYPES[file.content_type]
    filename = f"{digest}{ext}"

    target_dir = _logo_dir(account_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    target_path.write_bytes(body)

    return {
        "url": _logo_url_for(account_id, filename),
        "original_name": (file.filename or filename)[:255],
        "content_type": file.content_type,
        "size": len(body),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": uploader_id,
    }


def save_generated_image(
    product_id: str,
    body: bytes,
    content_type: str,
    *,
    uploader_id: str | None,
    original_name: str = "ai-generated.png",
    source: str = "ai_generated",
) -> dict[str, Any]:
    """Persist raw image bytes (e.g. from the AI generator) under a product.

    Mirrors `save_upload` so the on-disk layout, URL shape, dedupe behaviour
    and inventory ``media`` record format are identical — callers never have to
    care whether the file came from a user upload or from gpt-image-1.
    """
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Generated image has an unsupported type '{content_type}'.",
        )
    if not body:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="Generated image was empty.",
        )
    cap = _max_bytes_for(content_type)
    if len(body) > cap:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Generated image is larger than {_human_mb(cap)} MB.",
        )

    digest = hashlib.sha1(body).hexdigest()
    ext = ALLOWED_TYPES[content_type]
    filename = f"{digest}{ext}"

    target_dir = _product_dir(product_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    target_path.write_bytes(body)

    return {
        "url": _url_for(product_id, filename),
        "original_name": original_name[:255],
        "content_type": content_type,
        "size": len(body),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": uploader_id,
        "source": source,
    }


def _relative_uploads_path(image_url: str) -> str | None:
    """Normalize a stored media URL to a path under /uploads/…, or None."""
    raw = (image_url or "").strip()
    if not raw:
        return None
    if raw.startswith("/uploads/"):
        return raw[len("/uploads/") :]
    # Absolute public URL (e.g. https://merchants.transchap.app/uploads/…).
    marker = "/uploads/"
    idx = raw.find(marker)
    if idx >= 0 and raw.startswith(("http://", "https://")):
        return raw[idx + len(marker) :]
    return None


def delete_upload(image_url: str) -> bool:
    """Remove a previously-uploaded file from disk. Returns True on success.

    Only deletes files inside our own uploads directory — anything else
    (external URLs, traversal attempts) is silently ignored.
    """
    rel = _relative_uploads_path(image_url)
    if rel is None:
        return False
    try:
        path = (UPLOADS_DIR / rel).resolve()
    except OSError:
        return False
    try:
        path.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        # Path escapes the uploads dir — refuse.
        return False
    if not path.exists() or not path.is_file():
        return False
    try:
        path.unlink()
    except OSError:
        return False
    return True


def receipt_pdf_relative_url(*, account_id: str, order_id: str) -> str:
    return f"/uploads/receipts/{account_id}/{order_id}.pdf"


def receipt_pdf_path(*, account_id: str, order_id: str) -> Path:
    return UPLOADS_DIR / "receipts" / str(account_id) / f"{order_id}.pdf"


def save_receipt_pdf_bytes(*, account_id: str, order_id: str, body: bytes) -> str:
    """Write a receipt PDF under uploads/receipts and return the relative URL."""
    if not body:
        raise ValueError("Receipt PDF was empty.")
    path = receipt_pdf_path(account_id=account_id, order_id=order_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return receipt_pdf_relative_url(account_id=account_id, order_id=order_id)
