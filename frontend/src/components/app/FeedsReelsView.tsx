"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { feedPostPosterUrl, feedPostVideoUrl, isFeedPostVideo } from "@/lib/feedsMedia";
import type { FeedPost, PlatformFeed } from "@/lib/types";

function formatPostDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type ReelItem = FeedPost & { feed: PlatformFeed };

type FeedsReelsViewProps = {
  posts: ReelItem[];
  feeds: PlatformFeed[];
  loadingMore: boolean;
  onLoadMore: (feed: PlatformFeed) => void;
  onViewPost: (post: FeedPost, feed: PlatformFeed) => void;
  onLinkPost: (post: FeedPost) => void;
  emptyState?: ReactNode;
};

export function FeedsReelsView({
  posts,
  feeds,
  loadingMore,
  onLoadMore,
  onViewPost,
  onLinkPost,
  emptyState,
}: FeedsReelsViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const sorted = useMemo(
    () =>
      [...posts].sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      }),
    [posts],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;

    const slides = Array.from(root.querySelectorAll<HTMLElement>("[data-reel-index]"));
    if (slides.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { index: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.getAttribute("data-reel-index"));
          if (Number.isNaN(index)) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { index, ratio: entry.intersectionRatio };
          }
        }
        if (best) setActiveIndex(best.index);
      },
      { root, threshold: [0.55, 0.75, 0.9] },
    );

    for (const slide of slides) observer.observe(slide);
    return () => observer.disconnect();
  }, [sorted.length]);

  useEffect(() => {
    if (sorted.length === 0 || loadingMore) return;
    if (activeIndex < sorted.length - 2) return;
    const nextFeed = feeds.find((f) => f.next_cursor);
    if (!nextFeed) return;
    onLoadMore(nextFeed);
  }, [activeIndex, feeds, loadingMore, onLoadMore, sorted.length]);

  if (sorted.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="feeds-reels" ref={scrollerRef} aria-label="Reels feed">
      {sorted.map((post, index) => (
        <FeedsReelSlide
          key={`${post.platform}-${post.id}`}
          post={post}
          feed={post.feed}
          index={index}
          active={index === activeIndex}
          onView={() => onViewPost(post, post.feed)}
          onLink={() => onLinkPost(post)}
        />
      ))}
      {loadingMore ? (
        <div className="feeds-reels__loading" aria-live="polite">
          Loading more…
        </div>
      ) : null}
    </div>
  );
}

function FeedsReelSlide({
  post,
  feed,
  index,
  active,
  onView,
  onLink,
}: {
  post: FeedPost;
  feed: PlatformFeed;
  index: number;
  active: boolean;
  onView: () => void;
  onLink: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrl = feedPostVideoUrl(post);
  const posterUrl = feedPostPosterUrl(post);
  const isVideo = isFeedPostVideo(post);
  const caption = post.caption?.trim() ?? "";
  const linked = post.linked_inventory ?? [];
  const handle = feed.account?.username ? `@${feed.account.username}` : feed.label;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      video.muted = true;
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* ignore seek errors on unloaded media */
      }
    }
  }, [active]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  return (
    <article
      className={`feeds-reel${active ? " is-active" : ""}`}
      data-reel-index={index}
      aria-label={`${handle} post`}
    >
      <div className="feeds-reel__media">
        {videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={videoUrl}
            poster={posterUrl ?? undefined}
            playsInline
            loop
            muted
            preload={active || index <= 1 ? "auto" : "metadata"}
            onClick={toggleMute}
          />
        ) : posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterUrl} alt={caption || `${feed.label} post`} />
        ) : (
          <div className="feeds-reel__placeholder" aria-hidden="true">
            <i className={`fa-solid ${isVideo ? "fa-video" : "fa-image"}`} />
          </div>
        )}
      </div>

      <div className="feeds-reel__scrim" aria-hidden="true" />

      <div className="feeds-reel__actions">
        <button type="button" className="feeds-reel__action" onClick={onView} aria-label="View post">
          <i className="fa-solid fa-eye" aria-hidden="true" />
          <span>View</span>
        </button>
        {post.like_count != null ? (
          <div className="feeds-reel__stat" aria-label={`${post.like_count} likes`}>
            <i className="fa-solid fa-heart" aria-hidden="true" />
            <span>{post.like_count}</span>
          </div>
        ) : null}
        {post.comments_count != null ? (
          <div className="feeds-reel__stat" aria-label={`${post.comments_count} comments`}>
            <i className="fa-solid fa-comment" aria-hidden="true" />
            <span>{post.comments_count}</span>
          </div>
        ) : null}
        <button
          type="button"
          className="feeds-reel__action"
          onClick={onLink}
          aria-label={linked.length > 0 ? "Manage linked products" : "Link product"}
        >
          <i className="fa-solid fa-link" aria-hidden="true" />
          <span>{linked.length > 0 ? linked.length : "Link"}</span>
        </button>
      </div>

      <div className="feeds-reel__meta">
        <div className="feeds-reel__author">
          <span className="feeds-reel__platform" style={{ color: feed.color }}>
            <i className={feed.icon} aria-hidden="true" />
          </span>
          <strong>{handle}</strong>
          {post.timestamp ? (
            <time dateTime={post.timestamp}>{formatPostDate(post.timestamp)}</time>
          ) : null}
        </div>
        {caption ? <p className="feeds-reel__caption">{caption}</p> : null}
        {linked.length > 0 ? (
          <p className="feeds-reel__linked">
            <i className="fa-solid fa-tag" aria-hidden="true" />
            {linked.length === 1
              ? linked[0].product_name
              : `${linked.length} products linked`}
          </p>
        ) : null}
      </div>
    </article>
  );
}
