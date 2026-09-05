"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { isInternalToolsUser } from "@/lib/internal-tools-access";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { Skeleton } from "@/components/app/Skeleton";
import { ListLoadError } from "@/components/app/ListLoadError";
import type { LoginCodeRecord, LoginCodesListResponse } from "@/lib/types";

type AudienceFilter = "all" | "merchant" | "rider";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return formatNairobiDateTime(iso) || "—";
}

function deliveryLabel(status: string | null): { label: string; cls: string } {
  switch ((status || "").toLowerCase()) {
    case "delivered":
      return { label: "Delivered", cls: "is-success" };
    case "failed":
      return { label: "Delivery failed", cls: "is-failed" };
    case "created":
      return { label: "Created only", cls: "is-pending" };
    default:
      return { label: "Unknown", cls: "is-pending" };
  }
}

function lifecycleLabel(status: string): { label: string; cls: string } {
  switch (status) {
    case "used":
      return { label: "Used", cls: "is-success" };
    case "expired":
      return { label: "Expired", cls: "is-cancelled" };
    default:
      return { label: "Active", cls: "is-pending" };
  }
}

function channelLabel(channel: string | null): string {
  if (channel === "email") return "Email";
  if (channel === "phone") return "Phone";
  return channel || "—";
}

export default function ToolsLoginCodesPage() {
  const user = useAuthUser();
  const router = useRouter();
  const allowed = isInternalToolsUser(user);
  const [records, setRecords] = useState<LoginCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudienceFilter>("all");
  const [filterText, setFilterText] = useState("");

  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      const params = new URLSearchParams({ audience, limit: "100" });
      const data = await apiFetch<LoginCodesListResponse>(
        `${apiRoutes.loginCodes}?${params.toString()}`,
      );
      setRecords(data.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err, "Could not load login codes."));
    } finally {
      setLoading(false);
    }
  }, [allowed, audience]);

  useEffect(() => {
    if (!allowed) {
      router.replace("/tools/starters");
    }
  }, [allowed, router]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void reload();
    }, 5000);
    return () => window.clearInterval(id);
  }, [reload]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return records;
    return records.filter((row) =>
      [
        row.recipient_name ?? "",
        row.recipient_masked ?? "",
        row.audience,
        row.channel ?? "",
        row.delivery_status ?? "",
        row.lifecycle_status,
        row.purpose ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [records, filterText]);

  if (!allowed) return null;

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Login codes</h1>
          <p className="app-lead">
            See whether merchant and rider sign-in codes were emailed or only
            created on-screen (phone has no SMS yet).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void reload()}
          title="Refresh login codes"
        >
          <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div className="inventory-toolbar login-codes-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter by name, email, phone, status…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
        <div className="login-codes-toolbar__filters" role="group" aria-label="Audience">
          {(
            [
              ["all", "All"],
              ["merchant", "Merchant"],
              ["rider", "Rider"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm ${audience === value ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={audience === value}
              onClick={() => setAudience(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoginCodesSkeleton />
      ) : loadError && records.length === 0 ? (
        <ListLoadError
          title="Could not load login codes"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void reload();
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="inventory-empty">
          <i className="fa-solid fa-key" aria-hidden="true" />
          <h2>{records.length === 0 ? "No login codes yet" : "No matches"}</h2>
          <p>
            {records.length === 0
              ? "Request a sign-in code from the merchant or rider app to see it here."
              : "Try a different name, channel, or status."}
          </p>
        </div>
      ) : (
        <div className="inventory-table-wrap">
          <table className="inventory-table payment-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Audience</th>
                <th>Recipient</th>
                <th>Channel</th>
                <th>Delivery</th>
                <th>Code status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const delivery = deliveryLabel(row.delivery_status);
                const lifecycle = lifecycleLabel(row.lifecycle_status);
                return (
                  <tr key={`${row.audience}-${row.id}`}>
                    <td>
                      <div className="payment-cell-when">
                        <span>{formatWhen(row.created_at)}</span>
                        {row.expires_at ? (
                          <span className="app-muted">
                            Expires {formatWhen(row.expires_at)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className="login-codes-audience">
                        {row.audience === "rider" ? "Rider" : "Merchant"}
                      </span>
                    </td>
                    <td>
                      <div className="payment-cell-phone">
                        <strong>{row.recipient_name || "—"}</strong>
                        <span className="app-muted">{row.recipient_masked || "—"}</span>
                      </div>
                    </td>
                    <td>{channelLabel(row.channel)}</td>
                    <td>
                      <span className={`payment-status-pill ${delivery.cls}`}>
                        {delivery.label}
                      </span>
                    </td>
                    <td>
                      <span className={`payment-status-pill ${lifecycle.cls}`}>
                        {lifecycle.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LoginCodesSkeleton() {
  const rows = Array.from({ length: 6 });
  return (
    <div className="inventory-table-wrap" aria-busy="true" aria-live="polite">
      <table className="inventory-table payment-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Audience</th>
            <th>Recipient</th>
            <th>Channel</th>
            <th>Delivery</th>
            <th>Code status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((_, i) => (
            <tr key={i}>
              <td>
                <Skeleton variant="text" height={12} width={120} />
                <Skeleton variant="text" height={10} width={90} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={70} />
              </td>
              <td>
                <Skeleton variant="text" height={13} width={140} />
                <Skeleton variant="text" height={10} width={100} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={60} />
              </td>
              <td>
                <Skeleton variant="text" height={22} width={96} />
              </td>
              <td>
                <Skeleton variant="text" height={22} width={80} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
