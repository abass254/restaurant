#!/usr/bin/env python3
"""Pre-submission checks for Meta App Review readiness."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402


REQUIRED_ROUTES = {
    "/api/v1/meta/data-deletion",
    "/webhooks/meta/deauthorize",
    "/webhooks/instagram",
    "/auth/instagram",
    "/up",
}

REQUIRED_ENV = [
    "instagram_app_id",
    "instagram_app_secret",
    "meta_webhook_verify_token",
    "instagram_redirect_uri",
]


def main() -> int:
    settings = get_settings()
    errors: list[str] = []
    warnings: list[str] = []

    paths = {route.path for route in app.routes}
    for path in REQUIRED_ROUTES:
        if path not in paths:
            errors.append(f"Missing route: {path}")

    for key in REQUIRED_ENV:
        if not getattr(settings, key, ""):
            warnings.append(f"Env not set: {key.upper()}")

    if settings.instagram_fake_messaging:
        warnings.append("INSTAGRAM_FAKE_MESSAGING=true — set false for production review")

    frontend = settings.frontend_url.rstrip("/")
    print("Meta App Review readiness check")
    print(f"  Frontend URL: {frontend}")
    print(f"  Privacy:      {frontend}/privacy_policy")
    print(f"  Terms:        {frontend}/terms")
    print(f"  Data delete:  {frontend}/data-deletion")
    print(f"  Callback:     {settings.app_url.rstrip('/')}/api/v1/meta/data-deletion")
    print()

    if warnings:
        print("Warnings:")
        for item in warnings:
            print(f"  - {item}")
        print()

    if errors:
        print("Errors:")
        for item in errors:
            print(f"  - {item}")
        return 1

    print("All required routes registered.")
    if not warnings:
        print("Environment looks ready for production Meta review.")
    else:
        print("Fix warnings before submitting App Review.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
