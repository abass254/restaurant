"""Unit tests for inventory_role helpers on InventoryItem."""

from app.models import InventoryItem


def test_normalized_role_defaults_and_saleable():
    item = InventoryItem(account_id="a", product_id="p")
    assert item.normalized_role() == "both"
    assert item.is_saleable() is True
    assert item.is_purchasable() is True

    item.inventory_role = "raw_material"
    assert item.normalized_role() == "raw_material"
    assert item.is_saleable() is False
    assert item.is_purchasable() is True

    item.inventory_role = "both"
    assert item.normalized_role() == "both"
    assert item.is_saleable() is True
    assert item.is_purchasable() is True

    item.inventory_role = "for_sale"
    assert item.normalized_role() == "for_sale"
    assert item.is_saleable() is True
    assert item.is_purchasable() is False

    item.inventory_role = "unknown"
    assert item.normalized_role() == "both"
    assert item.is_saleable() is True
    assert item.is_purchasable() is True
