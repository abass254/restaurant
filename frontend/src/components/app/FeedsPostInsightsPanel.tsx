"use client";

import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { FeedPostInsightMetric } from "@/lib/types";

const CHART_COLORS = [
  "#e1306c",
  "#f77737",
  "#833ab4",
  "#5851db",
  "#10b981",
  "#0ea5e9",
  "#f59e0b",
  "#6366f1",
];

const NON_CHARTABLE_METRICS = new Set([
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
  "reels_skip_rate",
]);

const ENGAGEMENT_METRICS = new Set(["likes", "comments", "saved", "shares", "reposts"]);

const DISCOVERY_METRICS = new Set(["views", "reach"]);

const PROFILE_METRICS = new Set(["profile_visits", "follows", "profile_activity"]);

type ChartRow = {
  name: string;
  label: string;
  value: number;
  fill: string;
};

type FeedsPostInsightsPanelProps = {
  metrics: FeedPostInsightMetric[];
};

function insightMetricValue(metric: FeedPostInsightMetric): string {
  if (metric.display_value) return metric.display_value;
  if (metric.value == null) return "—";
  return metric.value.toLocaleString();
}

function isChartableMetric(metric: FeedPostInsightMetric): boolean {
  if (NON_CHARTABLE_METRICS.has(metric.name)) return false;
  return typeof metric.value === "number" && Number.isFinite(metric.value);
}

function toChartRows(metrics: FeedPostInsightMetric[], names: Set<string>): ChartRow[] {
  return metrics
    .filter((metric) => names.has(metric.name) && isChartableMetric(metric))
    .map((metric, index) => ({
      name: metric.name,
      label: metric.label,
      value: metric.value ?? 0,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }))
    .filter((row) => row.value > 0);
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="feeds-detail-insights__tooltip">
      <strong>{entry.name}</strong>
      <span>{(entry.value ?? 0).toLocaleString()}</span>
    </div>
  );
}

function InsightsDonutChart({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle?: string;
  data: ChartRow[];
}) {
  if (data.length === 0) return null;

  const total = data.reduce((sum, row) => sum + row.value, 0);

  return (
    <article className="feeds-detail-insights__chart feeds-detail-insights__chart--donut">
      <header className="feeds-detail-insights__chart-head">
        <h4>{title}</h4>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="feeds-detail-insights__chart-body feeds-detail-insights__chart-body--donut">
        <div className="feeds-detail-insights__donut-wrap">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={52}
                outerRadius={76}
                paddingAngle={data.length > 1 ? 2 : 0}
                stroke="none"
              >
                {data.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(value) => (
                  <span className="feeds-detail-insights__legend-label">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="feeds-detail-insights__donut-center" aria-hidden="true">
            <strong>{total.toLocaleString()}</strong>
            <span>Total</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function BreakdownDonut({ metric }: { metric: FeedPostInsightMetric }) {
  const data = useMemo(
    () =>
      (metric.breakdown ?? [])
        .filter((row) => row.value > 0)
        .map((row, index) => ({
          name: row.label,
          label: row.label,
          value: row.value,
          fill: CHART_COLORS[index % CHART_COLORS.length],
        })),
    [metric.breakdown],
  );

  if (data.length === 0) return null;

  return (
    <InsightsDonutChart
      title={metric.label}
      subtitle="Breakdown"
      data={data}
    />
  );
}

export function FeedsPostInsightsPanel({ metrics }: FeedsPostInsightsPanelProps) {
  const engagementData = useMemo(
    () => toChartRows(metrics, ENGAGEMENT_METRICS),
    [metrics],
  );
  const discoveryData = useMemo(() => toChartRows(metrics, DISCOVERY_METRICS), [metrics]);
  const profileData = useMemo(() => toChartRows(metrics, PROFILE_METRICS), [metrics]);
  const breakdownMetrics = useMemo(
    () => metrics.filter((metric) => (metric.breakdown?.length ?? 0) > 0),
    [metrics],
  );

  const hasCharts =
    engagementData.length > 0 ||
    discoveryData.length > 0 ||
    profileData.length > 0 ||
    breakdownMetrics.some((metric) => (metric.breakdown ?? []).some((row) => row.value > 0));

  return (
    <section className="feeds-detail-insights" aria-label="Insights">
      <h3>
        <i className="fa-solid fa-chart-simple" aria-hidden="true" /> Insights
      </h3>

      {hasCharts ? (
        <div className="feeds-detail-insights__charts">
          <div className="feeds-detail-insights__charts-row">
            <InsightsDonutChart
              title="Engagement"
              subtitle="Likes, comments, saves, and shares"
              data={engagementData}
            />
            <InsightsDonutChart
              title="Reach & discovery"
              subtitle="Views and audience reach"
              data={discoveryData}
            />
            {profileData.length > 0 ? (
              <InsightsDonutChart
                title="Profile actions"
                subtitle="Visits, follows, and profile activity"
                data={profileData}
              />
            ) : null}
          </div>

          {breakdownMetrics.length > 0 ? (
            <div className="feeds-detail-insights__breakdown-charts">
              {breakdownMetrics.map((metric) => (
                <BreakdownDonut key={metric.name} metric={metric} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="feeds-detail-insights__grid">
        {metrics.map((metric) => (
          <div key={metric.name} className="feeds-detail-insights__tile">
            <span className="feeds-detail-insights__value">{insightMetricValue(metric)}</span>
            <span className="feeds-detail-insights__label">{metric.label}</span>
            {metric.breakdown && metric.breakdown.length > 0 ? (
              <ul className="feeds-detail-insights__breakdown">
                {metric.breakdown.map((row) => (
                  <li key={`${metric.name}-${row.label}`}>
                    <span>{row.label}</span>
                    <strong>{row.display_value ?? row.value.toLocaleString()}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
