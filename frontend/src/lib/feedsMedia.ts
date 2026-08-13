import type { FeedPost } from "./types";

/** Instagram photo + video MIME types accepted for feed publishing. */
export const FEED_UPLOAD_ACCEPT = "image/jpeg,video/mp4,video/quicktime";

export const FEED_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const FEED_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const FEED_PHOTO_TYPES = new Set(["image/jpeg", "image/pjpeg"]);
const FEED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

export function isFeedPostVideo(post: Pick<FeedPost, "media_type" | "video_url">): boolean {
  const mediaType = post.media_type?.toUpperCase();
  if (mediaType === "VIDEO" || mediaType === "REELS") return true;
  return Boolean(post.video_url);
}

export function feedPostVideoUrl(post: FeedPost): string | null {
  return isFeedPostVideo(post) ? post.video_url ?? null : null;
}

export function feedPostPosterUrl(post: FeedPost): string | null {
  return post.image_url;
}

export function fileIsFeedVideo(file: File): boolean {
  return file.type.startsWith("video/");
}

/** Returns a user-facing error when the file cannot be published, or null if OK. */
export function validateFeedFile(file: File): string | null {
  if (!file.size) {
    return "The selected file is empty.";
  }

  if (fileIsFeedVideo(file)) {
    if (!FEED_VIDEO_TYPES.has(file.type)) {
      return "Videos must be MP4 or MOV.";
    }
    if (file.size > FEED_VIDEO_MAX_BYTES) {
      return `Video is larger than ${FEED_VIDEO_MAX_BYTES / (1024 * 1024)} MB.`;
    }
    return null;
  }

  if (!FEED_PHOTO_TYPES.has(file.type)) {
    if (
      file.type === "image/png" ||
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.type === "image/webp"
    ) {
      return "Instagram requires JPEG photos. Save or export the image as JPEG first.";
    }
    return "Photos must be JPEG (.jpg).";
  }

  if (file.size > FEED_PHOTO_MAX_BYTES) {
    return `Photo is larger than ${FEED_PHOTO_MAX_BYTES / (1024 * 1024)} MB.`;
  }

  return null;
}
