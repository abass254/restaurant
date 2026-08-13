"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRider } from "@/components/rider/RiderProvider";

export default function RiderOnlinePage() {
  const { me, loading, offers, setOnline } = useRider();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) {
      router.replace("/r/login");
      return;
    }
    if (me?.active_trip_id && me.active_trip_route) {
      router.replace(
        `${me.active_trip_route}?order=${encodeURIComponent(me.active_trip_id)}`,
      );
      return;
    }
    if (me && !me.is_online) {
      router.replace("/r/home");
    }
  }, [loading, me, router]);

  useEffect(() => {
    if (offers[0]) {
      router.push(`/r/offer/${offers[0].id}`);
    }
  }, [offers, router]);

  if (loading || !me) {
    return <p className="rider-muted">Loading…</p>;
  }

  return (
    <section className="rider-card" style={{ textAlign: "center" }}>
      <p className="rider-eyebrow">Waiting for deliveries</p>
      <div className="rider-pulse" aria-hidden />
      <h1>You&apos;re online</h1>
      <p className="rider-muted">
        New ready orders from {me.merchant_name} will appear here. Stay nearby and keep the app open.
      </p>
      <div className="rider-actions">
        <button
          type="button"
          className="rider-btn rider-btn--ghost"
          onClick={() => void setOnline(false)}
        >
          Go offline
        </button>
      </div>
    </section>
  );
}
