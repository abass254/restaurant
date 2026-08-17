"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { TicketsSubNav } from "@/components/tickets/TicketsSubNav";
import type { TicketAnalyticsReport } from "@/lib/types";

const RANGE_OPTIONS = [7, 30, 90] as const;

const CHART_COLORS = ["#e85d04", "#10b981", "#f59e0b", "#f43f5e", "#fb923c", "#8b5cf6"];

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ticket-analytics-tooltip">
      {label ? <strong>{label}</strong> : null}
      <ul>
        {payload.map((entry) => (
          <li key={entry.name}>
            <span style={{ background: entry.color }} />
            {entry.name}: {entry.value ?? 0}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryTile({
  icon,
  tone,
  label,
  value,
  hint,
  loading,
}: {
  icon: string;
  tone: "indigo" | "emerald" | "amber" | "rose";
  label: string;
  value: string | number;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <MotionItem as="article" className={`ticket-analytics-tile ticket-analytics-tile--${tone}`}>
      <span className="ticket-analytics-tile__icon">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </span>
      <div>
        <span className="ticket-analytics-tile__label">{label}</span>
        {loading ? (
          <Skeleton variant="text" height={24} width={72} />
        ) : (
          <strong className="ticket-analytics-tile__value">{value}</strong>
        )}
        {loading ? (
          <Skeleton variant="text" height={12} width={120} />
        ) : hint ? (
          <span className="ticket-analytics-tile__hint">{hint}</span>
        ) : null}
      </div>
    </MotionItem>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <MotionItem as="article" className={`ticket-analytics-card ${className}`.trim()}>
      <header className="ticket-analytics-card__head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      <div className="ticket-analytics-card__body">{children}</div>
    </MotionItem>
  );
}

export function TicketAnalyticsDashboard() {
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [report, setReport] = useState<TicketAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ data: TicketAnalyticsReport }>(
        apiRoutes.ticketAnalytics(range),
      );
      setReport(response.data);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not load ticket analytics.";
      setError(message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const summary = report?.summary;
  const resolutionData = useMemo(
    () => report?.resolution_breakdown.map((row) => ({ name: row.label, value: row.count })) ?? [],
    [report],
  );
  const menuData = useMemo(
    () =>
      report?.menu_selections.map((row) => ({
        name: `Option ${row.option}`,
        count: row.count,
      })) ?? [],
    [report],
  );
  const funnelData = report?.event_funnel ?? [];
  const hourlyData = useMemo(
    () => report?.hourly_volume.filter((row) => row.hour >= 6 && row.hour <= 22) ?? [],
    [report],
  );

  return (
    <section className="app-panel ticket-analytics-page">
      <header className="ticket-analytics-header">
        <div>
          <h1 className="app-title">Ticket analytics</h1>
          <p className="app-lead">
            Volume, resolution outcomes, response times, and menu engagement for your
            support tickets.
          </p>
        </div>
        <div className="ticket-analytics-header__actions">
          <div className="ticket-analytics-range" role="group" aria-label="Date range">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`ticket-analytics-range__btn${days === option ? " is-active" : ""}`}
                onClick={() => setDays(option)}
              >
                {option}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <TicketsSubNav />

      {error ? <p className="app-error ticket-analytics-error">{error}</p> : null}

      <MotionList as="div" className="ticket-analytics-summary">
        <SummaryTile
          icon="fa-ticket"
          tone="indigo"
          label="Tickets opened"
          value={summary?.total_tickets ?? 0}
          hint={`Last ${days} days`}
          loading={loading}
        />
        <SummaryTile
          icon="fa-inbox"
          tone="amber"
          label="Open backlog"
          value={summary?.open_backlog ?? 0}
          hint="Waiting or in progress"
          loading={loading}
        />
        <SummaryTile
          icon="fa-circle-check"
          tone="emerald"
          label="Solve rate"
          value={`${summary?.solve_rate_pct ?? 0}%`}
          hint={`${summary?.solved_tickets ?? 0} solved of ${summary?.closed_tickets ?? 0} closed`}
          loading={loading}
        />
        <SummaryTile
          icon="fa-clock"
          tone="rose"
          label="Median duration"
          value={formatDuration(summary?.median_duration_seconds)}
          hint={`Avg ${formatDuration(summary?.avg_duration_seconds)}`}
          loading={loading}
        />
      </MotionList>

      <MotionList as="div" className="ticket-analytics-metrics">
        <SummaryTile
          icon="fa-reply"
          tone="indigo"
          label="First agent reply"
          value={formatDuration(summary?.avg_first_response_seconds)}
          hint="Average after ticket opened"
          loading={loading}
        />
        <SummaryTile
          icon="fa-message"
          tone="emerald"
          label="First customer reply"
          value={formatDuration(summary?.avg_first_customer_reply_seconds)}
          hint="After greeting was sent"
          loading={loading}
        />
        <SummaryTile
          icon="fa-hourglass-half"
          tone="amber"
          label="Auto-closed"
          value={summary?.auto_timeout_tickets ?? 0}
          hint={`${summary?.auto_timeout_rate_pct ?? 0}% of closed tickets`}
          loading={loading}
        />
        <SummaryTile
          icon="fa-circle-xmark"
          tone="rose"
          label="Unresolved"
          value={summary?.unsolved_tickets ?? 0}
          hint="Marked unsolved or manually closed"
          loading={loading}
        />
      </MotionList>

      <div className="ticket-analytics-grid">
        <ChartCard
          title="Ticket volume"
          subtitle="Opened vs closed per day (Nairobi time)"
          className="ticket-analytics-card--wide"
        >
          {loading ? (
            <Skeleton variant="rect" height={280} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={report?.tickets_by_day ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="openedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e85d04" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#e85d04" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="closedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#9a9180" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#9a9180" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="opened"
                  name="Opened"
                  stroke="#e85d04"
                  fill="url(#openedFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="closed"
                  name="Closed"
                  stroke="#10b981"
                  fill="url(#closedFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Outcomes" subtitle="How tickets were resolved">
          {loading ? (
            <Skeleton variant="rect" height={260} />
          ) : resolutionData.length === 0 ? (
            <p className="app-muted">No closed tickets in this period yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={resolutionData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={2}
                >
                  {resolutionData.map((entry, index) => (
                    <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Menu selections" subtitle="Which greeting options customers picked">
          {loading ? (
            <Skeleton variant="rect" height={240} />
          ) : menuData.length === 0 ? (
            <p className="app-muted">No menu selections recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={menuData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#9a9180" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#9a9180" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Selections" fill="#e85d04" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Activity funnel" subtitle="Key events across all tickets">
          {loading ? (
            <Skeleton variant="rect" height={260} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={funnelData}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} stroke="#9a9180" />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={120}
                  tick={{ fontSize: 11 }}
                  stroke="#9a9180"
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Events" fill="#fb923c" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Peak hours"
          subtitle="When tickets are opened (6am–10pm Nairobi)"
          className="ticket-analytics-card--wide"
        >
          {loading ? (
            <Skeleton variant="rect" height={240} />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9a9180" interval={1} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#9a9180" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Tickets opened" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </section>
  );
}
