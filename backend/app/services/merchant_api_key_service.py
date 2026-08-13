"""Merchant API keys — mint, verify, revoke (secrets hashed at rest)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import MerchantApiKey

KEY_PREFIX = "duk_live_"
SCOPE_ORDERS_CREATE = "orders:create"
DEFAULT_SCOPES = SCOPE_ORDERS_CREATE


class MerchantApiKeyError(ValueError):
    """Business-rule violation for API key operations."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_raw_api_key() -> str:
    """Return a high-entropy key. Shown once; only the hash is stored."""
    return f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"


def parse_scopes(scopes: str | None) -> set[str]:
    return {s.strip() for s in (scopes or "").split(",") if s.strip()}


class MerchantApiKeyService:
    def __init__(self, db: Session):
        self.db = db

    def list_keys(self, account_id: str) -> list[MerchantApiKey]:
        return (
            self.db.query(MerchantApiKey)
            .filter(MerchantApiKey.account_id == account_id)
            .order_by(MerchantApiKey.created_at.desc())
            .all()
        )

    def create_key(
        self,
        account_id: str,
        *,
        name: str,
        created_by_user_id: str | None,
        scopes: str = DEFAULT_SCOPES,
    ) -> tuple[MerchantApiKey, str]:
        clean_name = (name or "").strip()
        if not clean_name:
            raise MerchantApiKeyError("Name is required.")
        if len(clean_name) > 120:
            raise MerchantApiKeyError("Name is too long.")

        scope_set = parse_scopes(scopes) or {SCOPE_ORDERS_CREATE}
        if SCOPE_ORDERS_CREATE not in scope_set:
            # Delivery-order endpoint is the only consumer today.
            scope_set.add(SCOPE_ORDERS_CREATE)

        raw = generate_raw_api_key()
        now = _utc_now()
        row = MerchantApiKey(
            account_id=account_id,
            name=clean_name,
            key_prefix=raw[:12],
            key_hash=hash_api_key(raw),
            scopes=",".join(sorted(scope_set)),
            created_by_user_id=created_by_user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row, raw

    def revoke_key(self, account_id: str, key_id: str) -> MerchantApiKey:
        row = (
            self.db.query(MerchantApiKey)
            .filter(
                MerchantApiKey.id == key_id,
                MerchantApiKey.account_id == account_id,
            )
            .first()
        )
        if not row:
            raise MerchantApiKeyError("API key not found.")
        if row.revoked_at:
            return row
        now = _utc_now()
        row.revoked_at = now
        row.updated_at = now
        self.db.commit()
        self.db.refresh(row)
        return row

    def authenticate(
        self,
        raw_key: str,
        *,
        required_scope: str = SCOPE_ORDERS_CREATE,
    ) -> MerchantApiKey:
        token = (raw_key or "").strip()
        if not token.startswith(KEY_PREFIX) or len(token) < 20:
            raise MerchantApiKeyError("Invalid API key.")

        digest = hash_api_key(token)
        row = (
            self.db.query(MerchantApiKey)
            .filter(MerchantApiKey.key_hash == digest)
            .first()
        )
        # Constant-time-ish miss: still hash compare against dummy.
        if not row or row.revoked_at is not None:
            # Avoid leaking whether the key existed.
            hmac.compare_digest(digest, hash_api_key("duk_live_invalid"))
            raise MerchantApiKeyError("Invalid API key.")

        if required_scope not in parse_scopes(row.scopes):
            raise MerchantApiKeyError("API key is missing required scope.")

        row.last_used_at = _utc_now()
        row.updated_at = row.last_used_at
        self.db.commit()
        self.db.refresh(row)
        return row
