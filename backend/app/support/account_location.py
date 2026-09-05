"""Shop pin helpers used when connecting the rider app."""

from __future__ import annotations

from app.models import Account

STORE_LOCATION_REQUIRED_FOR_RIDERS = (
    "Pin your store location before connecting riders. They use it to find your shop."
)


def account_has_store_coordinates(account: Account | None) -> bool:
    return (
        account is not None
        and account.latitude is not None
        and account.longitude is not None
    )
