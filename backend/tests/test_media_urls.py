from app.services.product_media_service import absolute_media_url


def test_absolute_media_url_prefers_app_url_for_instagram_uploads() -> None:
    from app.config import Settings

    settings = Settings(
        frontend_url="https://shop.example",
        app_url="https://api.example",
    )
    url = absolute_media_url("/uploads/feed/1/abc.jpg", settings, for_instagram=True)
    assert url == "https://api.example/uploads/feed/1/abc.jpg"


def test_absolute_media_url_uses_frontend_for_non_instagram() -> None:
    from app.config import Settings

    settings = Settings(
        frontend_url="https://shop.example",
        app_url="https://api.example",
    )
    url = absolute_media_url("/uploads/feed/1/abc.jpg", settings)
    assert url == "https://shop.example/uploads/feed/1/abc.jpg"
