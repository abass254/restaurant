from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import Settings
from app.services.catalog.composite_provider import CompositeCatalogProvider
from app.services.catalog.http_provider import HttpCatalogProvider
from app.services.catalog.inventory_integration import (
    InventoryIntegrationConfig,
    inventory_integration_from_account,
)
from app.services.catalog.platform_provider import PlatformCatalogProvider


def resolve_catalog_provider(
    db: Session,
    settings: Settings | None,
    account_id: str,
    *,
    instagram_account=None,
    integration: InventoryIntegrationConfig | None = None,
) -> CompositeCatalogProvider:
    config = integration
    if config is None and instagram_account is not None:
        config = inventory_integration_from_account(instagram_account)
    if config is None:
        config = InventoryIntegrationConfig()

    platform = PlatformCatalogProvider(db, settings)
    external = (
        HttpCatalogProvider(config.external)
        if config.external is not None and config.catalog_source in {"external", "hybrid"}
        else None
    )
    return CompositeCatalogProvider(
        platform=platform,
        external=external,
        mode=config.catalog_source,
    )
