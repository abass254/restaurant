from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

CatalogSourceMode = Literal["platform", "external", "hybrid"]


@dataclass(frozen=True)
class HttpAuthConfig:
    type: str
    token: str | None = None
    username: str | None = None
    password: str | None = None
    header_name: str | None = None
    header_value: str | None = None


@dataclass(frozen=True)
class HttpEndpointsConfig:
    search: str | None = None
    list: str | None = None
    get: str | None = None
    create_order: str | None = None


@dataclass(frozen=True)
class HttpExternalConfig:
    type: str
    base_url: str
    auth: HttpAuthConfig
    endpoints: HttpEndpointsConfig
    field_map: dict[str, str]
    cache_ttl_seconds: int = 60
    browse_only: bool = False


@dataclass(frozen=True)
class InventoryIntegrationConfig:
    catalog_source: CatalogSourceMode = "platform"
    external: HttpExternalConfig | None = None


DEFAULT_FIELD_MAP = {
    "id": "id",
    "sku": "sku",
    "name": "name",
    "price": "price",
    "stock": "stock",
    "category": "category",
    "brand": "brand",
    "description": "description",
    "image_url": "image_url",
    "images": "images",
    "unit": "unit",
    "currency": "currency",
}


def _parse_auth(raw: dict[str, Any] | None) -> HttpAuthConfig:
    data = raw if isinstance(raw, dict) else {}
    return HttpAuthConfig(
        type=str(data.get("type") or "none").strip().lower(),
        token=str(data.get("token") or "").strip() or None,
        username=str(data.get("username") or "").strip() or None,
        password=str(data.get("password") or "").strip() or None,
        header_name=str(data.get("header_name") or "").strip() or None,
        header_value=str(data.get("header_value") or "").strip() or None,
    )


def _parse_endpoints(raw: dict[str, Any] | None) -> HttpEndpointsConfig:
    data = raw if isinstance(raw, dict) else {}
    return HttpEndpointsConfig(
        search=str(data.get("search") or "").strip() or None,
        list=str(data.get("list") or "").strip() or None,
        get=str(data.get("get") or "").strip() or None,
        create_order=str(data.get("create_order") or "").strip() or None,
    )


def _parse_external(raw: dict[str, Any] | None) -> HttpExternalConfig | None:
    if not isinstance(raw, dict):
        return None
    base_url = str(raw.get("base_url") or "").strip().rstrip("/")
    if not base_url:
        return None
    field_map = dict(DEFAULT_FIELD_MAP)
    if isinstance(raw.get("field_map"), dict):
        for key, value in raw["field_map"].items():
            if isinstance(key, str) and isinstance(value, str) and value.strip():
                field_map[key] = value.strip()
    return HttpExternalConfig(
        type=str(raw.get("type") or "http").strip().lower(),
        base_url=base_url,
        auth=_parse_auth(raw.get("auth") if isinstance(raw.get("auth"), dict) else None),
        endpoints=_parse_endpoints(raw.get("endpoints") if isinstance(raw.get("endpoints"), dict) else None),
        field_map=field_map,
        cache_ttl_seconds=max(10, min(int(raw.get("cache_ttl_seconds") or 60), 600)),
        browse_only=bool(raw.get("browse_only")),
    )


def parse_inventory_integration(raw: Any | None) -> InventoryIntegrationConfig:
    if not isinstance(raw, dict):
        return InventoryIntegrationConfig()
    source = str(raw.get("catalog_source") or "platform").strip().lower()
    if source not in {"platform", "external", "hybrid"}:
        source = "platform"
    external = _parse_external(raw.get("external") if isinstance(raw.get("external"), dict) else None)
    if source in {"external", "hybrid"} and external is None:
        source = "platform"
    return InventoryIntegrationConfig(
        catalog_source=source,  # type: ignore[arg-type]
        external=external,
    )


def inventory_integration_from_account(account) -> InventoryIntegrationConfig:
    checks = account.onboarding_checks if isinstance(getattr(account, "onboarding_checks", None), dict) else {}
    raw = checks.get("inventory_integration") if isinstance(checks, dict) else None
    return parse_inventory_integration(raw)


def inventory_integration_payload(config: InventoryIntegrationConfig) -> dict[str, Any]:
    external: dict[str, Any] | None = None
    if config.external is not None:
        ext = config.external
        external = {
            "type": ext.type,
            "base_url": ext.base_url,
            "auth": {
                "type": ext.auth.type,
                "token": ext.auth.token,
                "username": ext.auth.username,
                "password": ext.auth.password,
                "header_name": ext.auth.header_name,
                "header_value": ext.auth.header_value,
            },
            "endpoints": {
                "search": ext.endpoints.search,
                "list": ext.endpoints.list,
                "get": ext.endpoints.get,
                "create_order": ext.endpoints.create_order,
            },
            "field_map": ext.field_map,
            "cache_ttl_seconds": ext.cache_ttl_seconds,
            "browse_only": ext.browse_only,
        }
    return {
        "catalog_source": config.catalog_source,
        "external": external,
    }


def _merge_inventory_integration(
    account,
    payload: dict[str, Any],
) -> InventoryIntegrationConfig:
    incoming = parse_inventory_integration(payload)
    existing = inventory_integration_from_account(account)
    if incoming.external is None:
        return incoming
    if existing.external is None:
        return incoming

    merged_auth = incoming.external.auth
    if incoming.external.auth.token == "••••••••":
        merged_auth = HttpAuthConfig(
            type=incoming.external.auth.type,
            token=existing.external.auth.token,
            username=incoming.external.auth.username or existing.external.auth.username,
            password=(
                existing.external.auth.password
                if incoming.external.auth.password in (None, "", "••••••••")
                else incoming.external.auth.password
            ),
            header_name=incoming.external.auth.header_name or existing.external.auth.header_name,
            header_value=(
                existing.external.auth.header_value
                if incoming.external.auth.header_value in (None, "", "••••••••")
                else incoming.external.auth.header_value
            ),
        )
    external = HttpExternalConfig(
        type=incoming.external.type,
        base_url=incoming.external.base_url,
        auth=merged_auth,
        endpoints=incoming.external.endpoints,
        field_map=incoming.external.field_map,
        cache_ttl_seconds=incoming.external.cache_ttl_seconds,
        browse_only=incoming.external.browse_only,
    )
    return InventoryIntegrationConfig(
        catalog_source=incoming.catalog_source,
        external=external,
    )


def inventory_integration_public_payload(config: InventoryIntegrationConfig) -> dict[str, Any]:
    payload = inventory_integration_payload(config)
    external = payload.get("external")
    if isinstance(external, dict):
        auth = external.get("auth")
        if isinstance(auth, dict):
            redacted = dict(auth)
            if redacted.get("token"):
                redacted["token"] = "••••••••"
            if redacted.get("password"):
                redacted["password"] = "••••••••"
            if redacted.get("header_value"):
                redacted["header_value"] = "••••••••"
            external = {**external, "auth": redacted}
            payload = {**payload, "external": external}
    return payload
