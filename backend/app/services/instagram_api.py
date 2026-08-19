from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class InstagramApiService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: httpx.Client | None = None

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=30)
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def url(self, path: str) -> str:
        version = self.settings.instagram_graph_version
        base = self.settings.instagram_graph_base_url.rstrip("/")
        return f"{base}/{version}/{path.lstrip('/')}"

    def token_url(self, path: str) -> str:
        """Version-less token endpoints (see Meta Business Login docs)."""
        base = self.settings.instagram_graph_base_url.rstrip("/")
        return f"{base}/{path.lstrip('/')}"

    def _ensure_success(self, response: httpx.Response, fallback: str) -> None:
        if response.is_success:
            return
        try:
            body = response.json()
            err = body.get("error") if isinstance(body.get("error"), dict) else {}
            message = (
                err.get("error_user_msg")
                or err.get("message")
                or body.get("error_message")
                or response.text
            )
        except Exception:
            message = response.text
        raise RuntimeError(f"{fallback}: {message}")

    def exchange_code_for_token(
        self,
        code: str,
        *,
        redirect_uri: str,
    ) -> dict[str, Any]:
        # Meta appends `#_` to the redirect URI; it is not part of the code.
        code = code.split("#", 1)[0].strip()
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.settings.instagram_oauth_token_url,
                data={
                    "client_id": self.settings.instagram_app_id,
                    "client_secret": self.settings.instagram_app_secret,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
        self._ensure_success(response, "Token exchange failed")
        body = response.json()
        if isinstance(body, dict) and isinstance(body.get("data"), list) and body["data"]:
            return body["data"][0]
        return body

    def _meta_error_message(self, response: httpx.Response) -> str:
        try:
            body = response.json()
            return str(
                body.get("error_message")
                or (body.get("error") or {}).get("message")
                or response.text,
            )
        except Exception:
            return response.text

    def exchange_for_long_lived_token(self, short_lived_token: str) -> dict[str, Any]:
        url = self.token_url("access_token")
        payload = {
            "grant_type": "ig_exchange_token",
            "client_secret": self.settings.instagram_app_secret,
            "access_token": short_lived_token,
        }
        with httpx.Client(timeout=30) as client:
            # Business Login docs specify GET; some Instagram Login apps accept POST.
            response = client.get(url, params=payload)
            if not response.is_success:
                post_response = client.post(url, data=payload)
                if post_response.is_success:
                    response = post_response
                else:
                    logger.warning(
                        "Long-lived token exchange failed GET then POST: get=%s post=%s",
                        self._meta_error_message(response),
                        self._meta_error_message(post_response),
                    )
        self._ensure_success(response, "Long-lived token exchange failed")
        data = response.json()
        expires_at = None
        if data.get("expires_in"):
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(data["expires_in"]))
        return {"access_token": data["access_token"], "expires_at": expires_at}

    def refresh_long_lived_token(self, long_lived_token: str) -> dict[str, Any]:
        """Refresh a long-lived Instagram user token before it expires (~60 days)."""
        url = self.token_url("refresh_access_token")
        payload = {
            "grant_type": "ig_refresh_token",
            "access_token": long_lived_token,
        }
        with httpx.Client(timeout=30) as client:
            response = client.get(url, params=payload)
        self._ensure_success(response, "Token refresh failed")
        data = response.json()
        expires_at = None
        if data.get("expires_in"):
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(data["expires_in"]))
        if not data.get("access_token"):
            raise RuntimeError("Token refresh failed: no access_token")
        return {"access_token": data["access_token"], "expires_at": expires_at}

    def get_me(self, access_token: str) -> dict[str, Any]:
        return self.get(
            "me",
            {
                "fields": "id,user_id,username,name,account_type,profile_picture_url",
                "access_token": access_token,
            },
        )

    def get_user_profile(self, ig_scoped_id: str, access_token: str) -> dict[str, Any]:
        """Instagram User Profile API (requires the user to have messaged you)."""
        return self.get(
            ig_scoped_id,
            {
                "fields": "name,username,profile_pic",
                "access_token": access_token,
            },
        )

    def get_conversations(self, access_token: str) -> list[dict[str, Any]]:
        data = self.get(
            "me/conversations",
            {"platform": "instagram", "access_token": access_token},
        )
        return data.get("data") or []

    def get_conversation_messages(
        self,
        conversation_id: str,
        access_token: str,
    ) -> list[dict[str, Any]]:
        data = self.get(
            conversation_id,
            {"fields": "messages", "access_token": access_token},
        )
        return (data.get("messages") or {}).get("data") or []

    def get_message(self, message_id: str, access_token: str) -> dict[str, Any]:
        return self.get(
            message_id,
            {
                "fields": "id,created_time,from,to,message",
                "access_token": access_token,
            },
        )

    def subscribe_to_webhooks(
        self,
        instagram_user_id: str,
        access_token: str,
        fields: list[str],
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url(f"{instagram_user_id}/subscribed_apps"),
                data={
                    "subscribed_fields": ",".join(fields),
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Webhook subscription failed")
        return response.json()

    def unsubscribe_from_webhooks(
        self,
        instagram_user_id: str,
        access_token: str,
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.delete(
                self.url(f"{instagram_user_id}/subscribed_apps"),
                params={"access_token": access_token},
            )
        self._ensure_success(response, "Webhook unsubscribe failed")
        body = response.json()
        return body if isinstance(body, dict) else {"success": True}

    def send_sender_action(
        self,
        recipient_ig_scoped_id: str,
        sender_action: str,
        access_token: str,
    ) -> dict[str, Any]:
        """Display typing or read-receipt state in the customer's Instagram DM thread."""
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url("me/messages"),
                json={
                    "recipient": {"id": recipient_ig_scoped_id},
                    "sender_action": sender_action,
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, f"Failed to send sender action ({sender_action})")
        return response.json()

    def send_text_message(
        self,
        recipient_ig_scoped_id: str,
        text: str,
        access_token: str,
        quick_replies: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        message: dict[str, Any] = {"text": text}
        if quick_replies:
            message["quick_replies"] = quick_replies
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url("me/messages"),
                json={
                    "recipient": {"id": recipient_ig_scoped_id},
                    "messaging_type": "RESPONSE",
                    "message": message,
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to send message")
        return response.json()

    def send_generic_template(
        self,
        recipient_ig_scoped_id: str,
        elements: list[dict[str, Any]],
        access_token: str,
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url("me/messages"),
                json={
                    "recipient": {"id": recipient_ig_scoped_id},
                    "messaging_type": "RESPONSE",
                    "message": {
                        "attachment": {
                            "type": "template",
                            "payload": {
                                "template_type": "generic",
                                "elements": elements,
                            },
                        },
                    },
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to send generic template")
        return response.json()

    def send_image_message(
        self,
        recipient_ig_scoped_id: str,
        image_url: str,
        access_token: str,
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url("me/messages"),
                json={
                    "recipient": {"id": recipient_ig_scoped_id},
                    "messaging_type": "RESPONSE",
                    "message": {
                        "attachment": {
                            "type": "image",
                            "payload": {"url": image_url},
                        },
                    },
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to send image")
        return response.json()

    def set_ice_breakers(
        self,
        instagram_user_id: str,
        access_token: str,
        call_to_actions: list[dict[str, str]],
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url(f"{instagram_user_id}/messenger_profile"),
                json={
                    "platform": "instagram",
                    "ice_breakers": [
                        {
                            "call_to_actions": call_to_actions,
                            "locale": "default",
                        }
                    ],
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to set conversation starters")
        return response.json()

    def clear_ice_breakers(self, instagram_user_id: str, access_token: str) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.request(
                "DELETE",
                self.url(f"{instagram_user_id}/messenger_profile"),
                json={
                    "platform": "instagram",
                    "ice_breakers": [],
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to clear conversation starters")
        return response.json()

    def set_persistent_menu(
        self,
        instagram_user_id: str,
        access_token: str,
        call_to_actions: list[dict[str, str]],
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url(f"{instagram_user_id}/messenger_profile"),
                json={
                    "platform": "instagram",
                    "persistent_menu": [
                        {
                            "locale": "default",
                            "composer_input_disabled": False,
                            "call_to_actions": call_to_actions,
                        }
                    ],
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to set persistent menu")
        return response.json()

    def clear_persistent_menu(
        self,
        instagram_user_id: str,
        access_token: str,
    ) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.request(
                "DELETE",
                self.url(f"{instagram_user_id}/messenger_profile"),
                json={
                    "platform": "instagram",
                    "persistent_menu": [],
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to clear persistent menu")
        return response.json()

    def get_messenger_profile(
        self,
        access_token: str,
        fields: str = "ice_breakers,persistent_menu",
    ) -> dict[str, Any]:
        return self.get(
            "me/messenger_profile",
            {
                "fields": fields,
                "platform": "instagram",
                "access_token": access_token,
            },
        )

    def create_image_media_container(
        self,
        ig_user_id: str,
        image_url: str,
        access_token: str,
        caption: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "image_url": image_url,
            "access_token": access_token,
        }
        if caption:
            payload["caption"] = caption
        with httpx.Client(timeout=60) as client:
            response = client.post(
                self.url(f"{ig_user_id}/media"),
                json=payload,
            )
        self._ensure_success(response, "Failed to create Instagram media container")
        return response.json()

    def create_media_container(
        self,
        ig_user_id: str,
        image_url: str,
        access_token: str,
        caption: str | None = None,
    ) -> dict[str, Any]:
        """Backward-compatible alias for photo publishing."""
        return self.create_image_media_container(
            ig_user_id,
            image_url,
            access_token,
            caption=caption,
        )

    def create_video_media_container(
        self,
        ig_user_id: str,
        video_url: str,
        access_token: str,
        *,
        caption: str | None = None,
        media_type: str = "REELS",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "media_type": media_type,
            "video_url": video_url,
            "access_token": access_token,
        }
        if caption:
            payload["caption"] = caption
        with httpx.Client(timeout=120) as client:
            response = client.post(
                self.url(f"{ig_user_id}/media"),
                json=payload,
            )
        self._ensure_success(response, "Failed to create Instagram video container")
        return response.json()

    def get_media_container_status(
        self,
        container_id: str,
        access_token: str,
    ) -> dict[str, Any]:
        return self.get(
            container_id,
            {"fields": "status_code", "access_token": access_token},
        )

    _MEDIA_BASE_FIELDS = (
        "id,caption,media_type,media_product_type,media_url,thumbnail_url,"
        "timestamp,permalink,like_count,comments_count"
    )
    _MEDIA_ENGAGEMENT_FIELDS = (
        "reposts_count,saved_count,shares_count,total_like_count,"
        "total_comments_count,total_views_count,view_count"
    )

    def get_user_media(
        self,
        ig_user_id: str,
        access_token: str,
        *,
        limit: int = 25,
        after: str | None = None,
    ) -> dict[str, Any]:
        """List media published by the connected Instagram business account."""
        fields = self._MEDIA_BASE_FIELDS
        params: dict[str, Any] = {
            "fields": fields,
            "limit": min(max(limit, 1), 50),
            "access_token": access_token,
        }
        if after:
            params["after"] = after
        return self.get(f"{ig_user_id}/media", params)

    def get_media(
        self,
        media_id: str,
        access_token: str,
        *,
        include_engagement_fields: bool = True,
    ) -> dict[str, Any]:
        """Fetch one published media object with engagement counts."""
        fields = self._MEDIA_BASE_FIELDS
        if include_engagement_fields:
            fields = f"{fields},{self._MEDIA_ENGAGEMENT_FIELDS}"
        try:
            return self.get(
                media_id,
                {"fields": fields, "access_token": access_token},
            )
        except Exception:
            if include_engagement_fields:
                return self.get_media(
                    media_id,
                    access_token,
                    include_engagement_fields=False,
                )
            raise

    def get_media_comments(
        self,
        media_id: str,
        access_token: str,
        *,
        limit: int = 25,
        after: str | None = None,
    ) -> dict[str, Any]:
        """List comments (and replies) on a media object owned by the account."""
        fields = (
            "id,text,timestamp,username,from{id,username},"
            "replies{id,text,timestamp,username,from{id,username}}"
        )
        params: dict[str, Any] = {
            "fields": fields,
            "limit": min(max(limit, 1), 50),
            "access_token": access_token,
        }
        if after:
            params["after"] = after
        return self.get(f"{media_id}/comments", params)

    def reply_to_comment(
        self,
        comment_id: str,
        message: str,
        access_token: str,
    ) -> dict[str, Any]:
        """Post a public reply under an Instagram comment."""
        with httpx.Client(timeout=30) as client:
            response = client.post(
                self.url(f"{comment_id}/replies"),
                json={
                    "message": message,
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to reply to Instagram comment")
        return response.json()

    def get_media_insights(
        self,
        media_id: str,
        access_token: str,
        *,
        metrics: list[str],
        breakdown: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "metric": ",".join(metrics),
            "access_token": access_token,
        }
        if breakdown:
            params["breakdown"] = breakdown
        return self.get(f"{media_id}/insights", params)

    def publish_media_container(
        self,
        ig_user_id: str,
        creation_id: str,
        access_token: str,
    ) -> dict[str, Any]:
        with httpx.Client(timeout=60) as client:
            response = client.post(
                self.url(f"{ig_user_id}/media_publish"),
                json={
                    "creation_id": creation_id,
                    "access_token": access_token,
                },
            )
        self._ensure_success(response, "Failed to publish Instagram media")
        return response.json()

    def get(self, path: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self._get_client().get(self.url(path), params=query or {})
        self._ensure_success(response, "Instagram API request failed")
        return response.json()
