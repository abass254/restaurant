"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatNairobiDate } from "@/lib/nairobi-time";
import type { AdminWebhookEvent, AdminWebhookEventsResponse } from "@/lib/types";

const SKELETON_ROWS = 10;
const POLL_MS = 8000;

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "200", label: "200 OK" },
  { value: "403", label: "403 Forbidden" },
  { value: "500", label: "500 Error" },
] as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDate(value) || value;
}

function shortId(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function httpPillClass(status: number): string {
  if (status >= 500) return "admin-pill admin-pill--danger";
  if (status >= 400) return "admin-pill admin-pill--warning";
  return "admin-pill admin-pill--success";
}

function buildEventsUrl(query: string, statusFilter: string): string {
  const params = new URLSearchParams({ limit: "150" });
  const q = query.trim();
  if (q) params.set("q", q);
  if (statusFilter !== "all") params.set("http_status", statusFilter);
  return `${apiRoutes.adminWebhookEvents}?${params.toString()}`;
}

export default function AdminWebhooksPage() {
  const [events, setEvents] = useState<AdminWebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]["value"]>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadEvents = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!silent) setLoading(true);
      else setRefreshing(true);

      try {
        const res = await apiFetch<AdminWebhookEventsResponse>(
          buildEventsUrl(query, statusFilter),
        );
        setEvents(res.data);
        setError(null);
        setLastUpdated(new Date());
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : "Could not load webhook events.");
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [query, statusFilter],
  );

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      void loadEvents({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadEvents]);

  const stats = useMemo(() => {
    const errors = events.filter((event) => event.http_status >= 500).length;
    const rejected = events.filter((event) => event.http_status === 403).length;
    const messages = events.filter((event) => event.event_type === "messages").length;
    return { errors, rejected, messages };
  }, [events]);

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Webhook log</h1>
          <p className="admin-page__lead">
            Live audit trail of Instagram and Meta webhooks hitting the backend. Use this to
            debug delivery, signatures, and DM processing. Application stdout logs (uvicorn,
            stack traces) still live in{" "}
            <code>docker logs dukai-backend-1</code>.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">
            {loading ? "Loading…" : `${events.length} events`}
          </span>
          {lastUpdated ? (
            <span className="admin-chip admin-chip--muted">
              Updated {formatNairobiDate(lastUpdated.toISOString())}
            </span>
          ) : null}
        </div>
      </header>

      <div className="admin-toolbar">
        <label className="admin-search">
          <span className="admin-search__icon" aria-hidden="true">
            <i className="fa-solid fa-magnifying-glass" />
          </span>
          <input
            type="search"
            className="admin-search__input"
            placeholder="Search type, preview, sender, result…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <select
          className="admin-select"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as (typeof statusOptions)[number]["value"])
          }
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Auto-refresh every {POLL_MS / 1000}s
        </label>

        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={refreshing}
          onClick={() => void loadEvents({ silent: true })}
        >
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      <div className="admin-stats-row">
        <span className="admin-chip">Messages: {stats.messages}</span>
        <span className="admin-chip admin-chip--warning">403 rejected: {stats.rejected}</span>
        <span className="admin-chip admin-chip--danger">500 errors: {stats.errors}</span>
      </div>

      {error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : null}

      {loading ? (
        <div className="admin-table-wrap" aria-busy="true">
          <table className="admin-table admin-table--skeleton">
            <thead>
              <tr>
                <th>Received</th>
                <th>Status</th>
                <th>Type</th>
                <th>Preview</th>
                <th>Sender</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <tr key={`sk-${index}`}>
                  <td colSpan={7}>
                    <Skeleton height={18} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : events.length === 0 ? (
        <MotionFade>
          <div className="admin-empty">
            <i className="fas fa-tower-broadcast" aria-hidden="true" />
            <h3>No webhook events</h3>
            <p>Try changing filters or send a test DM to trigger a webhook.</p>
          </div>
        </MotionFade>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Status</th>
                <th>Type</th>
                <th>Preview</th>
                <th>Sender</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
              {events.map((event) => (
                <motion.tr key={event.id} variants={staggerItem}>
                  <td>{formatDate(event.received_at)}</td>
                  <td>
                    <span className={httpPillClass(event.http_status)}>
                      {event.http_status}
                    </span>
                  </td>
                  <td>
                    <code>{event.event_type || event.object || "—"}</code>
                  </td>
                  <td className="admin-table__preview">
                    {event.preview ? (
                      <span title={event.preview}>{event.preview}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <code title={event.sender_id ?? undefined}>{shortId(event.sender_id)}</code>
                  </td>
                  <td className="admin-table__preview">
                    {event.processing_result || "—"}
                  </td>
                  <td>
                    <Link href={`/admin/webhooks/${event.id}`} className="admin-table__primary-link">
                      Details
                    </Link>
                  </td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
        </div>
      )}

      <MotionFade>
        <p className="admin-page__footnote">
          Tip: filter by <strong>500</strong> to spot pool timeouts or audit-log failures. A
          green 200 with result <code>accepted, queued</code> means Meta got OK and DM
          processing was scheduled.
        </p>
      </MotionFade>
    </section>
  );
}
