from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.core.instagram_hub import hub_connect_url
from app.core.oauth_state import parse_oauth_state
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

    def get_login_url(self, *, state: str, origin: str | None = None) -> str:
        """Send the user to the transchap.app hub. The hub talks to Meta; we never do."""
        return hub_connect_url(self.settings, state, origin=origin)

    def user_from_signed_state(self, db: Session, state: str, session_user: User | None) -> User:
        payload = parse_oauth_state(self.settings, state)
        state_user_id = str(payload["user_id"])
        if session_user is None:
            user = db.get(User, state_user_id)
            if user is None:
                raise RuntimeError(
                    "Your account was not found. Please sign in and try again.",
                )
            return user
        if str(session_user.id) != state_user_id:
            raise RuntimeError("OAuth state mismatch. Please try logging in again.")
        return session_user

    def handle_callback(
        self,
        db: Session,
        code: str,
        user: User,
        *,
        return_origin: str,
    ) -> tuple[User, str]:
        # Always the hub URI registered with Meta — never this app's callback URL.
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
            .options(selectinload(User.account), selectinload(User.instagram_account))
            .filter(User.id == user.id)
            .one()
        )
        return linked_user, return_origin
