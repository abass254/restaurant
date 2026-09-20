"""Tests for item-focused, descriptive AI product image prompt generation."""

from __future__ import annotations

from app.models import Product
from app.services.image_generation_service import (
    build_prompt_for_product,
    classify_product_item_type,
    extract_product_measurements,
)


def test_beverage_prompt_focuses_on_bottle_and_shows_measurement():
    p = Product(
        id="p-coca-250",
        name="Coca-Cola 250ml",
        brand="Coca-Cola",
        category="beverages",
        product_type="product",
    )
    prompt = build_prompt_for_product(p)

    assert "beverage product" in prompt
    assert "Authentic retail bottle or can" in prompt
    assert "Focus strictly on the packaged beverage container item" in prompt
    assert "Do NOT generate clothing, t-shirts" in prompt
    assert 'measurement "250ml"' in prompt
    assert '"250" clearly and visibly printed' in prompt
    assert "no text" not in prompt  # Must not suppress text/numbers on packaging


def test_miscategorized_food_or_drink_does_not_generate_garment():
    # Cocacola was previously misclassified under 'Fashion & Apparel', which generated a t-shirt
    p = Product(
        id="p-coca-1.5l",
        name="Cocacola 1.5 Ltrs",
        brand=None,
        category="Fashion & Apparel",
        product_type="product",
    )
    item_type = classify_product_item_type(p)
    assert item_type == "beverage"

    prompt = build_prompt_for_product(p)
    assert "Garment laid flat" not in prompt
    assert "Authentic retail bottle or can" in prompt
    assert "Do NOT generate clothing, t-shirts" in prompt
    assert 'measurement "1.5 Ltrs"' in prompt
    assert '"1.5" clearly and visibly printed' in prompt


def test_cooked_dish_prompt():
    p = Product(
        id="p-mandi",
        name="Laham mandi",
        category="Fashion & Apparel",  # Even with bad category
        product_type="product",
    )
    assert classify_product_item_type(p) == "prepared_dish"

    prompt = build_prompt_for_product(p)
    assert "culinary food photograph" in prompt
    assert "Garment laid flat" not in prompt
    assert "presented on a clean modern ceramic plate or bowl" in prompt


def test_packaged_grocery_shows_weight():
    p = Product(
        id="p-sauce-400g",
        name="Zesta Tomato Sauce 400g (pack of 12)",
        category=None,
        product_type="product",
    )
    prompt = build_prompt_for_product(p)
    assert "grocery packaging" in prompt
    assert 'measurement "400g"' in prompt
    assert '"400" clearly and visibly printed' in prompt
    assert "pack of 12" in prompt


def test_household_product():
    p = Product(
        id="p-sta-soft",
        name="Sta-Soft Spring 400ml",
        category=None,
        product_type="product",
    )
    prompt = build_prompt_for_product(p)
    assert "packaged household" in prompt
    assert 'measurement "400ml"' in prompt
    assert '"400" clearly and visibly printed' in prompt


def test_actual_garment_is_correctly_classified():
    p = Product(
        id="p-shirt",
        name="Polo T-shirt Red L",
        category="Fashion & Apparel",
        product_type="product",
    )
    assert classify_product_item_type(p) == "garment"
    prompt = build_prompt_for_product(p)
    assert "Fashion catalog photograph" in prompt
    assert "Clean apparel garment laid flat" in prompt


def test_measurements_from_unit_and_attributes():
    p = Product(
        id="p-attr-size",
        name="Fruit Juice",
        brand="Del Monte",
        unit="500ml",
        attributes={"volume": "500ml", "packaging": "carton"},
        product_type="product",
    )
    measurements = extract_product_measurements(p)
    assert "500ml" in measurements

    prompt = build_prompt_for_product(p)
    assert 'measurement "500ml"' in prompt
    assert '"500" clearly and visibly printed' in prompt
