"""Restaurant tables and stations are configurable per shop from Settings."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.settings import (
    DEFAULT_RESTAURANT_TABLES,
    DEFAULT_RESTAURANT_STATIONS,
    RestaurantTableIn,
    RestaurantStationIn,
    _normalize_restaurant_tables,
    _normalize_restaurant_stations,
    restaurant_tables_for,
    restaurant_stations_for,
)


def test_table_defaults_when_shop_has_none():
    assert restaurant_tables_for(SimpleNamespace(restaurant_tables=None)) == DEFAULT_RESTAURANT_TABLES
    assert restaurant_tables_for(None) == DEFAULT_RESTAURANT_TABLES


def test_station_defaults_when_shop_has_none():
    assert restaurant_stations_for(SimpleNamespace(restaurant_stations=None)) == DEFAULT_RESTAURANT_STATIONS
    assert restaurant_stations_for(None) == DEFAULT_RESTAURANT_STATIONS


def test_table_normalization():
    out = _normalize_restaurant_tables(
        [
            RestaurantTableIn(id="table_1", label="Table 1"),
            RestaurantTableIn(label="  VIP  Lounge  "),
            RestaurantTableIn(label="Table 1 Duplicate ID", id="table_1"),
        ]
    )
    assert out == [
        {"id": "table_1", "label": "Table 1"},
        {"id": "vip_lounge", "label": "VIP Lounge"},
        {"id": "table_1_2", "label": "Table 1 Duplicate ID"},
    ]


def test_duplicate_table_labels_rejected():
    with pytest.raises(HTTPException) as exc:
        _normalize_restaurant_tables([
            RestaurantTableIn(label="Table 1"),
            RestaurantTableIn(label="table 1"),
        ])
    assert exc.value.status_code == 422


def test_empty_tables_rejected():
    with pytest.raises(HTTPException) as exc:
        _normalize_restaurant_tables([])
    assert exc.value.status_code == 422


def test_station_normalization_with_kitchen():
    out = _normalize_restaurant_stations(
        [
            RestaurantStationIn(id="kitchen", label="Main Kitchen"),
            RestaurantStationIn(label="Bar & Drinks"),
            RestaurantStationIn(label="Grill"),
        ]
    )
    assert out == [
        {"id": "kitchen", "label": "Main Kitchen"},
        {"id": "bar_drinks", "label": "Bar & Drinks"},
        {"id": "grill", "label": "Grill"},
    ]


def test_station_kitchen_required():
    # Attempting to save stations without kitchen must be rejected
    with pytest.raises(HTTPException) as exc:
        _normalize_restaurant_stations(
            [
                RestaurantStationIn(label="Bar"),
                RestaurantStationIn(label="Grill"),
            ]
        )
    assert exc.value.status_code == 422
    assert "Kitchen must be one of the stations" in exc.value.detail


def test_duplicate_station_labels_rejected():
    with pytest.raises(HTTPException) as exc:
        _normalize_restaurant_stations(
            [
                RestaurantStationIn(label="Kitchen"),
                RestaurantStationIn(label="kitchen"),
            ]
        )
    assert exc.value.status_code == 422
