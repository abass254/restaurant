"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStoreStatus } from "@/hooks/useStation";
import { storeStatusLabel } from "@/lib/station";
import {
  enableCompanionPush,
  isCompanionPushEnabled,
  registerStationServiceWorker,
} from "@/lib/companion-push";

export default function MobileSettingsPage() {
  const { store, pause, resume, setBusy } = useStoreStatus();
  const [msg, setMsg] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    setPushEnabled(isCompanionPushEnabled());
  }, []);

  return (
    <>
      <div className="mobile-card">
        <h3>Store</h3>
        <p style={{ color: "var(--station-muted)", marginTop: 0 }}>
          {store ? storeStatusLabel(store) : "Loading…"} · prep{" "}
          {store?.effective_prep_minutes ?? "—"} min
        </p>
        <div className="station-ticket__actions">
          {store?.orders_paused ? (
            <button
              type="button"
              className="station-btn station-btn--primary"
              onClick={() => void resume()}
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              className="station-btn station-btn--danger"
              onClick={() => void pause(60)}
            >
              Pause 1 hour
            </button>
          )}
          <button type="button" className="station-btn" onClick={() => void setBusy(15)}>
            Busy +15
          </button>
        </div>
      </div>

      <div className="mobile-card">
        <h3>Install & alerts</h3>
        <div className="station-ticket__actions">
          <Link href="/install" className="station-btn station-btn--primary">
            Download app
          </Link>
          {!pushEnabled && (
            <button
              type="button"
              className="station-btn"
              onClick={async () => {
                await registerStationServiceWorker();
                const result = await enableCompanionPush();
                if (result.ok) {
                  setPushEnabled(true);
                  setMsg(null);
                  return;
                }
                setMsg(result.message);
              }}
            >
              Enable notifications
            </button>
          )}
        </div>
        {msg && (
          <p style={{ color: "var(--station-muted)", fontSize: "0.85rem" }}>{msg}</p>
        )}
        {pushEnabled && !msg && (
          <p style={{ color: "var(--station-muted)", fontSize: "0.85rem" }}>
            Notifications enabled on this device.
          </p>
        )}
      </div>

      <div className="mobile-card">
        <h3>Open</h3>
        <div className="station-ticket__actions">
          <Link href="/station" className="station-btn station-btn--primary">
            Tablet station
          </Link>
          <Link href="/orders" className="station-btn">
            Full orders
          </Link>
          <Link href="/dashboard" className="station-btn">
            Dashboard
          </Link>
          <Link href="/settings" className="station-btn">
            Full settings
          </Link>
        </div>
      </div>
    </>
  );
}
