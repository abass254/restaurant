"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FeedPostMedia } from "@/components/app/FeedPostMedia";
import { FeedsPermissionBanner } from "@/components/app/FeedsPermissionBanner";
import { FeedsPostInsightsPanel } from "@/components/app/FeedsPostInsightsPanel";
import { MotionModal } from "@/components/app/MotionModal";
import { Skeleton } from "@/components/app/Skeleton";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { isFeedPostVideo } from "@/lib/feedsMedia";
import { hasInstagramPermissionIssue } from "@/lib/feedsPermissions";
import type {
  FeedPost,
  FeedPostComment,
  FeedPostCommentsResponse,
  FeedPostDetailResponse,
  FeedPostInsightsResponse,
  PlatformFeed,
} from "@/lib/types";

type FeedsPostDetailModalProps = {
  open: boolean;
  post: FeedPost | null;
  feed: PlatformFeed | null;
  connectUrl: string | null;
  onClose: () => void;
  onLink: () => void;
  onUnlink: (inventoryItemId: string) => void;
  onPermissionIssue?: (value: boolean) => void;
  onDetailLoaded?: (post: FeedPost) => void;
};

function formatPostDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mediaTypeLabel(type: string): string {
  const normalized = type.toUpperCase();
  if (normalized === "VIDEO" || normalized === "REELS") return "Video";
  if (normalized === "CAROUSEL_ALBUM") return "Carousel";
  return "Photo";
}

function CommentRow({ comment, nested = false }: { comment: FeedPostComment; nested?: boolean }) {
  return (
    <li className={`feeds-detail-comment${nested ? " feeds-detail-comment--reply" : ""}`}>
      <div className="feeds-detail-comment__head">
        <strong>{comment.username ? `@${comment.username}` : "Instagram user"}</strong>
        {comment.timestamp ? (
          <time className="app-muted" dateTime={comment.timestamp}>
            {formatPostDate(comment.timestamp)}
          </time>
        ) : null}
      </div>
      {comment.text ? <p>{comment.text}</p> : null}
      {comment.replies.length > 0 ? (
        <ul className="feeds-detail-comment__replies">
          {comment.replies.map((reply) => (
            <CommentRow key={reply.id} comment={reply} nested />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FeedsPostDetailModal({
  open,
  post,
  feed,
  connectUrl,
  onClose,
  onLink,
  onUnlink,
  onPermissionIssue,
  onDetailLoaded,
}: FeedsPostDetailModalProps) {
  const [detail, setDetail] = useState<FeedPostDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    if (!post) return;
    setInsightsLoading(true);
    try {
      const next = await apiFetch<FeedPostInsightsResponse>(
        apiRoutes.feedsPostInsights(post.platform, post.id),
      );
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              post: { ...prev.post, ...next.post },
              insights: next.insights,
              insights_error: next.insights_error,
              media_error: prev.media_error ?? next.media_error,
            }
          : prev,
      );
      onPermissionIssue?.(hasInstagramPermissionIssue(next.insights_error, null));
      onDetailLoaded?.(next.post);
    } catch (err) {
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              insights_error: extractErrorMessage(err, "Could not load post insights."),
            }
          : prev,
      );
    } finally {
      setInsightsLoading(false);
    }
  }, [post?.id, post?.platform, onDetailLoaded, onPermissionIssue]);

  const loadDetail = useCallback(
    async (opts?: { append?: boolean; after?: string | null }) => {
      if (!post) return;
      const append = opts?.append ?? false;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const url = apiRoutes.feedsPostDetail(
          post.platform,
          post.id,
          append ? opts?.after ?? undefined : undefined,
        );
        if (append) {
          const next = await apiFetch<FeedPostCommentsResponse>(url);
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  comments: [...prev.comments, ...next.comments],
                  next_comment_cursor: next.next_comment_cursor,
                  comments_error: next.comments_error,
                }
              : prev,
          );
        } else {
          const next = await apiFetch<FeedPostDetailResponse>(url);
          setDetail(next);
          setError(null);
          onPermissionIssue?.(hasInstagramPermissionIssue(null, next.comments_error));
          onDetailLoaded?.(next.post);
        }
      } catch (err) {
        if (!append) {
          setError(extractErrorMessage(err, "Could not load post interactions."));
          setDetail(null);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [post?.id, post?.platform, onDetailLoaded, onPermissionIssue],
  );

  useEffect(() => {
    if (!open || !post) {
      setDetail(null);
      setError(null);
      setInsightsLoading(false);
      return;
    }
    void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the selected post changes
  }, [open, post?.id, post?.platform]);

  useEffect(() => {
    if (!open || !post || loading || !detail || detail.post.id !== post.id) return;
    void loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch insights once per opened post
  }, [open, post?.id, post?.platform, loading, detail?.post.id]);

  if (!post || !feed) return null;

  const livePost = detail?.post ?? post;
  const linked = livePost.linked_inventory ?? [];
  const showPermissionBanner = hasInstagramPermissionIssue(
    detail?.insights_error,
    detail?.comments_error,
  );
  const isVideo = isFeedPostVideo(livePost);

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Post interactions"
      panelClassName="inventory-modal--wide feeds-detail-modal"
    >
      <header className="inventory-modal__head">
        <div>
          <h2>
            <i className={feed.icon} aria-hidden="true" style={{ color: feed.color }} />{" "}
            Post interactions
          </h2>
          <span className="app-muted">
            Live likes and comments from {feed.label}
            {feed.account?.username ? ` · @${feed.account.username}` : ""}.
          </span>
        </div>
        <button type="button" className="fb-icon-btn" aria-label="Close" onClick={onClose}>
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body feeds-detail-modal__body">
        {showPermissionBanner ? (
          <FeedsPermissionBanner connectUrl={connectUrl} compact />
        ) : null}

        {loading && !detail ? (
          <FeedsDetailSkeleton />
        ) : error && !detail ? (
          <div className="feeds-empty feeds-empty--small">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            <p>{error}</p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void loadDetail()}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="feeds-detail-layout">
              <div className={`feeds-detail-media${isVideo ? " feeds-detail-media--video" : ""}`}>
                <FeedPostMedia
                  post={livePost}
                  alt={livePost.caption || `${feed.label} post`}
                  interactive={isVideo}
                  loading="eager"
                />
                <span className="feeds-card__type">
                  {mediaTypeLabel(livePost.media_type)}
                </span>
              </div>

              <div className="feeds-detail-summary">
                <div className="feeds-detail-stats">
                  <span>
                    <i className="fa-solid fa-heart" aria-hidden="true" />{" "}
                    {livePost.like_count ?? 0} likes
                  </span>
                  <span>
                    <i className="fa-solid fa-comment" aria-hidden="true" />{" "}
                    {livePost.comments_count ?? detail?.comments.length ?? 0} comments
                  </span>
                  {livePost.timestamp ? (
                    <span className="app-muted">
                      <i className="fa-regular fa-clock" aria-hidden="true" />{" "}
                      {formatPostDate(livePost.timestamp)}
                    </span>
                  ) : null}
                </div>

                {livePost.caption ? (
                  <p className="feeds-detail-caption">{livePost.caption}</p>
                ) : null}

                {detail?.interactions_note ? (
                  <p className="app-muted feeds-detail-notice">{detail.interactions_note}</p>
                ) : null}

                {detail?.media_error ? (
                  <p className="app-muted feeds-detail-notice">
                    Some post details could not be refreshed from Instagram.
                  </p>
                ) : null}
              </div>
            </div>

            <section className="feeds-detail-linked" aria-label="Linked products">
              <div className="feeds-detail-linked__head">
                <h3>
                  <i className="fa-solid fa-link" aria-hidden="true" /> Linked products
                </h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onLink}>
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                  {linked.length > 0 ? "Add product" : "Link product"}
                </button>
              </div>

              {linked.length === 0 ? (
                <p className="app-muted">No inventory products linked to this post yet.</p>
              ) : (
                <ul className="feeds-link-list">
                  {linked.map((item) => (
                    <li key={item.inventory_item_id} className="feeds-link-list__item">
                      <Link
                        href={`/inventory/${item.inventory_item_id}`}
                        className="feeds-link-list__thumb"
                      >
                        {item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolveAssetUrl(item.image_url)}
                            alt={item.product_name}
                          />
                        ) : (
                          <i className="fa-solid fa-box" aria-hidden="true" />
                        )}
                      </Link>
                      <div className="feeds-link-list__copy">
                        <Link href={`/inventory/${item.inventory_item_id}`}>
                          <strong>{item.product_name}</strong>
                        </Link>
                        {item.product_code ? (
                          <span className="app-muted">{item.product_code}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Unlink ${item.product_name}`}
                        onClick={() => onUnlink(item.inventory_item_id)}
                      >
                        <i className="fa-solid fa-link-slash" aria-hidden="true" />
                        Unlink
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {insightsLoading ? (
              <section className="feeds-detail-insights" aria-label="Post insights">
                <h3>
                  <i className="fa-solid fa-chart-simple" aria-hidden="true" /> Insights
                </h3>
                <Skeleton variant="rect" height={120} />
              </section>
            ) : detail?.insights?.metrics?.length ? (
              <FeedsPostInsightsPanel metrics={detail.insights.metrics} />
            ) : detail?.insights_error ? (
              <p className="app-muted feeds-detail-notice">{detail.insights_error}</p>
            ) : null}

            <section className="feeds-detail-comments" aria-label="Comments">
              <h3>
                <i className="fa-solid fa-comments" aria-hidden="true" /> Comments
              </h3>

              {detail?.comments_error ? (
                <p className="app-muted feeds-detail-notice">{detail.comments_error}</p>
              ) : null}

              {!detail?.comments_error && (detail?.comments.length ?? 0) === 0 ? (
                <p className="app-muted">No comments yet.</p>
              ) : null}

              {(detail?.comments.length ?? 0) > 0 ? (
                <ul className="feeds-detail-comment-list">
                  {detail?.comments.map((comment) => (
                    <CommentRow key={comment.id} comment={comment} />
                  ))}
                </ul>
              ) : null}

              {detail?.next_comment_cursor ? (
                <div className="feeds-load-more">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={loadingMore}
                    onClick={() =>
                      void loadDetail({
                        append: true,
                        after: detail?.next_comment_cursor,
                      })
                    }
                  >
                    {loadingMore ? "Loading…" : "Load more comments"}
                  </button>
                </div>
              ) : null}
            </section>

            {livePost.permalink ? (
              <div className="feeds-detail-footer">
                <a
                  href={livePost.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  <i className="fa-brands fa-instagram" aria-hidden="true" />
                  Open on Instagram
                </a>
              </div>
            ) : null}
          </>
        )}
      </div>
    </MotionModal>
  );
}

function FeedsDetailSkeleton() {
  return (
    <div className="feeds-detail-layout">
      <Skeleton variant="rect" height={280} />
      <div>
        <Skeleton variant="text" height={16} width="60%" />
        <Skeleton variant="text" height={14} width="90%" />
        <Skeleton variant="text" height={14} width="80%" />
      </div>
    </div>
  );
}
