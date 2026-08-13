from __future__ import annotations

from urllib.parse import urlencode

from sqlalchemy.orm import Session, joinedload

from app.config import Settings
from app.core.oauth_state import create_oauth_state, parse_oauth_state
from app.models import User
from app.services.instagram_account_link import InstagramAccountLinkService
from app.services.instagram_api import InstagramApiService


class InstagramAuthService:
    def __init__(
        self,
        settings: Settings,
        instagram_api: InstagramApiService,
        linker: InstagramAccountLinkService,
    ):
        self.settings = settings
        self.instagram_api = instagram_api
        self.linker = linker

    def get_login_url(self, *, user_id: str, return_origin: str) -> str:
        redirect_uri = self.settings.effective_instagram_redirect_uri
        state = create_oauth_state(
            self.settings,
            user_id=user_id,
            return_origin=return_origin,
        )
        query = urlencode(
            {
                "client_id": self.settings.instagram_app_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": ",".join(self.settings.instagram_scopes),
                "state": state,
                "enable_fb_login": "0",
            },
        )
        return f"{self.settings.instagram_oauth_authorize_url}?{query}"

    def handle_callback(
        self,
        db: Session,
        code: str,
        state: str,
        user: User | None = None,
    ) -> tuple[User, str]:
        payload = parse_oauth_state(self.settings, state)
        return_origin = str(payload["return_origin"])
        state_user_id = str(payload["user_id"])

        if user is None:
            user = db.get(User, state_user_id)
            if user is None:
                raise RuntimeError(
                    "Your account was not found. Please sign in and try again.",
                )
        elif str(user.id) != state_user_id:
            raise RuntimeError("OAuth state mismatch. Please try logging in again.")

        redirect_uri = self.settings.effective_instagram_redirect_uri
        token_payload = self.instagram_api.exchange_code_for_token(
            code,
            redirect_uri=redirect_uri,
        )
        short_token = token_payload.get("access_token")
        if not short_token:
            raise RuntimeError("No access token returned.")

        # Exchange for a long-lived token before Graph API calls. Short-lived
        # tokens often fail on graph.instagram.com/me in production apps.
        long_lived = self.instagram_api.exchange_for_long_lived_token(short_token)
        access_token = long_lived["access_token"]
        me = self.instagram_api.get_me(access_token)
        self.linker.link_from_oauth(user, token_payload, me, long_lived=long_lived)

        linked_user = (
            db.query(User)
            .options(joinedload(User.account), joinedload(User.instagram_account))
            .filter(User.id == user.id)
            .one()
        )
        return linked_user, return_origin
