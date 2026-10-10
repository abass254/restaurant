"""Restaurant menu sections are configurable per shop from Settings."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.settings import (
    DEFAULT_MENU_SECTIONS,
    MenuSectionIn,
    _normalize_menu_sections,
    menu_sections_for,
)


def test_defaults_when_shop_has_none():
    assert menu_sections_for(SimpleNamespace(menu_sections=None)) == DEFAULT_MENU_SECTIONS
    assert menu_sections_for(None) == DEFAULT_MENU_SECTIONS


def test_existing_ids_are_kept_and_new_ones_slugged():
    out = _normalize_menu_sections(
        [
            MenuSectionIn(id="mains", label="Burgers & Mains"),
            MenuSectionIn(label="  Kids   meals "),
            MenuSectionIn(label="Kids-meals!"),
        ]
    )
    assert out == [
        {"id": "mains", "label": "Burgers & Mains"},
        {"id": "kids_meals", "label": "Kids meals"},
        {"id": "kids_meals_2", "label": "Kids-meals!"},
    ]


def test_duplicate_labels_rejected():
    with pytest.raises(HTTPException) as exc:
        _normalize_menu_sections([MenuSectionIn(label="Drinks"), MenuSectionIn(label="drinks")])
    assert exc.value.status_code == 422
