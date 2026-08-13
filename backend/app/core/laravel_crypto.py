from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

from app.config import get_settings


def _app_key_bytes() -> bytes | None:
    key = get_settings().app_key.strip()
    if not key:
        return None
    if key.startswith("base64:"):
        key = key[7:]
    return base64.b64decode(key)


def maybe_decrypt(value: str | None) -> str | None:
    """Decrypt Laravel-encrypted strings when APP_KEY is configured."""
    if not value:
        return None

    key = _app_key_bytes()
    if key is None:
        return value

    try:
        payload = json.loads(base64.b64decode(value))
    except (json.JSONDecodeError, ValueError):
        return value

    if not isinstance(payload, dict) or "iv" not in payload or "value" not in payload:
        return value

    iv = base64.b64decode(payload["iv"])
    ciphertext = base64.b64decode(payload["value"])
    mac = payload.get("mac")

    if mac:
        expected = hmac.new(
            key,
            (payload["iv"] + payload["value"]).encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, mac):
            return value

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = PKCS7(128).unpadder()
    return (unpadder.update(padded) + unpadder.finalize()).decode("utf-8")


def encrypt(value: str) -> str:
    """Encrypt a string in Laravel-compatible AES-256-CBC format."""
    key = _app_key_bytes()
    if key is None or not value:
        return value

    iv = os.urandom(16)
    padder = PKCS7(128).padder()
    padded = padder.update(value.encode("utf-8")) + padder.finalize()
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()
    iv_b64 = base64.b64encode(iv).decode("ascii")
    value_b64 = base64.b64encode(ciphertext).decode("ascii")
    mac = hmac.new(
        key,
        (iv_b64 + value_b64).encode(),
        hashlib.sha256,
    ).hexdigest()
    payload = json.dumps({"iv": iv_b64, "value": value_b64, "mac": mac, "tag": ""})
    return base64.b64encode(payload.encode("utf-8")).decode("ascii")
