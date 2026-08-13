"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { FeedsAnalyticsSection } from "@/components/app/FeedsAnalyticsSection";
import { FeedsLinkProductModal } from "@/components/app/FeedsLinkProductModal";
import { FeedsPermissionBanner } from "@/components/app/FeedsPermissionBanner";
import { FeedsPostDetailModal } from "@/components/app/FeedsPostDetailModal";
import { FeedsSubNav } from "@/components/app/FeedsSubNav";
import { Skeleton } from "@/components/app/Skeleton";
import {
  hasInstagramPermissionIssue,
  instagramAccountMissingFeedPermissions,
} from "@/lib/feedsPermissions";
import type {
  ChannelPlatform,
  FeedPost,
  FeedPostLinkResponse,
  FeedPostLinkedInventory,
  FeedsResponse,
  PlatformFeed,
} from "@/lib/types";

export function FeedsAnalyticsDashboard() {
  const [data, setData] = useState<FeedsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<ChannelPlatform | "all">("all");
  const [linkTarget, setLinkTarget] = useState<FeedPost | null>(null);
  const [viewTarget, setViewTarget] = useState<{
    post: FeedPost;
    feed: PlatformFeed;
  } | null>(null);
  const [detailPermissionIssue, setDetailPermissionIssue] = useState(false);

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

  const hasInteractionData = useMemo(
    () =>
      allPosts.some(
        (post) => post.like_count != null || post.comments_count != null,
      ),
    [allPosts],
  );

  function updatePostLink(post: FeedPost, linked: FeedPostLinkedInventory[]) {
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
    } catch {
      // Post detail modal surfaces errors for unlink actions.
    }
  }

  if (loading) {
    return <FeedsAnalyticsSkeleton />;
  }

  if (error && !data) {
    return (
      <section className="feeds-page">
        <header className="feeds-header">
          <h1 className="app-title">Feed analytics</h1>
          <p className="app-lead">Top posts by likes and comments from your channels.</p>
        </header>
        <div className="feeds-page-nav">
          <FeedsSubNav />
        </div>
        <div className="app-error">{error}</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload()}>
          Try again
        </button>
      </section>
    );
  }

  if (!data?.any_connected) {
    return (
      <div className="messages-empty">
        <div className="messages-empty__card">
          <div className="messages-empty__icon" aria-hidden="true">
            <i className="fa-solid fa-chart-line" />
          </div>
          <h1>Connect a channel to see analytics</h1>
          <p className="messages-empty__lead">
            Link Instagram or other social channels in Settings. Once connected, post
            interaction analytics will appear here.
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

  const platformTabs: Array<{ key: ChannelPlatform | "all"; label: string }> = [
    { key: "all", label: "All channels" },
    ...connectedFeeds.map((f) => ({ key: f.platform, label: f.label })),
  ];

  return (
    <section className="feeds-page">
      <header className="feeds-header">
        <div>
          <h1 className="app-title">Feed analytics</h1>
          <p className="app-lead">
            Top posts by likes and comments from your connected channels.
          </p>
        </div>
        <div className="feeds-header__actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void reload()}
            aria-label="Refresh analytics"
          >
            <i className="fa-solid fa-rotate-right" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      <div className="feeds-page-nav">
        <FeedsSubNav />
      </div>

      {showPermissionBanner ? (
        <FeedsPermissionBanner connectUrl={instagramConnectUrl} />
      ) : null}

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

      <FeedsAnalyticsSection
        posts={allPosts}
        onViewPost={(post, feed) => setViewTarget({ post, feed })}
      />

      {!hasInteractionData ? (
        <div className="feeds-empty feeds-empty--small">
          <i className="fa-solid fa-chart-line" aria-hidden="true" />
          <h2>No interaction data yet</h2>
          <p>
            {allPosts.length > 0
              ? "Loaded posts do not have likes or comments yet. Try refreshing after your audience engages."
              : "Analytics appear once posts with likes or comments are loaded from your connected channels."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function FeedsAnalyticsSkeleton() {
  return (
    <section className="feeds-page" aria-busy="true" aria-live="polite">
      <header className="feeds-header">
        <div>
          <Skeleton variant="text" height={28} width={160} />
          <Skeleton variant="text" height={16} width={320} />
        </div>
      </header>
      <div className="feeds-page-nav">
        <FeedsSubNav />
      </div>
      <div className="feeds-analytics__summary">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="feeds-analytics__tile">
            <Skeleton variant="text" height={12} width="60%" />
            <Skeleton variant="text" height={24} width="40%" />
          </div>
        ))}
      </div>
    </section>
  );
}
