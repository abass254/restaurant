"""Tests for Catalogue table rename, MealAddon link table, and meal modifier endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from app.models import Catalogue, Product, MealAddon
from app.schemas import (
    CatalogueOut,
    MealAddonLinkPayload,
    MealAddonOut,
    ProductOut,
)
from app.api.v1.admin import AdminUpdateCatalogProductIn


def test_catalogue_model_and_alias():
    """Verify Catalogue model has __tablename__ == 'catalogue' and Product alias works."""
    assert Catalogue.__tablename__ == "catalogue"
    assert Product is Catalogue

    meal = Catalogue(
        id="meal_burger",
        name="Classic Cheeseburger",
        slug="classic-cheeseburger",
        product_type="meal",
    )
    assert meal.is_meal() is True
    assert meal.is_addon() is False
    assert meal.is_retail() is False
    assert meal.is_service() is False

    addon = Catalogue(
        id="addon_cheese",
        name="Extra Cheddar Cheese",
        slug="extra-cheddar-cheese",
        product_type="addon",
    )
    assert addon.is_addon() is True
    assert addon.is_meal() is False

    retail = Catalogue(
        id="retail_milk",
        name="Milk 500ml",
        slug="milk-500ml",
        product_type="retail",
    )
    assert retail.is_retail() is True

    legacy_prod = Catalogue(
        id="legacy_prod",
        name="Soap",
        slug="soap",
        product_type="product",
    )
    assert legacy_prod.is_retail() is True


def test_meal_addon_model_and_properties():
    """Verify MealAddon link model connects meal to addon with properties."""
    meal = Catalogue(
        id="meal_pizza",
        name="Pepperoni Pizza",
        slug="pepperoni-pizza",
        product_type="meal",
    )
    addon = Catalogue(
        id="addon_garlic_sauce",
        product_code="SAUCE-01",
        name="Garlic Dip Sauce",
        slug="garlic-dip-sauce",
        product_type="addon",
    )

    link = MealAddon(
        id="link_1",
        meal_id=meal.id,
        addon_id=addon.id,
        additional_price=Decimal("50.00"),
        is_default=True,
        is_required=False,
        max_quantity=3,
        sort_order=1,
    )
    link.meal = meal
    link.addon = addon

    assert link.addon_name == "Garlic Dip Sauce"
    assert link.addon_code == "SAUCE-01"

    out = MealAddonOut.model_validate(link)
    assert out.id == "link_1"
    assert out.meal_id == "meal_pizza"
    assert out.addon_id == "addon_garlic_sauce"
    assert out.additional_price == 50.0
    assert out.is_default is True
    assert out.is_required is False
    assert out.max_quantity == 3
    assert out.addon_name == "Garlic Dip Sauce"
    assert out.addon_code == "SAUCE-01"


def test_catalogue_out_with_addons_serialization():
    """Verify CatalogueOut / ProductOut schema nests addons cleanly."""
    now = datetime.now(timezone.utc)
    addon_out = MealAddonOut(
        id="link_1",
        meal_id="meal_burger",
        addon_id="addon_bacon",
        additional_price=100.0,
        is_default=False,
        is_required=False,
        max_quantity=2,
        sort_order=0,
        addon_name="Crispy Bacon",
        addon_code="ADD-BACON",
    )

    meal_out = ProductOut(
        id="meal_burger",
        product_code="MEAL-01",
        sku="SKU-MEAL-01",
        slug="bacon-burger",
        name="Bacon Deluxe Burger",
        product_type="meal",
        category="Burgers",
        brand="Chef Special",
        unit="plate",
        description="Juicy burger with toppings",
        image_url="https://example.com/burger.jpg",
        created_by_account_id=None,
        created_by_user_id=None,
        created_at=now,
        updated_at=now,
        is_active=True,
        addons=[addon_out],
    )

    assert CatalogueOut is ProductOut
    assert meal_out.addons is not None
    assert len(meal_out.addons) == 1
    assert meal_out.addons[0].addon_name == "Crispy Bacon"
    assert meal_out.addons[0].additional_price == 100.0

    dumped = meal_out.model_dump()
    assert dumped["product_type"] == "meal"
    assert dumped["addons"][0]["addon_id"] == "addon_bacon"


def test_meal_addon_link_payload_schema():
    """Verify MealAddonLinkPayload validates input correctly."""
    payload = MealAddonLinkPayload(
        addon_id="addon_cheese",
        additional_price=75.50,
        is_default=True,
        is_required=True,
        max_quantity=2,
        sort_order=1,
    )
    assert payload.addon_id == "addon_cheese"
    assert payload.additional_price == 75.50
    assert payload.is_default is True
    assert payload.is_required is True
    assert payload.max_quantity == 2


def test_admin_update_product_type_schema():
    """Verify AdminUpdateCatalogProductIn supports updating product_type."""
    req = AdminUpdateCatalogProductIn(
        is_active=True,
        product_type="meal",
    )
    assert req.is_active is True
    assert req.product_type == "meal"


def test_admin_catalog_endpoints_meal_addons():
    """Verify endpoints: list with product_type, link addon, get addons, unlink addon."""
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.main import app
    from app.database import get_db, Base
    from app.api.v1.admin_auth import require_super_admin
    from app.models import User

    # In-memory SQLite DB for testing
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    mock_admin = User(
        id="admin_1",
        name="Super Admin",
        user_role="system_admin",
        is_activated=True,
    )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_super_admin] = lambda: mock_admin

    try:
        client = TestClient(app)
        db = TestingSessionLocal()

        # Seed meal and addon
        meal = Catalogue(
            id="meal_test_1",
            name="Beef Burger Combo",
            slug="beef-burger-combo",
            product_type="meal",
            product_code="MEAL-101",
        )
        addon1 = Catalogue(
            id="addon_test_1",
            name="Extra Melted Cheese",
            slug="extra-melted-cheese",
            product_type="addon",
            product_code="ADD-CHEESE",
        )
        addon2 = Catalogue(
            id="addon_test_2",
            name="French Fries Upsize",
            slug="french-fries-upsize",
            product_type="addon",
            product_code="ADD-FRIES",
        )
        retail = Catalogue(
            id="retail_test_1",
            name="Soda 500ml",
            slug="soda-500ml",
            product_type="retail",
            product_code="SODA-500",
        )
        db.add_all([meal, addon1, addon2, retail])
        db.commit()
        db.close()

        meal_id = "meal_test_1"
        addon1_id = "addon_test_1"

        # 1. Test filtering by product_type=meal
        res_meal = client.get("/api/v1/admin/catalog/products?product_type=meal")
        assert res_meal.status_code == 200
        meal_data = res_meal.json()["data"]
        assert len(meal_data) == 1
        assert meal_data[0]["id"] == meal_id

        # 2. Test filtering by product_type=addon
        res_addon = client.get("/api/v1/admin/catalog/products?product_type=addon")
        assert res_addon.status_code == 200
        assert len(res_addon.json()["data"]) == 2

        # 3. Test POST /catalog/products/{meal_id}/addons to link addon
        link_res = client.post(
            f"/api/v1/admin/catalog/products/{meal_id}/addons",
            json={
                "addon_id": addon1_id,
                "additional_price": 50.0,
                "is_default": False,
                "is_required": False,
                "max_quantity": 2,
                "sort_order": 1,
            },
        )
        assert link_res.status_code == 200
        linked = link_res.json()
        assert linked["meal_id"] == meal_id
        assert linked["addon_id"] == addon1_id
        assert linked["additional_price"] == 50.0
        assert linked["addon_name"] == "Extra Melted Cheese"

        # 4. Test GET /catalog/products/{meal_id}/addons
        get_addons_res = client.get(f"/api/v1/admin/catalog/products/{meal_id}/addons")
        assert get_addons_res.status_code == 200
        addons_list = get_addons_res.json()
        assert len(addons_list) == 1
        assert addons_list[0]["addon_id"] == addon1_id

        # 5. Test detail endpoint includes addons
        detail_res = client.get(f"/api/v1/admin/catalog/products/{meal_id}")
        assert detail_res.status_code == 200
        detail_data = detail_res.json()["data"]["product"]
        assert detail_data["addons"] is not None
        assert len(detail_data["addons"]) == 1
        assert detail_data["addons"][0]["addon_name"] == "Extra Melted Cheese"

        # 6. Test DELETE /catalog/products/{meal_id}/addons/{addon_id}
        unlink_res = client.delete(f"/api/v1/admin/catalog/products/{meal_id}/addons/{addon1_id}")
        assert unlink_res.status_code == 200

        # Verify it's unlinked
        get_addons_res2 = client.get(f"/api/v1/admin/catalog/products/{meal_id}/addons")
        assert get_addons_res2.status_code == 200
        assert len(get_addons_res2.json()) == 0

    finally:
        app.dependency_overrides.clear()

