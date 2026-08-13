"""Tests for inventory integration config parsing."""

from __future__ import annotations

from app.services.catalog.inventory_integration import parse_inventory_integration


def test_defaults_to_platform():
    config = parse_inventory_integration(None)
    assert config.catalog_source == "platform"
    assert config.external is None


def test_parses_external_http_config():
    config = parse_inventory_integration(
        {
            "catalog_source": "external",
            "external": {
                "type": "http",
                "base_url": "https://erp.example.com/api",
                "auth": {"type": "bearer", "token": "secret"},
                "endpoints": {
                    "search": "/products/search?q={query}",
                    "list": "/products",
                    "get": "/products/{sku}",
                    "create_order": "/orders",
                },
                "field_map": {"name": "product_name", "price": "list_price"},
            },
        },
    )
    assert config.catalog_source == "external"
    assert config.external is not None
    assert config.external.base_url == "https://erp.example.com/api"
    assert config.external.auth.token == "secret"
    assert config.external.field_map["name"] == "product_name"
