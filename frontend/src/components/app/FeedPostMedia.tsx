"use client";

import { feedPostPosterUrl, feedPostVideoUrl, isFeedPostVideo } from "@/lib/feedsMedia";
import type { FeedPost } from "@/lib/types";

type FeedPostMediaProps = {
  post: FeedPost;
  alt: string;
  className?: string;
  /** Grid cards use metadata-only previews; detail view enables controls. */
  interactive?: boolean;
  loading?: "lazy" | "eager";
};

export function FeedPostMedia({
  post,
  alt,
  className,
  interactive = false,
  loading = "lazy",
}: FeedPostMediaProps) {
  const videoUrl = feedPostVideoUrl(post);
  const posterUrl = feedPostPosterUrl(post);

  if (videoUrl) {
    return (
      <video
        className={className}
        src={videoUrl}
        poster={posterUrl ?? undefined}
        controls={interactive}
        playsInline
        preload={interactive ? "metadata" : "metadata"}
        muted={!interactive}
        loop={!interactive}
        aria-label={alt}
      />
    );
  }

  if (posterUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={className}
        src={posterUrl}
        alt={alt}
        loading={loading}
      />
    );
  }

  return (
    <div className="feeds-card__placeholder" aria-hidden="true">
      <i className={`fa-solid ${isFeedPostVideo(post) ? "fa-video" : "fa-image"}`} />
    </div>
  );
}
