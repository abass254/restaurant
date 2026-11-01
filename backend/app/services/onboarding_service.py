from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, User
from app.services.instagram_api import InstagramApiService
from app.services.instagram_permissions import InstagramPermissions


class OnboardingRequirementService:
    def __init__(self, db: Session, settings: Settings, instagram_api: InstagramApiService):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def evaluate(self, account: InstagramAccount) -> list[dict]:
        checks = [
            self._check_instagram_connected(account),
            self._check_professional_account(account),
            self._check_messages_permission(account),
            self._check_profile_complete(account),
            self._check_api_access(account),
            self._check_webhooks_subscribed(account),
        ]
        passed = all(check["passed"] for check in checks)

        account.onboarding_checks = checks
        account.onboarding_complete = passed
        account.updated_at = datetime.now(timezone.utc)

        user = account.user
        if passed and not user.is_onboarded():
            user.onboarded_at = datetime.now(timezone.utc)
        elif not passed and user.is_onboarded():
            user.onboarded_at = None

        self.db.commit()
        self.db.refresh(account)
        self.db.refresh(user)
        return checks

    def _check_instagram_connected(self, account: InstagramAccount) -> dict:
        return {
            "key": "instagram_connected",
            "label": "Instagram account connected",
            "description": "You signed in with Instagram and we stored a valid access token.",
            "passed": bool(account.user_access_token and account.login_provider == "instagram"),
            "help_url": self.settings.instagram_help_links["business_login"],
        }

    def _check_professional_account(self, account: InstagramAccount) -> dict:
        return {
            "key": "professional_account",
            "label": "Professional Instagram account",
            "description": "Messaging requires a Business or Creator account.",
            "passed": account.account_type in {"BUSINESS", "MEDIA_CREATOR"},
            "help_url": self.settings.instagram_help_links["switch_professional"],
        }

    def _check_messages_permission(self, account: InstagramAccount) -> dict:
        passed = InstagramPermissions.has_messages(account.granted_permissions)
        if not passed and account.user_access_token:
            passed = self._verify_messages_api_access(account)
        return {
            "key": "messages_permission",
            "label": "Messaging permission granted",
            "description": (
                "Your token can access Instagram messaging."
                if passed
                else "Log out and log in again, and approve all permissions (including messages)."
            ),
            "passed": passed,
            "help_url": self.settings.instagram_help_links["business_login"],
        }

    def _verify_messages_api_access(self, account: InstagramAccount) -> bool:
        try:
            self.instagram_api.get_conversations(account.access_token())
            account.granted_permissions = InstagramPermissions.with_messages(
                account.granted_permissions,
            )
            self.db.commit()
            return True
        except Exception:
            return False

    def _check_profile_complete(self, account: InstagramAccount) -> dict:
        return {
            "key": "profile_complete",
            "label": "Profile available",
            "description": "We can read your Instagram username from the API.",
            "passed": bool(account.username),
            "help_url": None,
        }

    def _check_api_access(self, account: InstagramAccount) -> dict:
        if not account.has_instagram_business_account():
            return {
                "key": "api_access",
                "label": "API access verified",
                "description": "We can reach the Instagram API with your token.",
                "passed": False,
                "help_url": self.settings.instagram_help_links["create_meta_app"],
            }

        try:
            me = self.instagram_api.get_me(account.access_token())
            passed = bool(me.get("user_id") or me.get("id"))
        except Exception:
            passed = False

        return {
            "key": "api_access",
            "label": "API access verified",
            "description": "We can reach the Instagram API with your token.",
            "passed": passed,
            "help_url": self.settings.instagram_help_links["create_meta_app"],
        }

    def _check_webhooks_subscribed(self, account: InstagramAccount) -> dict:
        passed = False
        user_id = str(account.instagram_user_id or "")
        required = set(self.settings.instagram_webhook_subscribed_fields)

        if user_id and account.user_access_token and account.login_provider == "instagram":
            try:
                response = self.instagram_api.get(
                    f"{user_id}/subscribed_apps",
                    {"access_token": account.access_token()},
                )
                for row in response.get("data") or []:
                    subscribed = set(row.get("subscribed_fields") or [])
                    if required.issubset(subscribed):
                        passed = True
                        break
            except Exception:
                passed = False

        return {
            "key": "webhooks_subscribed",
            "label": "Message notifications enabled",
            "description": (
                "Instagram will push new DMs to TransChap in real time."
                if passed
                else "We could not confirm webhook subscription. Click re-check after connecting."
            ),
            "passed": passed,
            "help_url": self.settings.instagram_help_links["create_meta_app"],
        }
