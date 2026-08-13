from __future__ import annotations

import secrets
import string

import bcrypt

# Ambiguous characters (0/O, 1/l/I) are dropped so a temp password is easy to
# read off an email and type by hand.
_TEMP_PASSWORD_ALPHABET = (
    "".join(c for c in string.ascii_uppercase if c not in "OI")
    + "".join(c for c in string.ascii_lowercase if c not in "l")
    + "".join(c for c in string.digits if c not in "01")
)


def _normalize_bcrypt_hash(hashed_password: str) -> str:
    """Laravel uses $2y$; the bcrypt library expects $2a$ / $2b$."""
    if hashed_password.startswith("$2y$"):
        return "$2b$" + hashed_password[4:]
    return hashed_password


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    if not hashed_password:
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            _normalize_bcrypt_hash(hashed_password).encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def generate_temp_password(length: int = 12) -> str:
    """A random, human-friendly temporary password."""
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))


def hash_password(plain_password: str) -> str:
    digest = bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt())
    hashed = digest.decode("utf-8")
    if hashed.startswith("$2b$"):
        return "$2y$" + hashed[4:]
    return hashed
