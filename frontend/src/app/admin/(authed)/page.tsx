"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionList, MotionItem, MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import type {
  AdminMerchantsResponse,
  AdminMerchantSummary,
  AdminStatsResponse,
} from "@/lib/types";
import { formatNairobiDate } from "@/lib/nairobi-time";
import { AdminMerchantLocationsMap } from "@/components/admin/AdminMerchantLocationsMap";

function formatRelative(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDate(value) || value;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [merchants, setMerchants] = useState<AdminMerchantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [s, m] = await Promise.all([
          apiFetch<AdminStatsResponse>(apiRoutes.adminStats),
          apiFetch<AdminMerchantsResponse>(apiRoutes.adminMerchants),
        ]);
        if (cancelled) return;
        setStats(s);
        setMerchants(m.data);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load admin overview.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const recent = merchants.slice(0, 5);

  return (
    <section className="admin-page admin-page--overview">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Overview</h1>
          <p className="admin-page__lead">
            Snapshot of every merchant and every user on the platform.
          </p>
        </div>
        <Link href="/admin/merchants" className="admin-btn admin-btn--primary">
          <i className="fas fa-store" aria-hidden="true" />
          View all merchants
        </Link>
      </header>

      {error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : null}

      <MotionList as="div" className="admin-stat-grid">
        <StatCard
          icon="fa-store"
          tone="indigo"
          label="Merchants"
          value={stats?.merchants ?? 0}
          loading={loading}
        />
        <StatCard
          icon="fa-users"
          tone="emerald"
          label="Users"
          value={stats?.users ?? 0}
          loading={loading}
        />
        <StatCard
          icon="fa-shield-halved"
          tone="amber"
          label="Super admins"
          value={stats?.super_admins ?? 0}
          loading={loading}
        />
        <StatCard
          icon="fa-brands fa-instagram"
          tone="rose"
          label="Instagram accounts"
          value={stats?.instagram_accounts ?? 0}
          loading={loading}
        />
      </MotionList>

      <AdminMerchantLocationsMap merchants={merchants} loading={loading} />

      <section className="admin-section">
        <header className="admin-section__head">
          <h2 className="admin-section__title">M-PESA setup status</h2>
          <Link href="/admin/settings" className="admin-section__link">
            Open settings <i className="fas fa-arrow-right" aria-hidden="true" />
          </Link>
        </header>
        {loading ? (
          <p className="admin-muted">Checking setup…</p>
        ) : (
          <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
            <span
              className={`admin-pill ${
                stats?.mpesa_daraja_configured ? "admin-pill--success" : "admin-pill--warning"
              }`}
            >
              <i className="fas fa-key" aria-hidden="true" />
              Daraja credentials {stats?.mpesa_daraja_configured ? "configured" : "missing"}
            </span>
            <span className="admin-pill admin-pill--neutral">
              <i className="fas fa-store" aria-hidden="true" />
              Merchants with M-PESA configured: {stats?.merchants_mpesa_configured ?? 0}/
              {stats?.merchants ?? 0}
            </span>
          </div>
        )}
      </section>

      <section className="admin-section">
        <header className="admin-section__head">
          <h2 className="admin-section__title">Recent merchants</h2>
          <Link href="/admin/merchants" className="admin-section__link">
            See all <i className="fas fa-arrow-right" aria-hidden="true" />
          </Link>
        </header>

        {loading ? (
          <ul className="admin-merchant-list" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="admin-merchant-row admin-merchant-row--skeleton">
                <Skeleton variant="rect" width={38} height={38} />
                <div className="admin-merchant-row__body">
                  <Skeleton variant="text" width="55%" height={14} />
                  <Skeleton variant="text" width="40%" height={11} />
                </div>
                <div className="admin-merchant-row__stats">
                  <Skeleton variant="text" width={56} height={11} />
                  <Skeleton variant="text" width={80} height={11} />
                </div>
              </li>
            ))}
          </ul>
        ) : recent.length === 0 ? (
          <MotionFade>
            <p className="admin-muted">
              No merchants have registered yet.
            </p>
          </MotionFade>
        ) : (
          <MotionList as="ul" className="admin-merchant-list">
            {recent.map((m) => (
              <MotionItem as="li" key={m.id} className="admin-merchant-row">
                <Link
                  href={`/admin/merchants/${m.id}`}
                  className="admin-merchant-row__link"
                >
                  <span
                    className="admin-merchant-row__avatar"
                    aria-hidden="true"
                  >
                    <i className="fas fa-store" />
                  </span>
                  <div className="admin-merchant-row__body">
                    <strong>{m.business_name}</strong>
                    <span className="admin-merchant-row__meta">
                      {m.business_location} · {m.business_category}
                    </span>
                  </div>
                  <div className="admin-merchant-row__stats">
                    <span title="Users registered for this merchant">
                      <i className="fas fa-users" aria-hidden="true" />{" "}
                      {m.users_count}
                    </span>
                    <span>{formatRelative(m.created_at)}</span>
                  </div>
                </Link>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </section>
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: string;
  label: string;
  value: number;
  tone: "indigo" | "emerald" | "amber" | "rose";
  loading: boolean;
}) {
  return (
    <MotionItem as="article" className={`admin-stat admin-stat--${tone}`}>
      <span className="admin-stat__icon" aria-hidden="true">
        <i className={`fas ${icon}`} />
      </span>
      <div className="admin-stat__body">
        <span className="admin-stat__label">{label}</span>
        {loading ? (
          <Skeleton variant="text" width={90} height={26} />
        ) : (
          <strong className="admin-stat__value">
            {value.toLocaleString()}
          </strong>
        )}
      </div>
    </MotionItem>
  );
}
