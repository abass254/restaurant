"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FeedPostMedia } from "@/components/app/FeedPostMedia";
import { FeedsComposeModal } from "@/components/app/FeedsComposeModal";
import { FeedsLinkProductModal } from "@/components/app/FeedsLinkProductModal";
import { FeedsPermissionBanner } from "@/components/app/FeedsPermissionBanner";
import { FeedsPostDetailModal } from "@/components/app/FeedsPostDetailModal";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes, resolveSameOriginUrl } from "@/lib/config";
import { isFeedPostVideo } from "@/lib/feedsMedia";
import {
  hasInstagramPermissionIssue,
  instagramAccountMissingFeedPermissions,
} from "@/lib/feedsPermissions";
import type {
  FeedPost,
  FeedPostLinkResponse,
  FeedPostLinkedInventory,
  FeedPostResponse,
  FeedsResponse,
  PlatformFeed,
} from "@/lib/types";

function profileInitials(name: string | null | undefined, username: string | null | undefined) {
  const source = (name || username || "IG").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

export function TransChapFeedsProfile() {
  const router = useRouter();
  const [data, setData] = useState<FeedsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    router.replace("/trans-chap/feeds/new");
  }, [router]);

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

  const feed = useMemo(
    () => (data?.feeds ?? []).find((item) => item.platform === "instagram" && item.connected) ?? null,
    [data],
  );

  const account = feed?.account ?? null;
  const username = account?.username ?? null;
  const displayName = account?.name || username || "Instagram";
  const posts = feed?.posts ?? [];

  const stats = useMemo(() => {
    const likes = posts.reduce((sum, post) => sum + (post.like_count ?? 0), 0);
    const comments = posts.reduce((sum, post) => sum + (post.comments_count ?? 0), 0);
    return {
      posts: posts.length,
      likes,
      comments,
      interactions: likes + comments,
    };
  }, [posts]);

  const feedPermissionIssue = useMemo(
    () =>
      hasInstagramPermissionIssue(feed?.error) ||
      instagramAccountMissingFeedPermissions(account?.granted_permissions),
    [account?.granted_permissions, feed?.error],
  );
  const showPermissionBanner = feedPermissionIssue || detailPermissionIssue;

  function handlePosted(result: FeedPostResponse) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        feeds: prev.feeds.map((item) =>
          item.platform === result.platform
            ? {
                ...item,
                posts: [
                  {
                    ...result.post,
                    linked_inventory: result.post.linked_inventory ?? [],
                  },
                  ...item.posts.filter((post) => post.id !== result.post.id),
                ],
                error: null,
              }
            : item,
        ),
      };
    });
  }

  function updatePostLink(post: FeedPost, linked: FeedPostLinkedInventory[]) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        feeds: prev.feeds.map((item) =>
          item.platform !== post.platform
            ? item
            : {
                ...item,
                posts: item.posts.map((row) =>
                  row.id === post.id ? { ...row, linked_inventory: linked } : row,
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

  async function loadMore() {
    if (!feed?.next_cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await apiFetch<FeedsResponse>(
        apiRoutes.feedsPlatform(feed.platform, feed.next_cursor),
      );
      const updated = next.feeds.find((item) => item.platform === feed.platform);
      if (!updated) return;
      setData((prev) => {
        if (!prev) return next;
        return {
          ...prev,
          feeds: prev.feeds.map((item) =>
            item.platform === feed.platform
              ? {
                  ...item,
                  posts: [...item.posts, ...updated.posts],
                  next_cursor: updated.next_cursor,
                  error: updated.error,
                }
              : item,
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
    return (
      <div className="ig-profile" aria-busy="true">
        <div className="ig-profile__header">
          <div className="ig-profile__avatar ig-profile__avatar--skeleton" />
          <div className="ig-profile__stats">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="ig-profile__grid ig-profile__grid--skeleton">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="ig-profile__tile" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ig-profile ig-profile--empty">
        <p className="app-error">{error}</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }

  if (!feed) {
    return (
      <div className="ig-profile ig-profile--empty">
        <i className="fa-brands fa-instagram" aria-hidden />
        <h2>Connect Instagram</h2>
        <p>Link your Instagram account in Settings to see your profile grid here.</p>
        <Link href="/trans-chap/settings" className="btn btn-primary btn-sm">
          Open settings
        </Link>
      </div>
    );
  }

  return (
    <div className="ig-profile">
      {showPermissionBanner ? (
        <div className="ig-profile__banner">
          <FeedsPermissionBanner connectUrl={feed.connect_url} />
        </div>
      ) : null}

      <header className="ig-profile__header">
        <div className="ig-profile__identity">
          <div className="ig-profile__avatar" aria-hidden>
            {profileInitials(account?.name, username)}
          </div>
          <div className="ig-profile__who">
            <h1>{username ? `@${username}` : displayName}</h1>
            {account?.name && username ? <p>{account.name}</p> : null}
            {account?.account_type ? (
              <span className="ig-profile__badge">{account.account_type}</span>
            ) : null}
          </div>
        </div>

        <dl className="ig-profile__stats">
          <div>
            <dt>Posts</dt>
            <dd>{formatCount(stats.posts)}</dd>
          </div>
          <div>
            <dt>Likes</dt>
            <dd>{formatCount(stats.likes)}</dd>
          </div>
          <div>
            <dt>Comments</dt>
            <dd>{formatCount(stats.comments)}</dd>
          </div>
        </dl>

        <div className="ig-profile__actions">
          <button
            type="button"
            className="ig-profile__btn ig-profile__btn--primary"
            onClick={() => router.push("/trans-chap/feeds/new")}
            disabled={posting}
          >
            <i className="fa-solid fa-plus" aria-hidden />
            New post
          </button>
          <Link href="/trans-chap/settings" className="ig-profile__btn">
            Edit profile
          </Link>
          <button
            type="button"
            className="ig-profile__btn ig-profile__btn--icon"
            onClick={() => void reload()}
            aria-label="Refresh posts"
          >
            <i className="fa-solid fa-rotate-right" aria-hidden />
          </button>
        </div>
      </header>

      <div className="ig-profile__tabs" role="tablist" aria-label="Profile sections">
        <button type="button" className="is-active" role="tab" aria-selected>
          <i className="fa-solid fa-table-cells" aria-hidden />
          Posts
        </button>
      </div>

      {feed.error && posts.length === 0 ? (
        <div className="ig-profile--empty">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden />
          <h2>Could not load posts</h2>
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
      ) : posts.length === 0 ? (
        <div className="ig-profile--empty">
          <i className="fa-solid fa-camera" aria-hidden />
          <h2>No posts yet</h2>
          <p>Share a photo or Reel to see it on your profile grid.</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => router.push("/trans-chap/feeds/new")}
          >
            <i className="fa-solid fa-plus" aria-hidden />
            New post
          </button>
        </div>
      ) : (
        <>
          <div className="ig-profile__grid" role="list">
            {posts.map((post) => {
              const isVideo = isFeedPostVideo(post);
              const isCarousel = post.media_type?.toUpperCase() === "CAROUSEL_ALBUM";
              return (
                <button
                  key={post.id}
                  type="button"
                  className="ig-profile__tile"
                  role="listitem"
                  onClick={() => setViewTarget({ post, feed })}
                  aria-label={
                    isVideo ? "Open video post" : isCarousel ? "Open carousel post" : "Open photo post"
                  }
                >
                  <FeedPostMedia
                    post={post}
                    alt=""
                    className="ig-profile__media"
                  />
                  {isVideo || isCarousel ? (
                    <span className="ig-profile__tile-badge" aria-hidden>
                      <i
                        className={`fa-solid ${isCarousel ? "fa-clone" : "fa-play"}`}
                      />
                    </span>
                  ) : null}
                  {(post.like_count != null || post.comments_count != null) ? (
                    <span className="ig-profile__tile-hover" aria-hidden>
                      <span>
                        <i className="fa-solid fa-heart" />
                        {formatCount(post.like_count ?? 0)}
                      </span>
                      <span>
                        <i className="fa-solid fa-comment" />
                        {formatCount(post.comments_count ?? 0)}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {feed.next_cursor ? (
            <div className="ig-profile__more">
              <button
                type="button"
                className="ig-profile__btn"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}

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
        connectUrl={feed.connect_url}
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
              feeds: prev.feeds.map((item) =>
                item.platform !== updated.platform
                  ? item
                  : {
                      ...item,
                      posts: item.posts.map((row) =>
                        row.id === updated.id ? { ...row, ...updated } : row,
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
    </div>
  );
}
