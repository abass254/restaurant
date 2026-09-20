"""Tests for admin catalog endpoints, models, and bulk status updates."""

from __future__ import annotations

from datetime import datetime, timezone
from app.schemas import ProductOut
from app.api.v1.admin import AdminUpdateCatalogProductIn, AdminBulkUpdateCatalogProductsIn


def test_product_out_schema_includes_is_active_and_total_quantity():
    """Verify schema defaults and serialization for catalog columns."""
    now = datetime.now(timezone.utc)
    schema = ProductOut(
        id="prod_1",
        product_code="PROD-001",
        sku="SKU-001",
        slug="fresh-milk-500ml",
        name="Fresh Milk 500ml",
        product_type="retail",
        category="Dairy",
        brand="Brookside",
        unit="packet",
        description="Fresh whole milk",
        image_url="https://example.com/milk.jpg",
        created_by_account_id=None,
        created_by_user_id=None,
        created_at=now,
        updated_at=now,
        is_active=True,
        total_quantity=42,
    )
    assert schema.is_active is True
    assert schema.total_quantity == 42

    dumped = schema.model_dump()
    assert dumped["is_active"] is True
    assert dumped["total_quantity"] == 42


def test_admin_product_status_update_schema():
    """Verify single status toggle request schema."""
    req = AdminUpdateCatalogProductIn(is_active=False)
    assert req.is_active is False


def test_admin_catalog_bulk_status_request_schema():
    """Verify bulk status toggle request schema."""
    req = AdminBulkUpdateCatalogProductsIn(
        product_ids=["prod_1", "prod_2"],
        is_active=True,
    )
    assert req.product_ids == ["prod_1", "prod_2"]
    assert req.is_active is True
