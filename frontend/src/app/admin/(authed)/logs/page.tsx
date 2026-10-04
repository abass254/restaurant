"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { formatNairobiDate } from "@/lib/nairobi-time";
import type { AdminLogLine, AdminLogRequest, AdminLogsResponse } from "@/lib/types";

const POLL_MS = 5000;
const REQUEST_ROWS = 200;
const LOG_ROWS = 300;
const CHART_BUCKETS = 30;

type Source = "backend" | "frontend";
type SourceFilter = "all" | Source;
type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";

type Req = AdminLogRequest & { source: Source; time: number };
type Line = AdminLogLine & { source: Source; time: number };

const windowOptions = [
  { value: 5, label: "Last 5 min" },
  { value: 15, label: "Last 15 min" },
  { value: 60, label: "Last hour" },
  { value: 0, label: "Everything buffered" },
] as const;

const levelOptions = ["all", "error", "warning", "info", "debug"] as const;

const STATUS_COLORS: Record<StatusClass, string> = {
  "2xx": "#10b981",
  "3xx": "#3b82f6",
  "4xx": "#f59e0b",
  "5xx": "#ef4444",
};

function statusClass(status: number): StatusClass {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

function statusPillClass(status: number): string {
  if (status >= 500) return "admin-pill admin-pill--danger";
  if (status >= 400) return "admin-pill admin-pill--warning";
  if (status >= 300) return "admin-pill admin-pill--neutral";
  return "admin-pill admin-pill--success";
}

function levelPillClass(level: string): string {
  if (level === "error" || level === "critical") return "admin-pill admin-pill--danger";
  if (level === "warning") return "admin-pill admin-pill--warning";
  if (level === "debug") return "admin-pill admin-pill--muted";
  return "admin-pill admin-pill--neutral";
}

/** Collapse ids so `/orders/123` and `/orders/456` count as one endpoint. */
function endpointKey(method: string, path: string): string {
  const pathname = path.split("?", 1)[0];
  const normalized = pathname
    .split("/")
    .map((segment) =>
      /^\d+$/.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
      /^[0-9a-f]{16,}$/i.test(segment) ||
      /^[A-Za-z0-9_-]{24,}$/.test(segment)
        ? ":id"
        : segment,
    )
    .join("/");
  return `${method} ${normalized || "/"}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

function formatClock(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

export default function AdminLogsPage() {
  const [data, setData] = useState<AdminLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [source, setSource] = useState<SourceFilter>("all");
  const [windowMin, setWindowMin] = useState<number>(15);
  const [showProxied, setShowProxied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [requestQuery, setRequestQuery] = useState("");
  const [level, setLevel] = useState<(typeof levelOptions)[number]>("all");
  const [logQuery, setLogQuery] = useState("");

  const load = useCallback(
    () =>
      apiFetch<AdminLogsResponse>(apiRoutes.adminLogs)
        .then(
          (res) => {
            setData(res);
            setError(null);
            setLastUpdated(new Date());
            setNow(Date.now());
          },
          (err: unknown) => {
            setError(err instanceof ApiError ? err.message : "Could not load logs.");
          },
        )
        .finally(() => setLoading(false)),
    [],
  );

  async function refreshNow() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const cutoff = windowMin > 0 ? now - windowMin * 60_000 : 0;

  const requests = useMemo<Req[]>(() => {
    if (!data) return [];
    const tag = (list: AdminLogRequest[], src: Source) =>
      list.map((r) => ({ ...r, source: src, time: Date.parse(r.ts) }));
    const all = [
      ...(source !== "frontend" ? tag(data.backend.requests, "backend") : []),
      ...(source !== "backend" ? tag(data.frontend.requests, "frontend") : []),
    ];
    return all
      .filter((r) => r.time >= cutoff)
      .filter((r) => showProxied || !(r.source === "frontend" && r.proxied))
      .sort((a, b) => b.time - a.time);
  }, [data, source, cutoff, showProxied]);

  const logs = useMemo<Line[]>(() => {
    if (!data) return [];
    const tag = (list: AdminLogLine[], src: Source) =>
      list.map((l) => ({ ...l, source: src, time: Date.parse(l.ts) }));
    const all = [
      ...(source !== "frontend" ? tag(data.backend.logs, "backend") : []),
      ...(source !== "backend" ? tag(data.frontend.logs, "frontend") : []),
    ];
    return all.filter((l) => l.time >= cutoff).sort((a, b) => b.time - a.time);
  }, [data, source, cutoff]);

  const stats = useMemo(() => {
    const byClass: Record<StatusClass, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    const byCode = new Map<number, number>();
    const endpoints = new Map<
      string,
      { key: string; hits: number; errors: number; totalMs: number }
    >();
    const durations: number[] = [];

    for (const r of requests) {
      byClass[statusClass(r.status)] += 1;
      byCode.set(r.status, (byCode.get(r.status) ?? 0) + 1);
      durations.push(r.duration_ms);
      const key = endpointKey(r.method, r.path);
      const entry = endpoints.get(key) ?? { key, hits: 0, errors: 0, totalMs: 0 };
      entry.hits += 1;
      entry.totalMs += r.duration_ms;
      if (r.status >= 400) entry.errors += 1;
      endpoints.set(key, entry);
    }

    durations.sort((a, b) => a - b);
    const total = requests.length;
    const errors = byClass["4xx"] + byClass["5xx"];
    return {
      total,
      byClass,
      errorRate: total ? (errors / total) * 100 : 0,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      codes: [...byCode.entries()].sort((a, b) => b[1] - a[1]),
      topEndpoints: [...endpoints.values()].sort((a, b) => b.hits - a.hits).slice(0, 10),
      slowEndpoints: [...endpoints.values()]
        .filter((e) => e.hits >= 2)
        .sort((a, b) => b.totalMs / b.hits - a.totalMs / a.hits)
        .slice(0, 5),
      errorLogs: logs.filter((l) => l.level === "error" || l.level === "critical").length,
    };
  }, [requests, logs]);

  const chartData = useMemo(() => {
    if (requests.length === 0) return [];
    const start = windowMin > 0 ? cutoff : Math.min(...requests.map((r) => r.time));
    const span = Math.max(now - start, 60_000);
    const size = span / CHART_BUCKETS;
    const buckets = Array.from({ length: CHART_BUCKETS }, (_, i) => ({
      label: formatClock(start + i * size),
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
    }));
    for (const r of requests) {
      const index = Math.min(CHART_BUCKETS - 1, Math.max(0, Math.floor((r.time - start) / size)));
      buckets[index][statusClass(r.status)] += 1;
    }
    return buckets;
  }, [requests, windowMin, cutoff, now]);

  const visibleRequests = useMemo(() => {
    const q = requestQuery.trim().toLowerCase();
    return requests
      .filter((r) => {
        if (statusFilter === "all") return true;
        if (statusFilter.endsWith("xx")) return statusClass(r.status) === statusFilter;
        return String(r.status) === statusFilter;
      })
      .filter(
        (r) =>
          !q ||
          r.path.toLowerCase().includes(q) ||
          r.method.toLowerCase().includes(q) ||
          (r.ip ?? "").includes(q),
      )
      .slice(0, REQUEST_ROWS);
  }, [requests, statusFilter, requestQuery]);

  const visibleLogs = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return logs
      .filter((l) => {
        if (level === "all") return true;
        if (level === "error") return l.level === "error" || l.level === "critical";
        return l.level === level;
      })
      .filter(
        (l) => !q || l.message.toLowerCase().includes(q) || l.logger.toLowerCase().includes(q),
      )
      .slice(0, LOG_ROWS);
  }, [logs, level, logQuery]);

  const maxCode = stats.codes[0]?.[1] ?? 1;

  return (
    <section className="admin-page admin-logs">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Logs &amp; traffic</h1>
          <p className="admin-page__lead">
            Live requests, response codes and application logs from the backend (FastAPI) and
            frontend (Next.js) servers. Kept in memory: the last{" "}
            {data?.backend.request_capacity ?? 2000} requests and log lines per server, cleared
            when a server restarts.
          </p>
        </div>
        <div className="admin-page__header-meta">
          {data ? (
            <>
              <span className="admin-chip admin-chip--muted">
                Backend up since {formatNairobiDate(data.backend.started_at)}
              </span>
              <span className="admin-chip admin-chip--muted">
                Frontend up since {formatNairobiDate(data.frontend.started_at)}
              </span>
            </>
          ) : null}
          {lastUpdated ? (
            <span className="admin-chip">Updated {formatClock(lastUpdated.getTime())}</span>
          ) : null}
        </div>
      </header>

      <div className="admin-toolbar">
        <div className="admin-view-switcher" role="tablist" aria-label="Source">
          {(["all", "backend", "frontend"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={source === value}
              className={`admin-view-btn ${source === value ? "is-active" : ""}`}
              onClick={() => setSource(value)}
            >
              {value === "all" ? "All" : value === "backend" ? "Backend" : "Frontend"}
            </button>
          ))}
        </div>

        <select
          className="admin-select"
          value={windowMin}
          onChange={(event) => setWindowMin(Number(event.target.value))}
        >
          {windowOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="admin-checkbox" title="Frontend requests to /api, /uploads, etc. are forwarded to the backend and already appear there.">
          <input
            type="checkbox"
            checked={showProxied}
            onChange={(event) => setShowProxied(event.target.checked)}
          />
          Include frontend → backend proxy hits
        </label>

        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Live ({POLL_MS / 1000}s)
        </label>

        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={refreshing}
          onClick={() => void refreshNow()}
        >
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      {error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : null}

      {data && data.frontend.capturing === false ? (
        <p className="admin-error">
          Frontend capture isn&apos;t active. Restart the Next.js server so{" "}
          <code>src/instrumentation.ts</code> loads.
        </p>
      ) : null}

      <div className="admin-stat-grid">
        <StatCard icon="fa-arrow-right-arrow-left" tone="indigo" label="Requests" loading={loading}
          value={stats.total.toLocaleString()} />
        <StatCard icon="fa-circle-check" tone="emerald" label="2xx success" loading={loading}
          value={stats.byClass["2xx"].toLocaleString()} />
        <StatCard icon="fa-triangle-exclamation" tone="amber" label="4xx client errors" loading={loading}
          value={stats.byClass["4xx"].toLocaleString()} />
        <StatCard icon="fa-bug" tone="rose" label="5xx server errors" loading={loading}
          value={stats.byClass["5xx"].toLocaleString()} />
        <StatCard icon="fa-percent" tone="amber" label="Error rate" loading={loading}
          value={`${stats.errorRate.toFixed(1)}%`} />
        <StatCard icon="fa-gauge-high" tone="indigo" label="Latency p50 / p95" loading={loading}
          value={`${formatMs(stats.p50)} / ${formatMs(stats.p95)}`} small />
      </div>

      <section className="admin-section">
        <header className="admin-section__head">
          <h2 className="admin-section__title">Requests over time</h2>
          <span className="admin-chip admin-chip--muted">
            {stats.errorLogs} error log line{stats.errorLogs === 1 ? "" : "s"} in window
          </span>
        </header>
        {loading ? (
          <Skeleton height={240} />
        ) : chartData.length === 0 ? (
          <p className="admin-muted">No requests in this window yet.</p>
        ) : (
          <div className="admin-logs__chart">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} stroke="var(--color-text-subtle, #94a3b8)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--color-text-subtle, #94a3b8)" />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                  contentStyle={{
                    background: "var(--color-surface, #fff)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {(Object.keys(STATUS_COLORS) as StatusClass[]).map((cls) => (
                  <Bar key={cls} dataKey={cls} stackId="status" fill={STATUS_COLORS[cls]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="admin-logs__split">
        <section className="admin-section">
          <header className="admin-section__head">
            <h2 className="admin-section__title">Response codes</h2>
            {statusFilter !== "all" ? (
              <button type="button" className="admin-section__link" onClick={() => setStatusFilter("all")}>
                Clear filter
              </button>
            ) : null}
          </header>
          {stats.codes.length === 0 ? (
            <p className="admin-muted">Nothing yet.</p>
          ) : (
            <ul className="admin-logs__codes">
              {stats.codes.map(([code, count]) => (
                <li key={code}>
                  <button
                    type="button"
                    className={`admin-logs__code-row${statusFilter === String(code) ? " is-active" : ""}`}
                    onClick={() => setStatusFilter(statusFilter === String(code) ? "all" : String(code))}
                    title="Filter requests by this code"
                  >
                    <span className={statusPillClass(code)}>{code}</span>
                    <span className="admin-logs__bar">
                      <span
                        className="admin-logs__bar-fill"
                        style={{
                          width: `${(count / maxCode) * 100}%`,
                          background: STATUS_COLORS[statusClass(code)],
                        }}
                      />
                    </span>
                    <span className="admin-logs__count">{count.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-section">
          <header className="admin-section__head">
            <h2 className="admin-section__title">Top endpoints</h2>
          </header>
          {stats.topEndpoints.length === 0 ? (
            <p className="admin-muted">Nothing yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-logs__compact">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Hits</th>
                    <th>Errors</th>
                    <th>Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topEndpoints.map((e) => (
                    <tr key={e.key}>
                      <td className="admin-logs__path">
                        <code title={e.key}>{e.key}</code>
                      </td>
                      <td>{e.hits}</td>
                      <td>
                        {e.errors ? (
                          <span className="admin-pill admin-pill--danger">{e.errors}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td>{formatMs(e.totalMs / e.hits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {stats.slowEndpoints.length > 0 ? (
            <p className="admin-page__footnote">
              Slowest:{" "}
              {stats.slowEndpoints.map((e, i) => (
                <span key={e.key}>
                  {i > 0 ? " · " : ""}
                  <code>{e.key}</code> {formatMs(e.totalMs / e.hits)}
                </span>
              ))}
            </p>
          ) : null}
        </section>
      </div>

      <section className="admin-section">
        <header className="admin-section__head">
          <h2 className="admin-section__title">Requests</h2>
          <div className="admin-section__head-actions">
            <label className="admin-search">
              <span className="admin-search__icon" aria-hidden="true">
                <i className="fa-solid fa-magnifying-glass" />
              </span>
              <input
                type="search"
                className="admin-search__input"
                placeholder="Path, method, IP…"
                value={requestQuery}
                onChange={(event) => setRequestQuery(event.target.value)}
              />
            </label>
            <select
              className="admin-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All codes</option>
              <option value="2xx">2xx</option>
              <option value="3xx">3xx</option>
              <option value="4xx">4xx</option>
              <option value="5xx">5xx</option>
              {stats.codes
                .map(([code]) => code)
                .sort((a, b) => a - b)
                .map((code) => (
                  <option key={code} value={String(code)}>
                    {code}
                  </option>
                ))}
            </select>
          </div>
        </header>
        {loading ? (
          <Skeleton height={200} />
        ) : visibleRequests.length === 0 ? (
          <p className="admin-muted">No matching requests.</p>
        ) : (
          <div className="admin-table-wrap admin-logs__scroll">
            <table className="admin-table admin-logs__compact">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Path</th>
                  <th>Duration</th>
                  <th>Client</th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((r, i) => (
                  <tr key={`${r.source}-${r.ts}-${i}`}>
                    <td className="admin-logs__mono">{formatClock(r.time)}</td>
                    <td>
                      <SourceBadge source={r.source} proxied={r.proxied} />
                    </td>
                    <td className="admin-logs__mono">{r.method}</td>
                    <td>
                      <span className={statusPillClass(r.status)}>{r.status}</span>
                    </td>
                    <td className="admin-logs__path">
                      <code title={r.path}>{r.path}</code>
                    </td>
                    <td className={`admin-logs__mono${r.duration_ms >= 1000 ? " admin-logs__slow" : ""}`}>
                      {formatMs(r.duration_ms)}
                    </td>
                    <td className="admin-logs__mono">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-page__footnote">
          Showing the newest {Math.min(visibleRequests.length, REQUEST_ROWS)} of {requests.length}{" "}
          requests in this window.
        </p>
      </section>

      <section className="admin-section">
        <header className="admin-section__head">
          <h2 className="admin-section__title">Application logs</h2>
          <div className="admin-section__head-actions">
            <label className="admin-search">
              <span className="admin-search__icon" aria-hidden="true">
                <i className="fa-solid fa-magnifying-glass" />
              </span>
              <input
                type="search"
                className="admin-search__input"
                placeholder="Message or logger…"
                value={logQuery}
                onChange={(event) => setLogQuery(event.target.value)}
              />
            </label>
            <select
              className="admin-select"
              value={level}
              onChange={(event) => setLevel(event.target.value as (typeof levelOptions)[number])}
            >
              {levelOptions.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All levels" : value}
                </option>
              ))}
            </select>
          </div>
        </header>
        {loading ? (
          <Skeleton height={200} />
        ) : visibleLogs.length === 0 ? (
          <p className="admin-muted">No matching log lines.</p>
        ) : (
          <ol className="admin-logs__console">
            {visibleLogs.map((l, i) => (
              <li key={`${l.source}-${l.ts}-${i}`} className={`admin-logs__line is-${l.level}`}>
                <span className="admin-logs__mono admin-logs__time">{formatClock(l.time)}</span>
                <SourceBadge source={l.source} />
                <span className={levelPillClass(l.level)}>{l.level}</span>
                <span className="admin-logs__logger">{l.logger}</span>
                <pre className="admin-logs__message">{l.message}</pre>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function SourceBadge({ source, proxied }: { source: Source; proxied?: boolean }) {
  return (
    <span className={`admin-logs__source admin-logs__source--${source}`}>
      {source === "backend" ? "API" : "Web"}
      {proxied ? " → API" : ""}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  loading,
  small,
}: {
  icon: string;
  label: string;
  value: string;
  tone: "indigo" | "emerald" | "amber" | "rose";
  loading: boolean;
  small?: boolean;
}) {
  return (
    <article className={`admin-stat admin-stat--${tone}`}>
      <span className="admin-stat__icon" aria-hidden="true">
        <i className={`fas ${icon}`} />
      </span>
      <div className="admin-stat__body">
        <span className="admin-stat__label">{label}</span>
        {loading ? (
          <Skeleton variant="text" width={90} height={26} />
        ) : (
          <strong className={`admin-stat__value${small ? " admin-logs__stat-small" : ""}`}>
            {value}
          </strong>
        )}
      </div>
    </article>
  );
}
