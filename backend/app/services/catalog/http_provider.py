from __future__ import annotations

import json
import logging
import time
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urljoin

import httpx

from app.services.catalog.catalog_search import match_item_from_text, search_catalog_items
from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit, external_ref
from app.services.catalog.inventory_integration import HttpExternalConfig

logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str, ttl_seconds: int) -> Any | None:
    row = _CACHE.get(key)
    if row is None:
        return None
    expires_at, value = row
    if time.monotonic() >= expires_at:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    _CACHE[key] = (time.monotonic() + ttl_seconds, value)


def _dig_value(record: dict[str, Any], path: str) -> Any:
    current: Any = record
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _coerce_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _coerce_images(value: Any) -> tuple[str, ...]:
    if isinstance(value, list):
        urls = [str(item).strip() for item in value if str(item).strip()]
        return tuple(urls)
    if isinstance(value, str) and value.strip():
        return (value.strip(),)
    return ()


class HttpCatalogProvider:
    def __init__(self, config: HttpExternalConfig):
        self.config = config

    def _auth_headers(self) -> dict[str, str]:
        auth = self.config.auth
        if auth.type == "bearer" and auth.token:
            return {"Authorization": f"Bearer {auth.token}"}
        if auth.type == "header" and auth.header_name and auth.header_value:
            return {auth.header_name: auth.header_value}
        return {}

    def _request(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        url = urljoin(self.config.base_url.rstrip("/") + "/", path.lstrip("/"))
        cache_key = json.dumps({"url": url, "params": params or {}}, sort_keys=True)
        cached = _cache_get(cache_key, self.config.cache_ttl_seconds)
        if cached is not None:
            return cached

        auth = None
        if self.config.auth.type == "basic" and self.config.auth.username:
            auth = (self.config.auth.username, self.config.auth.password or "")

        with httpx.Client(timeout=httpx.Timeout(10.0), follow_redirects=True) as client:
            response = client.get(url, params=params, headers=self._auth_headers(), auth=auth)
            response.raise_for_status()
            payload = response.json()

        _cache_set(cache_key, payload, self.config.cache_ttl_seconds)
        return payload

    def _extract_records(self, payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if not isinstance(payload, dict):
            return []
        for key in ("items", "products", "results", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        return []

    def _map_record(self, record: dict[str, Any]) -> CatalogItem | None:
        field_map = self.config.field_map
        name = str(_dig_value(record, field_map["name"]) or "").strip()
        if not name:
            return None
        sku = str(_dig_value(record, field_map["sku"]) or _dig_value(record, field_map["id"]) or name).strip()
        images = _coerce_images(_dig_value(record, field_map["images"]))
        if not images:
            images = _coerce_images(_dig_value(record, field_map["image_url"]))
        price = _coerce_decimal(_dig_value(record, field_map["price"]))
        stock = _coerce_int(_dig_value(record, field_map["stock"]))
        currency = str(_dig_value(record, field_map["currency"]) or "KES").strip() or "KES"
        unit = str(_dig_value(record, field_map["unit"]) or "pack").strip() or "pack"
        return CatalogItem(
            ref=external_ref(sku),
            source="external",
            name=name,
            price=price,
            currency=currency,
            stock=stock,
            category=str(_dig_value(record, field_map["category"]) or "").strip() or None,
            brand=str(_dig_value(record, field_map["brand"]) or "").strip() or None,
            description=str(_dig_value(record, field_map["description"]) or "").strip() or None,
            image_urls=images,
            external_sku=sku or None,
            unit=unit,
            is_active=True,
        )

    def _fetch_list(self) -> list[CatalogItem]:
        endpoint = self.config.endpoints.list or self.config.endpoints.search
        if not endpoint:
            return []
        payload = self._request(endpoint)
        items: list[CatalogItem] = []
        for record in self._extract_records(payload):
            mapped = self._map_record(record)
            if mapped is not None and mapped.price is not None:
                items.append(mapped)
        return items

    def _fetch_search(self, query: str, *, limit: int) -> list[CatalogItem]:
        endpoint = self.config.endpoints.search
        if endpoint:
            path = endpoint.replace("{query}", query).replace("{limit}", str(limit))
            payload = self._request(path, params={"q": query, "query": query, "limit": limit})
            items: list[CatalogItem] = []
            for record in self._extract_records(payload):
                mapped = self._map_record(record)
                if mapped is not None and mapped.price is not None:
                    items.append(mapped)
            return items[:limit]
        return search_catalog_items(query, self._fetch_list(), limit=limit)

    def list_items(self, account_id: str, *, limit: int = 25) -> list[CatalogItem]:
        del account_id
        return self._fetch_list()[: max(1, min(limit, 25))]

    def search(self, account_id: str, query: str, *, limit: int = 8) -> list[CatalogSearchHit]:
        del account_id
        items = self._fetch_search(query, limit=limit)
        if self.config.endpoints.search:
            hits: list[CatalogSearchHit] = []
            for index, item in enumerate(items):
                hits.append(
                    CatalogSearchHit(
                        item=item,
                        score=float(limit - index),
                        match_reasons=("external_api",),
                    ),
                )
            return hits[:limit]
        return search_catalog_items(query, items, limit=limit)

    def get_item(self, account_id: str, ref: str) -> CatalogItem | None:
        del account_id
        from app.services.catalog.catalog_types import external_sku_from_ref

        sku = external_sku_from_ref(ref)
        if not sku:
            return None
        endpoint = self.config.endpoints.get
        if endpoint:
            path = endpoint.replace("{sku}", sku).replace("{ref}", sku)
            payload = self._request(path)
            if isinstance(payload, dict) and payload.get("sku") is None and payload.get("id") is None:
                records = self._extract_records(payload)
                if records:
                    return self._map_record(records[0])
            if isinstance(payload, dict):
                return self._map_record(payload)
        for item in self._fetch_list():
            if item.external_sku == sku or item.ref == ref:
                return item
        return None

    def match_product(self, account_id: str, text: str) -> CatalogItem | None:
        return match_item_from_text(text, self.list_items(account_id, limit=25))

    def check_availability(self, account_id: str, ref: str, quantity: int) -> tuple[bool, int | None]:
        item = self.get_item(account_id, ref)
        if item is None or not item.is_active:
            return False, None
        if item.stock is None:
            return True, None
        return quantity <= item.stock, item.stock

    def create_order(
        self,
        *,
        customer_name: str | None,
        customer_phone: str | None,
        lines: list[tuple[CatalogItem, int]],
        note: str | None = None,
    ) -> dict[str, Any]:
        endpoint = self.config.endpoints.create_order
        if not endpoint:
            raise ValueError("External order endpoint is not configured.")

        payload = {
            "customer_name": customer_name,
            "customer_phone": customer_phone,
            "note": note,
            "lines": [
                {
                    "sku": line.external_sku or external_sku_from_ref(line.ref),
                    "quantity": qty,
                    "unit_price": float(line.price or 0),
                }
                for line, qty in lines
            ],
        }
        url = urljoin(self.config.base_url.rstrip("/") + "/", endpoint.lstrip("/"))
        auth = None
        if self.config.auth.type == "basic" and self.config.auth.username:
            auth = (self.config.auth.username, self.config.auth.password or "")
        with httpx.Client(timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
            response = client.post(
                url,
                json=payload,
                headers={**self._auth_headers(), "Content-Type": "application/json"},
                auth=auth,
            )
            response.raise_for_status()
            body = response.json()
        external_order_id = None
        if isinstance(body, dict):
            external_order_id = body.get("order_id") or body.get("id") or body.get("external_order_id")
        return {
            "external_order_id": str(external_order_id) if external_order_id else None,
            "raw": body,
        }
