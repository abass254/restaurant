"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FeedPost, PlatformFeed } from "@/lib/types";

const TOP_LIMIT = 5;
const CHART_COLOR = "#e1306c";

type RankedPost = FeedPost & {
  feed: PlatformFeed;
  interactions: number;
  likes: number;
  comments: number;
};

type FeedsAnalyticsSectionProps = {
  posts: Array<FeedPost & { feed: PlatformFeed }>;
  onViewPost: (post: FeedPost, feed: PlatformFeed) => void;
};

function postInteractions(post: FeedPost): number | null {
  if (post.like_count == null && post.comments_count == null) return null;
  return (post.like_count ?? 0) + (post.comments_count ?? 0);
}

function captionPreview(caption: string | null, max = 48): string {
  const trimmed = caption?.trim();
  if (!trimmed) return "Untitled post";
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function formatPostDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function AnalyticsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label?: string; interactions?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="feeds-analytics__tooltip">
      <strong>{row.label}</strong>
      <span>{(row.interactions ?? 0).toLocaleString()} interactions</span>
    </div>
  );
}

export function FeedsAnalyticsSection({ posts, onViewPost }: FeedsAnalyticsSectionProps) {
  const ranked = useMemo(() => {
    const withScores: RankedPost[] = [];
    for (const post of posts) {
      const interactions = postInteractions(post);
      if (interactions == null) continue;
      withScores.push({
        ...post,
        interactions,
        likes: post.like_count ?? 0,
        comments: post.comments_count ?? 0,
      });
    }
    return withScores.sort((a, b) => {
      if (b.interactions !== a.interactions) return b.interactions - a.interactions;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      return tb - ta;
    });
  }, [posts]);

  const topPosts = ranked.slice(0, TOP_LIMIT);

  const summary = useMemo(() => {
    const total = ranked.reduce((sum, post) => sum + post.interactions, 0);
    return {
      total,
      average: ranked.length ? Math.round(total / ranked.length) : 0,
      tracked: ranked.length,
    };
  }, [ranked]);

  const chartData = useMemo(
    () =>
      topPosts.map((post, index) => ({
        key: `${post.platform}-${post.id}`,
        rank: `#${index + 1}`,
        label: captionPreview(post.caption, 32),
        interactions: post.interactions,
      })),
    [topPosts],
  );

  if (ranked.length === 0) return null;

  return (
    <section className="feeds-analytics" aria-label="Post interaction analytics">
      <header className="feeds-analytics__head">
        <div>
          <h2 className="feeds-analytics__title">
            <i className="fa-solid fa-chart-line" aria-hidden="true" /> Analytics
          </h2>
          <p className="feeds-analytics__lead">
            Top posts by likes and comments from your loaded feed.
          </p>
        </div>
      </header>

      <div className="feeds-analytics__summary">
        <article className="feeds-analytics__tile">
          <span>Total interactions</span>
          <strong>{summary.total.toLocaleString()}</strong>
          <small>{summary.tracked} posts tracked</small>
        </article>
        <article className="feeds-analytics__tile">
          <span>Average per post</span>
          <strong>{summary.average.toLocaleString()}</strong>
          <small>Across loaded posts</small>
        </article>
        <article className="feeds-analytics__tile">
          <span>Top post</span>
          <strong>{topPosts[0]?.interactions.toLocaleString() ?? "—"}</strong>
          <small>{topPosts[0] ? captionPreview(topPosts[0].caption, 28) : "—"}</small>
        </article>
      </div>

      <div className="feeds-analytics__grid">
        {chartData.length > 0 ? (
          <article className="feeds-analytics__card">
            <header className="feeds-analytics__card-head">
              <h3>Most interactions</h3>
              <p>Top {Math.min(TOP_LIMIT, ranked.length)} posts in this view</p>
            </header>
            <div className="feeds-analytics__chart">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--app-border-light)" />
                  <XAxis
                    dataKey="rank"
                    tick={{ fontSize: 12, fill: "var(--app-text-secondary)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: "var(--app-text-secondary)" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "var(--app-surface-hover)" }} />
                  <Bar dataKey="interactions" fill={CHART_COLOR} radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        ) : null}

        <article className="feeds-analytics__card">
          <header className="feeds-analytics__card-head">
            <h3>Ranked posts</h3>
            <p>Sorted by total likes and comments</p>
          </header>
          <ol className="feeds-analytics__list">
            {topPosts.map((post, index) => (
              <li key={`${post.platform}-${post.id}`}>
                <button
                  type="button"
                  className="feeds-analytics__row"
                  onClick={() => onViewPost(post, post.feed)}
                >
                  <span className="feeds-analytics__rank">{index + 1}</span>
                  <span className="feeds-analytics__thumb">
                    {post.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.image_url} alt="" loading="lazy" />
                    ) : (
                      <i className="fa-solid fa-image" aria-hidden="true" />
                    )}
                  </span>
                  <span className="feeds-analytics__copy">
                    <strong>{captionPreview(post.caption)}</strong>
                    <span className="feeds-analytics__meta">
                      <span style={{ color: post.feed.color }}>
                        <i className={post.feed.icon} aria-hidden="true" />
                        {post.feed.label}
                      </span>
                      {post.timestamp ? (
                        <time dateTime={post.timestamp}>{formatPostDate(post.timestamp)}</time>
                      ) : null}
                    </span>
                  </span>
                  <span className="feeds-analytics__stats">
                    <span title="Likes">
                      <i className="fa-solid fa-heart" aria-hidden="true" /> {post.likes.toLocaleString()}
                    </span>
                    <span title="Comments">
                      <i className="fa-solid fa-comment" aria-hidden="true" />{" "}
                      {post.comments.toLocaleString()}
                    </span>
                    <strong>{post.interactions.toLocaleString()}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}
