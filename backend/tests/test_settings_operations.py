from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.api.v1 import settings as settings_api


def test_operations_settings_are_readable_from_pos(monkeypatch) -> None:
    user = SimpleNamespace(id="user-1")
    account = SimpleNamespace(
        allow_item_quantity_adjustment=True,
        allow_price_adjustment=False,
        adjust_selling_price_on_purchase=True,
        force_mpesa_prompt=False,
    )
    db = MagicMock()
    db.get.return_value = account
    services = SimpleNamespace(db=db)
    accessed_sections: list[tuple[str, ...]] = []
    monkeypatch.setattr(settings_api, "require_user", lambda *_: user)
    monkeypatch.setattr(
        settings_api,
        "assert_merchant_section_any_access",
        lambda _user, *sections: accessed_sections.append(sections),
    )
    monkeypatch.setattr(
        settings_api,
        "require_merchant_account_id",
        lambda _user: "acct-1",
    )

    response = settings_api.show_operations_settings(services=services, session={})

    assert response == {
        "allow_item_quantity_adjustment": True,
        "allow_price_adjustment": False,
        "adjust_selling_price_on_purchase": True,
        "force_mpesa_prompt": False,
        "block_sale_on_low_ingredients": False,
        "kitchen_issuing_enabled": False,
    }
    assert accessed_sections == [("settings", "pos", "dashboard")]
    db.get.assert_called_once()
