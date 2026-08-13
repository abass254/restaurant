from __future__ import annotations

from app.services.catalog.catalog_search import search_catalog_items
from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit
from app.services.catalog.http_provider import HttpCatalogProvider
from app.services.catalog.inventory_integration import InventoryIntegrationConfig
from app.services.catalog.platform_provider import PlatformCatalogProvider


class CompositeCatalogProvider:
    def __init__(
        self,
        *,
        platform: PlatformCatalogProvider,
        external: HttpCatalogProvider | None,
        mode: str,
    ):
        self.platform = platform
        self.external = external
        self.mode = mode

    def _providers(self) -> list:
        if self.mode == "external" and self.external is not None:
            return [self.external]
        if self.mode == "hybrid" and self.external is not None:
            return [self.platform, self.external]
        return [self.platform]

    def list_items(self, account_id: str, *, limit: int = 25) -> list[CatalogItem]:
        merged: list[CatalogItem] = []
        seen: set[str] = set()
        for provider in self._providers():
            for item in provider.list_items(account_id, limit=limit):
                if item.ref in seen:
                    continue
                seen.add(item.ref)
                merged.append(item)
                if len(merged) >= limit:
                    return merged
        return merged

    def search(self, account_id: str, query: str, *, limit: int = 8) -> list[CatalogSearchHit]:
        if self.mode == "external" and self.external is not None:
            return self.external.search(account_id, query, limit=limit)
        if self.mode == "hybrid" and self.external is not None:
            items = self.list_items(account_id, limit=50)
            return search_catalog_items(query, items, limit=limit)
        return self.platform.search(account_id, query, limit=limit)

    def get_item(self, account_id: str, ref: str) -> CatalogItem | None:
        for provider in self._providers():
            item = provider.get_item(account_id, ref)
            if item is not None:
                return item
        return None

    def match_product(self, account_id: str, text: str) -> CatalogItem | None:
        for provider in self._providers():
            item = provider.match_product(account_id, text)
            if item is not None:
                return item
        return None

    def check_availability(self, account_id: str, ref: str, quantity: int) -> tuple[bool, int | None]:
        item = self.get_item(account_id, ref)
        if item is None:
            return False, None
        if item.source == "platform":
            return self.platform.check_availability(account_id, ref, quantity)
        if self.external is not None:
            return self.external.check_availability(account_id, ref, quantity)
        return False, None

    @property
    def http_provider(self) -> HttpCatalogProvider | None:
        return self.external
