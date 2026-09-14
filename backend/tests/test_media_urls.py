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


def test_absolute_media_url_prefers_uploads_public_base() -> None:
    from app.config import Settings

    settings = Settings(
        frontend_url="http://127.0.0.1:7100",
        app_url="http://127.0.0.1:7001",
        uploads_public_base_url="https://merchants.dukai.app",
    )
    url = absolute_media_url("/uploads/products/1/abc.jpg", settings)
    assert url == "https://merchants.dukai.app/uploads/products/1/abc.jpg"
    ig = absolute_media_url(
        "/uploads/products/1/abc.jpg",
        settings,
        for_instagram=True,
    )
    assert ig == "https://merchants.dukai.app/uploads/products/1/abc.jpg"
