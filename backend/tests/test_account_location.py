from types import SimpleNamespace

from app.support.account_location import account_has_store_coordinates


def test_account_has_store_coordinates() -> None:
    pinned = SimpleNamespace(latitude=-1.29, longitude=36.82)
    missing_lng = SimpleNamespace(latitude=-1.29, longitude=None)
    missing = SimpleNamespace(latitude=None, longitude=None)

    assert account_has_store_coordinates(pinned) is True
    assert account_has_store_coordinates(missing_lng) is False
    assert account_has_store_coordinates(missing) is False
    assert account_has_store_coordinates(None) is False
