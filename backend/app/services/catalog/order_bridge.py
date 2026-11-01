from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Order
from app.services.catalog.catalog_types import CatalogItem
from app.services.catalog.composite_provider import CompositeCatalogProvider
from app.services.catalog.inventory_integration import inventory_integration_from_account

logger = logging.getLogger(__name__)

EXTERNAL_SYNC_SYNCED = "synced"
EXTERNAL_SYNC_PENDING = "sync_pending"
EXTERNAL_SYNC_FAILED = "sync_failed"
EXTERNAL_SYNC_NOT_APPLICABLE = "not_applicable"


def push_order_to_external(
    db: Session,
    settings: Settings,
    *,
    account,
    order: Order,
    catalog_item: CatalogItem,
    quantity: int,
    customer_name: str | None,
    customer_phone: str | None,
) -> tuple[str | None, str]:
    integration = inventory_integration_from_account(account)
    if integration.external is None or integration.external.browse_only:
        return None, EXTERNAL_SYNC_NOT_APPLICABLE
    if catalog_item.source != "external":
        return None, EXTERNAL_SYNC_NOT_APPLICABLE
    if integration.catalog_source == "platform":
        return None, EXTERNAL_SYNC_NOT_APPLICABLE

    from app.services.catalog.factory import resolve_catalog_provider

    provider = resolve_catalog_provider(
        db,
        settings,
        str(account.account_id or ""),
        instagram_account=account,
        integration=integration,
    )
    http_provider = provider.http_provider
    if http_provider is None or not integration.external.endpoints.create_order:
        return None, EXTERNAL_SYNC_NOT_APPLICABLE

    try:
        result = http_provider.create_order(
            customer_name=customer_name,
            customer_phone=customer_phone,
            lines=[(catalog_item, quantity)],
            note=f"TransChap order {order.order_number}",
        )
        external_order_id = result.get("external_order_id")
        return (str(external_order_id) if external_order_id else None), EXTERNAL_SYNC_SYNCED
    except Exception:
        logger.exception("External order push failed order=%s", order.order_number)
        return None, EXTERNAL_SYNC_PENDING
