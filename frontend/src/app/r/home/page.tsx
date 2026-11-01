"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/orders";
import { useRider } from "@/components/rider/RiderProvider";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { usePwaInstall } from "@/hooks/usePwaInstall";

function HomeInner() {
  const { me, loading, setOnline } = useRider();
  const router = useRouter();
  const params = useSearchParams();
  const done = params.get("done");
  const [toggling, setToggling] = useState(false);
  const { canPrompt, installed, prompting, promptInstall } = usePwaInstall();

  useEffect(() => {
    if (!loading && !me) {
      router.replace("/r/login");
    }
  }, [loading, me, router]);

  useEffect(() => {
    if (me?.active_trip_id && me.active_trip_route) {
      router.replace(
        `${me.active_trip_route}?order=${encodeURIComponent(me.active_trip_id)}`,
      );
    }
  }, [me?.active_trip_id, me?.active_trip_route, router]);

  async function toggleOnline() {
    if (!me) return;
    setToggling(true);
    try {
      await setOnline(!me.is_online);
    } catch (err) {
      await showError("Could not update status", extractErrorMessage(err));
    } finally {
      setToggling(false);
    }
  }

  async function onDownloadApp() {
    if (canPrompt) {
      const ok = await promptInstall();
      if (!ok) router.push("/r/install");
      return;
    }
    router.push("/r/install");
  }

  if (loading || !me) {
    return <p className="rider-muted">Loading…</p>;
  }

  return (
    <section className="rider-card">
      <p className="rider-eyebrow">{me.merchant_name}</p>
      <h1>Hi, {me.rider_name.split(" ")[0]}</h1>
      <p className="rider-muted">
        {me.is_online
          ? "You are online and ready for offers."
          : "Go online when you are ready to take deliveries."}
      </p>

      {done ? (
        <p className="rider-banner">Delivery confirmed. Earnings updated.</p>
      ) : null}

      <div className="rider-stat-row">
        <div className="rider-stat">
          <span>Today’s trips</span>
          <strong>{me.today_trip_count}</strong>
        </div>
        <div className="rider-stat">
          <span>Today’s earnings</span>
          <strong>{formatMoney(me.today_earnings, me.currency)}</strong>
        </div>
      </div>

      <div className="rider-actions">
        <button
          type="button"
          className="rider-btn rider-btn--primary"
          disabled={toggling}
          onClick={() => void toggleOnline()}
        >
          {toggling ? "Updating…" : me.is_online ? "Go offline" : "Go online"}
        </button>
        <button
          type="button"
          className="rider-btn rider-btn--ghost"
          onClick={() => router.push("/r/earnings")}
        >
          View earnings
        </button>
        {!installed ? (
          <button
            type="button"
            className="rider-btn rider-btn--ghost"
            disabled={prompting}
            onClick={() => void onDownloadApp()}
          >
            {prompting ? "Opening install…" : "Download app"}
          </button>
        ) : null}
        {!installed ? (
          <Link href="/r/install" className="rider-download-link">
            How to install TransChap Rider →
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export default function RiderHomePage() {
  return (
    <Suspense fallback={<p className="rider-muted">Loading…</p>}>
      <HomeInner />
    </Suspense>
  );
}
