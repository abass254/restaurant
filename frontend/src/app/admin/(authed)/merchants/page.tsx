"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type {
  AdminMerchantsResponse,
  AdminMerchantSummary,
} from "@/lib/types";
import { formatNairobiDate } from "@/lib/nairobi-time";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDate(value) || value;
}

const SKELETON_ROWS = 6;

export default function AdminMerchantsListPage() {
  const [merchants, setMerchants] = useState<AdminMerchantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<AdminMerchantsResponse>(apiRoutes.adminMerchants)
      .then((res) => {
        if (cancelled) return;
        setMerchants(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load merchants.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter((m) => {
      const haystack = [
        m.business_name,
        m.business_location,
        m.business_category,
        m.instagram_username ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [merchants, query]);

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Merchants</h1>
          <p className="admin-page__lead">
            Every business registered on the platform. Click a row to see its
            users.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">
            <i className="fas fa-store" aria-hidden="true" />
            {loading ? "…" : `${merchants.length} total`}
          </span>
        </div>
      </header>

      <div className="admin-toolbar">
        <label className="admin-search">
          <i className="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, location, category, or IG handle"
            aria-label="Search merchants"
          />
        </label>
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
                <th>Business</th>
                <th>Category</th>
                <th>Location</th>
                <th>Users</th>
                <th>Instagram</th>
                <th>Joined</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  <td>
                    <div className="admin-table__primary">
                      <Skeleton variant="rect" width={34} height={34} />
                      <div style={{ flex: 1 }}>
                        <Skeleton variant="text" width="70%" height={14} />
                        <Skeleton variant="text" width="35%" height={10} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <Skeleton variant="text" width={90} height={12} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={110} height={12} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={40} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={120} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={80} height={12} />
                  </td>
                  <td className="admin-table__actions">
                    <Skeleton variant="text" width={88} height={28} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        <MotionFade>
          <div className="admin-empty">
            <i className="fas fa-store-slash" aria-hidden="true" />
            <h3>No merchants found</h3>
            <p>
              {merchants.length === 0
                ? "Nobody has registered a business on the platform yet."
                : "Try a different search term."}
            </p>
          </div>
        </MotionFade>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>Location</th>
                <th>Users</th>
                <th>Instagram</th>
                <th>Joined</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <motion.tbody
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {filtered.map((m) => (
                <motion.tr key={m.id} variants={staggerItem}>
                  <td>
                    <Link
                      href={`/admin/merchants/${m.id}`}
                      className="admin-table__primary"
                    >
                      <span className="admin-table__avatar" aria-hidden="true">
                        <i className="fas fa-store" />
                      </span>
                      <div>
                        <strong>{m.business_name}</strong>
                        <code className="admin-table__id">
                          {m.id.slice(0, 8)}
                        </code>
                      </div>
                    </Link>
                  </td>
                  <td>{m.business_category}</td>
                  <td>{m.business_location}</td>
                  <td>
                    <span className="admin-pill admin-pill--neutral">
                      <i className="fas fa-users" aria-hidden="true" />
                      {m.users_count}
                    </span>
                  </td>
                  <td>
                    {m.instagram_connected ? (
                      <span className="admin-pill admin-pill--success">
                        <i className="fab fa-instagram" aria-hidden="true" />
                        {m.instagram_username
                          ? `@${m.instagram_username}`
                          : "Connected"}
                      </span>
                    ) : (
                      <span className="admin-pill admin-pill--muted">
                        Not connected
                      </span>
                    )}
                  </td>
                  <td>{formatDate(m.created_at)}</td>
                  <td className="admin-table__actions">
                    <Link
                      href={`/admin/merchants/${m.id}`}
                      className="admin-btn admin-btn--ghost"
                    >
                      View users
                      <i className="fas fa-arrow-right" aria-hidden="true" />
                    </Link>
                  </td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
        </div>
      )}
    </section>
  );
}
