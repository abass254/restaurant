"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import { FeedsComposeModal } from "@/components/app/FeedsComposeModal";
import { FeedPostMedia } from "@/components/app/FeedPostMedia";
import { FeedsReelsView } from "@/components/app/FeedsReelsView";
import { FeedsSubNav } from "@/components/app/FeedsSubNav";
import { FeedsLinkProductModal } from "@/components/app/FeedsLinkProductModal";
import { FeedsPermissionBanner } from "@/components/app/FeedsPermissionBanner";
import { FeedsPostDetailModal } from "@/components/app/FeedsPostDetailModal";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { apiRoutes, resolveSameOriginUrl } from "@/lib/config";
import { isFeedPostVideo } from "@/lib/feedsMedia";
import {
  hasInstagramPermissionIssue,
  instagramAccountMissingFeedPermissions,
} from "@/lib/feedsPermissions";
import type {
  ChannelPlatform,
  FeedPost,
  FeedPostLinkResponse,
  FeedPostLinkedInventory,
  FeedPostResponse,
  FeedsResponse,
  PlatformFeed,
} from "@/lib/types";

type FeedsPageProps = {
  /** Trans Chap uses a vertical Instagram Reels-style scroller. */
  variant?: "grid" | "reels";
};

function formatPostDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function mediaTypeLabel(type: string): string {
  const normalized = type.toUpperCase();
  if (normalized === "VIDEO" || normalized === "REELS") return "Video";
  if (normalized === "CAROUSEL_ALBUM") return "Carousel";
  return "Photo";
}

export default function FeedsPage({ variant = "grid" }: FeedsPageProps) {
  const reduce = useReducedMotion();
  const isReels = variant === "reels";
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<FeedsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<ChannelPlatform | "all">("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [linkTarget, setLinkTarget] = useState<FeedPost | null>(null);
  const [viewTarget, setViewTarget] = useState<{
    post: FeedPost;
    feed: PlatformFeed;
  } | null>(null);
  const [detailPermissionIssue, setDetailPermissionIssue] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("compose") !== "1") return;
    setComposeOpen(true);
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiFetch<FeedsResponse>(apiRoutes.feeds);
      setData(next);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load feeds."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connectedFeeds = useMemo(
    () => (data?.feeds ?? []).filter((f) => f.connected),
    [data],
  );

  const canPostToInstagram = useMemo(
    () =>
      connectedFeeds.some(
        (feed) => feed.platform === "instagram" && feed.connected,
      ),
    [connectedFeeds],
  );

  const instagramFeed = useMemo(
    () => connectedFeeds.find((feed) => feed.platform === "instagram"),
    [connectedFeeds],
  );

  const instagramConnectUrl = instagramFeed?.connect_url ?? null;

  const feedPermissionIssue = useMemo(
    () =>
      hasInstagramPermissionIssue(instagramFeed?.error) ||
      instagramAccountMissingFeedPermissions(
        instagramFeed?.account?.granted_permissions,
      ),
    [instagramFeed?.account?.granted_permissions, instagramFeed?.error],
  );

  const showPermissionBanner = feedPermissionIssue || detailPermissionIssue;

  function handlePosted(result: FeedPostResponse) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        feeds: prev.feeds.map((feed) =>
          feed.platform === result.platform
            ? {
                ...feed,
                posts: [
                  { ...result.post, linked_inventory: result.post.linked_inventory ?? [] },
                  ...feed.posts.filter((post) => post.id !== result.post.id),
                ],
                error: null,
              }
            : feed,
        ),
      };
    });
  }

  function updatePostLink(
    post: FeedPost,
    linked: FeedPostLinkedInventory[],
  ) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        feeds: prev.feeds.map((feed) =>
          feed.platform !== post.platform
            ? feed
            : {
                ...feed,
                posts: feed.posts.map((item) =>
                  item.id === post.id
                    ? { ...item, linked_inventory: linked }
                    : item,
                ),
              },
        ),
      };
    });
  }

  async function handleUnlink(post: FeedPost, inventoryItemId: string) {
    const linked = post.linked_inventory.find(
      (item) => item.inventory_item_id === inventoryItemId,
    );
    const confirmed = await confirmAction(
      "Unlink this product?",
      linked
        ? `"${linked.product_name}" will no longer be tied to this post.`
        : "The post will stay on Instagram, but it will no longer be tied to this inventory item.",
      "Yes, unlink",
    );
    if (!confirmed) return;
    try {
      const res = await apiFetch<FeedPostLinkResponse>(
        apiRoutes.feedsPostLink(post.platform, post.id, inventoryItemId),
        { method: "DELETE" },
      );
      updatePostLink(post, res.linked_inventory);
      setLinkTarget((current) =>
        current && current.id === post.id
          ? { ...current, linked_inventory: res.linked_inventory }
          : current,
      );
      setViewTarget((current) =>
        current && current.post.id === post.id
          ? {
              ...current,
              post: { ...current.post, linked_inventory: res.linked_inventory },
            }
          : current,
      );
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not unlink product", extractErrorMessage(err));
    }
  }

  const visibleFeeds = useMemo(() => {
    const feeds = data?.feeds ?? [];
    if (activePlatform === "all") {
      return connectedFeeds.length > 0 ? connectedFeeds : feeds;
    }
    return feeds.filter((f) => f.platform === activePlatform);
  }, [data, activePlatform, connectedFeeds]);

  const allPosts = useMemo(() => {
    if (activePlatform === "all") {
      return connectedFeeds.flatMap((f) =>
        f.posts.map((p) => ({ ...p, feed: f })),
      );
    }
    const feed = visibleFeeds[0];
    return feed ? feed.posts.map((p) => ({ ...p, feed })) : [];
  }, [activePlatform, connectedFeeds, visibleFeeds]);

  async function loadMore(feed: PlatformFeed) {
    if (!feed.next_cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await apiFetch<FeedsResponse>(
        apiRoutes.feedsPlatform(feed.platform, feed.next_cursor),
      );
      const updated = next.feeds.find((f) => f.platform === feed.platform);
      if (!updated) return;
      setData((prev) => {
        if (!prev) return next;
        return {
          ...prev,
          feeds: prev.feeds.map((f) =>
            f.platform === feed.platform
              ? {
                  ...f,
                  posts: [...f.posts, ...updated.posts],
                  next_cursor: updated.next_cursor,
                  error: updated.error,
                }
              : f,
          ),
        };
      });
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load more posts."));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return <FeedsSkeleton reels={isReels} />;
  }

  if (error && !data) {
    return (
      <section className={`feeds-page${isReels ? " feeds-page--reels" : ""}`}>
        {!isReels ? (
          <header className="feeds-header">
            <h1 className="app-title">Feeds</h1>
            <p className="app-lead">Posts from your connected social channels.</p>
          </header>
        ) : null}
        <div className="app-error">{error}</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload()}>
          Try again
        </button>
      </section>
    );
  }

  if (!data?.any_connected) {
    return <FeedsEmptyState />;
  }

  const platformTabs: Array<{ key: ChannelPlatform | "all"; label: string }> = [
    { key: "all", label: "All channels" },
    ...connectedFeeds.map((f) => ({ key: f.platform, label: f.label })),
  ];

  const reelsEmpty =
    activePlatform === "all" ? (
      <AllChannelsEmpty
        feeds={connectedFeeds}
        canPost={canPostToInstagram}
        onCompose={() => setComposeOpen(true)}
      />
    ) : (
      <SingleChannelEmpty
        feed={visibleFeeds[0]}
        canPost={canPostToInstagram}
        onCompose={() => setComposeOpen(true)}
      />
    );

  return (
    <section className={`feeds-page${isReels ? " feeds-page--reels" : ""}`}>
      {isReels ? (
        <div className="feeds-reels-chrome">
          <div className="feeds-reels-chrome__nav">
            <FeedsSubNav />
          </div>
          <div className="feeds-reels-chrome__actions">
            <button
              type="button"
              className="feeds-reels-chrome__btn"
              onClick={() => void reload()}
              aria-label="Refresh feeds"
            >
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="feeds-header">
            <div>
              <h1 className="app-title">Feeds</h1>
              <p className="app-lead">
                Recent posts from the social channels linked in Settings.
              </p>
            </div>
            <div className="feeds-header__actions">
              {canPostToInstagram ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setComposeOpen(true)}
                  disabled={posting}
                >
                  <i className="fa-brands fa-instagram" aria-hidden="true" />
                  New post
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void reload()}
                aria-label="Refresh feeds"
              >
                <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                Refresh
              </button>
            </div>
          </header>

          <div className="feeds-page-nav">
            <FeedsSubNav />
          </div>
        </>
      )}

      {showPermissionBanner ? (
        <div className={isReels ? "feeds-reels-banner" : undefined}>
          <FeedsPermissionBanner connectUrl={instagramConnectUrl} />
        </div>
      ) : null}

      <FeedsComposeModal
        open={composeOpen}
        posting={posting}
        onClose={() => (posting ? undefined : setComposeOpen(false))}
        onPosted={handlePosted}
        onPostingChange={setPosting}
      />

      <FeedsLinkProductModal
        open={linkTarget !== null}
        post={linkTarget}
        onClose={() => setLinkTarget(null)}
        onUnlink={(inventoryItemId) => {
          if (linkTarget) void handleUnlink(linkTarget, inventoryItemId);
        }}
        onLinked={(post, linked) => {
          updatePostLink(post, linked);
          setLinkTarget((current) =>
            current && current.id === post.id
              ? { ...current, linked_inventory: linked }
              : current,
          );
          setViewTarget((current) =>
            current && current.post.id === post.id
              ? {
                  ...current,
                  post: { ...current.post, linked_inventory: linked },
                }
              : current,
          );
        }}
      />

      <FeedsPostDetailModal
        open={viewTarget !== null}
        post={viewTarget?.post ?? null}
        feed={viewTarget?.feed ?? null}
        connectUrl={instagramConnectUrl}
        onClose={() => {
          setViewTarget(null);
          setDetailPermissionIssue(false);
        }}
        onLink={() => {
          if (viewTarget) setLinkTarget(viewTarget.post);
        }}
        onUnlink={(inventoryItemId) => {
          if (viewTarget) void handleUnlink(viewTarget.post, inventoryItemId);
        }}
        onPermissionIssue={setDetailPermissionIssue}
        onDetailLoaded={(updated) => {
          if (!viewTarget) return;
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              feeds: prev.feeds.map((feed) =>
                feed.platform !== updated.platform
                  ? feed
                  : {
                      ...feed,
                      posts: feed.posts.map((item) =>
                        item.id === updated.id ? { ...item, ...updated } : item,
                      ),
                    },
              ),
            };
          });
          setViewTarget((current) =>
            current ? { ...current, post: { ...current.post, ...updated } } : current,
          );
        }}
      />

      {isReels ? (
        <FeedsReelsView
          posts={
            activePlatform === "all"
              ? allPosts
              : (() => {
                  const feed = visibleFeeds[0];
                  return feed ? feed.posts.map((p) => ({ ...p, feed })) : [];
                })()
          }
          feeds={activePlatform === "all" ? connectedFeeds : visibleFeeds}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onLinkPost={setLinkTarget}
          onViewPost={(post, feed) => setViewTarget({ post, feed })}
          emptyState={reelsEmpty}
        />
      ) : (
        <>
          {platformTabs.length > 1 ? (
            <div className="feeds-tabs" role="tablist" aria-label="Filter by channel">
              {platformTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activePlatform === tab.key}
                  className={`feeds-tab${activePlatform === tab.key ? " is-active" : ""}`}
                  onClick={() => setActivePlatform(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}

          {activePlatform === "all" ? (
            <AllChannelsView
              feeds={connectedFeeds}
              posts={allPosts}
              reduce={!!reduce}
              onLoadMore={loadMore}
              loadingMore={loadingMore}
              onLinkPost={setLinkTarget}
              onViewPost={(post, feed) => setViewTarget({ post, feed })}
            />
          ) : (
            <SingleChannelView
              feed={visibleFeeds[0]}
              reduce={!!reduce}
              onLoadMore={loadMore}
              loadingMore={loadingMore}
              onLinkPost={setLinkTarget}
              onViewPost={(post, feed) => setViewTarget({ post, feed })}
            />
          )}
        </>
      )}
    </section>
  );
}

function AllChannelsEmpty({
  feeds,
  canPost = false,
  onCompose,
}: {
  feeds: PlatformFeed[];
  canPost?: boolean;
  onCompose?: () => void;
}) {
  const fetchableFeeds = feeds.filter((f) => f.can_fetch);
  const hasErrors = fetchableFeeds.some((f) => f.error);

  return (
    <div className="feeds-empty feeds-empty--small">
      {hasErrors ? (
        <>
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          <h2>Could not load posts</h2>
          <p>
            {fetchableFeeds.find((f) => f.error)?.error ??
              "Check your channel connection and try again."}
          </p>
        </>
      ) : (
        <>
          <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
          <h2>No posts yet</h2>
          <p>Upload a photo or video to publish it to Instagram from here.</p>
          {canPost && onCompose ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onCompose}>
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Upload a post
            </button>
          ) : (
            <p>
              Tap the <strong>+</strong> button in the menu, then choose{" "}
              <strong>New post</strong>.
            </p>
          )}
        </>
      )}
      <ChannelStatusList feeds={feeds} />
    </div>
  );
}

function SingleChannelEmpty({
  feed,
  canPost = false,
  onCompose,
}: {
  feed: PlatformFeed | undefined;
  canPost?: boolean;
  onCompose?: () => void;
}) {
  if (!feed) {
    return (
      <div className="feeds-empty feeds-empty--small">
        <p>Channel not found.</p>
      </div>
    );
  }

  if (!feed.connected) {
    return (
      <div className="feeds-empty feeds-empty--small">
        <p>{feed.status_text}</p>
        <Link href="/settings#section-channels" className="btn btn-primary btn-sm">
          Connect in Settings
        </Link>
      </div>
    );
  }

  if (!feed.can_fetch) {
    return (
      <div className="feeds-platform-banner" style={{ borderColor: feed.color }}>
        <div className="feeds-platform-banner__icon" style={{ background: feed.color }}>
          <i className={feed.icon} aria-hidden="true" />
        </div>
        <div>
          <h2>{feed.label}</h2>
          <p>{feed.status_text ?? "Feed sync coming soon for this platform."}</p>
          {feed.account?.username ? (
            <p className="feeds-platform-banner__handle">@{feed.account.username}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (feed.error && feed.posts.length === 0) {
    return (
      <div className="feeds-empty feeds-empty--small">
        <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
        <h2>Could not load {feed.label} posts</h2>
        <p>{feed.error}</p>
        {feed.connect_url ? (
          <a
            href={resolveSameOriginUrl(feed.connect_url)}
            className="btn btn-primary btn-sm"
          >
            Reconnect with Meta
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="feeds-empty feeds-empty--small">
      <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
      <h2>No posts on {feed.label}</h2>
      <p>Upload a photo or video to publish it from Feeds.</p>
      {canPost && onCompose ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onCompose}>
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Upload a post
        </button>
      ) : null}
    </div>
  );
}

function AllChannelsView({
  feeds,
  posts,
  reduce,
  onLoadMore,
  loadingMore,
  onLinkPost,
  onViewPost,
}: {
  feeds: PlatformFeed[];
  posts: Array<FeedPost & { feed: PlatformFeed }>;
  reduce: boolean;
  onLoadMore: (feed: PlatformFeed) => void;
  loadingMore: boolean;
  onLinkPost: (post: FeedPost) => void;
  onViewPost: (post: FeedPost, feed: PlatformFeed) => void;
}) {
  const sorted = [...posts].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  if (sorted.length === 0) {
    return <AllChannelsEmpty feeds={feeds} />;
  }

  return (
    <>
      <motion.div
        className="feeds-grid"
        variants={reduce ? undefined : staggerContainer}
        initial={reduce ? undefined : "hidden"}
        animate={reduce ? undefined : "visible"}
      >
        {sorted.map((post) => (
          <motion.div key={`${post.platform}-${post.id}`} variants={reduce ? undefined : staggerItem}>
            <FeedPostCard
              post={post}
              feed={post.feed}
              onLink={() => onLinkPost(post)}
              onView={() => onViewPost(post, post.feed)}
            />
          </motion.div>
        ))}
      </motion.div>
      <LoadMoreButtons feeds={feeds} onLoadMore={onLoadMore} loadingMore={loadingMore} />
    </>
  );
}

function SingleChannelView({
  feed,
  reduce,
  onLoadMore,
  loadingMore,
  onLinkPost,
  onViewPost,
}: {
  feed: PlatformFeed | undefined;
  reduce: boolean;
  onLoadMore: (feed: PlatformFeed) => void;
  loadingMore: boolean;
  onLinkPost: (post: FeedPost) => void;
  onViewPost: (post: FeedPost, feed: PlatformFeed) => void;
}) {
  if (!feed || !feed.connected || !feed.can_fetch || (feed.error && feed.posts.length === 0) || feed.posts.length === 0) {
    return <SingleChannelEmpty feed={feed} />;
  }

  return (
    <>
      <motion.div
        className="feeds-grid"
        variants={reduce ? undefined : staggerContainer}
        initial={reduce ? undefined : "hidden"}
        animate={reduce ? undefined : "visible"}
      >
        {feed.posts.map((post) => (
          <motion.div key={post.id} variants={reduce ? undefined : staggerItem}>
            <FeedPostCard
              post={post}
              feed={feed}
              onLink={() => onLinkPost(post)}
              onView={() => onViewPost(post, feed)}
            />
          </motion.div>
        ))}
      </motion.div>
      {feed.next_cursor ? (
        <div className="feeds-load-more">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={loadingMore}
            onClick={() => void onLoadMore(feed)}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function LoadMoreButtons({
  feeds,
  onLoadMore,
  loadingMore,
}: {
  feeds: PlatformFeed[];
  onLoadMore: (feed: PlatformFeed) => void;
  loadingMore: boolean;
}) {
  const withMore = feeds.filter((f) => f.next_cursor);
  if (withMore.length === 0) return null;
  return (
    <div className="feeds-load-more">
      {withMore.map((feed) => (
        <button
          key={feed.platform}
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={loadingMore}
          onClick={() => void onLoadMore(feed)}
        >
          {loadingMore ? "Loading…" : `Load more ${feed.label}`}
        </button>
      ))}
    </div>
  );
}

function ChannelStatusList({ feeds }: { feeds: PlatformFeed[] }) {
  const pending = feeds.filter((f) => !f.can_fetch);
  if (pending.length === 0) return null;
  return (
    <div className="feeds-channel-status">
      {pending.map((feed) => (
        <div key={feed.platform} className="feeds-channel-status__row">
          <span className="feeds-channel-status__icon" style={{ background: feed.color }}>
            <i className={feed.icon} aria-hidden="true" />
          </span>
          <span>
            <strong>{feed.label}</strong>
            <span className="feeds-channel-status__text">
              {feed.status_text ?? "Coming soon"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FeedPostCard({
  post,
  feed,
  onLink,
  onView,
}: {
  post: FeedPost;
  feed: PlatformFeed;
  onLink: () => void;
  onView: () => void;
}) {
  const caption = post.caption?.trim();
  const shortCaption =
    caption && caption.length > 120 ? `${caption.slice(0, 117)}…` : caption;
  const linked = post.linked_inventory ?? [];
  const isVideo = isFeedPostVideo(post);

  return (
    <article className={`feeds-card${isVideo ? " feeds-card--video" : ""}`}>
      <div className="feeds-card__media">
        <FeedPostMedia
          post={post}
          alt={shortCaption || `${feed.label} post`}
          interactive={isVideo}
        />
        <span className="feeds-card__type">{mediaTypeLabel(post.media_type)}</span>
      </div>
      <div className="feeds-card__body">
        <div className="feeds-card__meta">
          <span className="feeds-card__platform" style={{ color: feed.color }}>
            <i className={feed.icon} aria-hidden="true" />
            {feed.account?.username ? `@${feed.account.username}` : feed.label}
          </span>
          {post.timestamp ? (
            <time className="feeds-card__date" dateTime={post.timestamp}>
              {formatPostDate(post.timestamp)}
            </time>
          ) : null}
        </div>
        {shortCaption ? <p className="feeds-card__caption">{shortCaption}</p> : null}

        {linked.length > 0 ? (
          <p className="feeds-card__linked-count">
            <i className="fa-solid fa-link" aria-hidden="true" />{" "}
            {linked.length} product{linked.length === 1 ? "" : "s"} linked
          </p>
        ) : null}

        <div className="feeds-card__stats">
          {post.like_count != null ? (
            <span>
              <i className="fa-solid fa-heart" aria-hidden="true" /> {post.like_count}
            </span>
          ) : null}
          {post.comments_count != null ? (
            <span>
              <i className="fa-solid fa-comment" aria-hidden="true" /> {post.comments_count}
            </span>
          ) : null}
        </div>

        <div className="feeds-card__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onView}>
            <i className="fa-solid fa-eye" aria-hidden="true" />
            View
          </button>
          {linked.length > 0 ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onLink}
              >
                <i className="fa-solid fa-link" aria-hidden="true" />
                Add product
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onLink}
            >
              <i className="fa-solid fa-link" aria-hidden="true" />
              Link product
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function FeedsSkeleton({ reels = false }: { reels?: boolean }) {
  if (reels) {
    return (
      <section className="feeds-page feeds-page--reels" aria-busy="true" aria-live="polite">
        <div className="feeds-reel feeds-reel--skeleton">
          <Skeleton variant="rect" height="100%" />
        </div>
      </section>
    );
  }

  const items = Array.from({ length: 6 });
  return (
    <section className="feeds-page" aria-busy="true" aria-live="polite">
      <header className="feeds-header">
        <div>
          <Skeleton variant="text" height={28} width={120} />
          <Skeleton variant="text" height={16} width={280} />
        </div>
      </header>
      <div className="feeds-grid">
        {items.map((_, i) => (
          <div key={i} className="feeds-card feeds-card--skeleton">
            <Skeleton variant="rect" height={200} />
            <div className="feeds-card__body">
              <Skeleton variant="text" height={12} width="40%" />
              <Skeleton variant="text" height={14} width="90%" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedsEmptyState() {
  return (
    <div className="messages-empty">
      <div className="messages-empty__card">
        <div className="messages-empty__icon" aria-hidden="true">
          <i className="fa-solid fa-images" />
        </div>
        <h1>Connect a channel to see your feed</h1>
        <p className="messages-empty__lead">
          Link Instagram, Facebook, WhatsApp, or TikTok in Settings. Once connected,
          posts from channels that support feed sync will appear here.
        </p>
        <p className="messages-empty__footer">
          <Link href="/settings#section-channels" className="btn btn-primary btn-sm">
            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            Go to channel settings
          </Link>
        </p>
      </div>
    </div>
  );
}
