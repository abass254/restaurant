"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { StationNewOrderAlert } from "@/components/station/StationNewOrderAlert";
import {
  StationOrdersProvider,
} from "@/components/station/StationOrdersContext";
import { useStoreStatus } from "@/hooks/useStation";
import { registerStationServiceWorker } from "@/lib/companion-push";
import { storeStatusLabel } from "@/lib/station";

export function StationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthUser();
  const { store } = useStoreStatus();
  const shopName =
    store?.business_name ||
    user?.active_account?.business_name ||
    user?.account?.business_name ||
    "DukAI Station";

  useEffect(() => {
    void registerStationServiceWorker();
  }, []);

  const statusTone = store?.orders_paused
    ? "station-pill--danger"
    : store && store.busy_extra_prep_minutes > 0
      ? "station-pill--warn"
      : "station-pill--ok";

  return (
    <StationOrdersProvider>
      <div className="station-root">
        <StationNewOrderAlert />
        <nav className="station-rail" aria-label="Station navigation">
          <div className="station-rail__logo" title="DukAI">
            <DukAiLogoMark size={28} color="#c19a7c" accentColor="#a86b55" />
          </div>
          <Link
            href="/station"
            className={pathname === "/station" ? "is-active" : ""}
            title="Orders"
          >
            <i className="fa-solid fa-receipt" aria-hidden />
          </Link>
          <Link
            href="/station/history"
            className={pathname.startsWith("/station/history") ? "is-active" : ""}
            title="History"
          >
            <i className="fa-solid fa-clock-rotate-left" aria-hidden />
          </Link>
          <Link
            href="/station/stock"
            className={pathname.startsWith("/station/stock") ? "is-active" : ""}
            title="Stock"
          >
            <i className="fa-solid fa-box" aria-hidden />
          </Link>
          <Link
            href="/station/settings"
            className={pathname.startsWith("/station/settings") ? "is-active" : ""}
            title="Settings"
          >
            <i className="fa-solid fa-sliders" aria-hidden />
          </Link>
          <div className="station-rail__spacer" />
          <Link href="/m" title="Phone companion">
            <i className="fa-solid fa-mobile-screen" aria-hidden />
          </Link>
          <Link href="/orders" title="Full dashboard">
            <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden />
          </Link>
        </nav>
        <div className="station-main">
          <header className="station-topbar">
            <h1>Order Manager</h1>
            <div className="station-topbar__meta">
              <span className="station-pill station-pill--muted">{shopName}</span>
              {store && (
                <span className={`station-pill ${statusTone}`}>
                  {storeStatusLabel(store)}
                </span>
              )}
              {store && (
                <span className="station-pill station-pill--muted">
                  Prep {store.effective_prep_minutes} min
                </span>
              )}
              <ThemeToggle />
            </div>
          </header>
          {children}
        </div>
      </div>
    </StationOrdersProvider>
  );
}
