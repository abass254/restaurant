"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { formatMoney } from "@/lib/orders";
import type { RiderEarnings, RiderEarningsResponse } from "@/lib/types";
import { useRider } from "@/components/rider/RiderProvider";

type Period = "today" | "week" | "all";

export default function RiderEarningsPage() {
  const { me, loading } = useRider();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<RiderEarnings | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!loading && !me) router.replace("/r/login");
  }, [loading, me, router]);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void apiFetch<RiderEarningsResponse>(apiRoutes.riderEarnings(period))
        .then((res) => {
          if (alive) setData(res.data);
        })
        .catch(async (err) => {
          await showError("Could not load earnings", extractErrorMessage(err));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [me, period]);

  if (loading || !me) {
    return <p className="rider-muted">Loading…</p>;
  }

  return (
    <section className="rider-card">
      <p className="rider-eyebrow">Earnings</p>
      <h1>Your payouts</h1>
      <p className="rider-muted">Delivery fees from completed trips for {me.merchant_name}.</p>

      <div className="rider-segment" role="tablist">
        {(["today", "week", "all"] as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            className={period === p ? "is-active" : undefined}
            onClick={() => setPeriod(p)}
          >
            {p === "today" ? "Today" : p === "week" ? "Week" : "All"}
          </button>
        ))}
      </div>

      {busy || !data ? (
        <p className="rider-muted">Loading…</p>
      ) : (
        <>
          <div className="rider-stat-row">
            <div className="rider-stat">
              <span>Trips</span>
              <strong>{data.trip_count}</strong>
            </div>
            <div className="rider-stat">
              <span>Earnings</span>
              <strong>{formatMoney(data.earnings_total, data.currency)}</strong>
            </div>
          </div>
          <p className="rider-muted">
            Handled volume: {formatMoney(data.handled_volume, data.currency)}
          </p>
          <ul className="rider-trip-list">
            {data.trips.length === 0 ? (
              <li>
                <span className="rider-muted">No completed trips in this period.</span>
              </li>
            ) : (
              data.trips.map((trip) => (
                <li key={trip.id}>
                  <strong>#{trip.order_number}</strong>
                  <span className="rider-muted">
                    {trip.delivery_address || "Delivery"} ·{" "}
                    {formatMoney(trip.delivery_fee, trip.currency)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </section>
  );
}
