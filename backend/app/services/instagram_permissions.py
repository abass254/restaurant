from __future__ import annotations


class InstagramPermissions:
    MESSAGES = "instagram_business_manage_messages"
    MESSAGES_ALIASES = [
        "instagram_business_manage_messages",
        "business_manage_messages",
    ]

    @classmethod
    def from_token_payload(cls, token_payload: dict) -> str:
        raw = token_payload.get("permissions") or token_payload.get("scope") or ""
        if isinstance(raw, list):
            raw = ",".join(str(item) for item in raw)
        return cls.normalize(str(raw))

    @classmethod
    def normalize(cls, permissions: str | None) -> str:
        if not permissions:
            return ""
        parts = [part.strip() for part in permissions.replace(",", " ").split()]
        return ",".join(part for part in parts if part)

    @classmethod
    def to_list(cls, permissions: str | None) -> list[str]:
        normalized = cls.normalize(permissions)
        return normalized.split(",") if normalized else []

    @classmethod
    def has_messages(cls, permissions: str | None) -> bool:
        granted = cls.to_list(permissions)
        return any(alias in granted for alias in cls.MESSAGES_ALIASES)

    @classmethod
    def with_messages(cls, permissions: str | None) -> str:
        items = cls.to_list(permissions)
        if cls.MESSAGES not in items:
            items.append(cls.MESSAGES)
        return ",".join(dict.fromkeys(items))
