"""Catalog provider abstraction for DM sales bots."""

from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit
from app.services.catalog.factory import resolve_catalog_provider

__all__ = [
    "CatalogItem",
    "CatalogSearchHit",
    "resolve_catalog_provider",
]
