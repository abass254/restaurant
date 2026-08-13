from app.services.social_publish_service import normalize_instagram_post


def test_normalize_instagram_post_video_uses_thumbnail_for_poster() -> None:
    post = normalize_instagram_post(
        {
            "id": "123",
            "media_type": "REELS",
            "media_url": "https://cdn.example/video.mp4",
            "thumbnail_url": "https://cdn.example/thumb.jpg",
        }
    )
    assert post["video_url"] == "https://cdn.example/video.mp4"
    assert post["image_url"] == "https://cdn.example/thumb.jpg"


def test_normalize_instagram_post_photo_uses_media_url() -> None:
    post = normalize_instagram_post(
        {
            "id": "456",
            "media_type": "IMAGE",
            "media_url": "https://cdn.example/photo.jpg",
        }
    )
    assert post["video_url"] is None
    assert post["image_url"] == "https://cdn.example/photo.jpg"
