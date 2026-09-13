"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { registerStationServiceWorker } from "@/lib/companion-push";

export function StationShell({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();
  const shopName =
    user?.active_account?.business_name ||
    user?.account?.business_name ||
    "DukAI Station";

  useEffect(() => {
    void registerStationServiceWorker();
  }, []);

  return (
    <div className="station-root station-root--pos">
      <nav className="station-rail" aria-label="Station navigation">
        <div className="station-rail__logo" title="DukAI">
          <DukAiLogoMark size={28} color="#c19a7c" accentColor="#a86b55" />
        </div>
        <Link href="/station" className="is-active" title="Point of sale">
          <i className="fa-solid fa-cash-register" aria-hidden />
        </Link>
        <div className="station-rail__spacer" />
        <Link href="/m" title="Phone companion">
          <i className="fa-solid fa-mobile-screen" aria-hidden />
        </Link>
        <Link href="/orders" title="Orders">
          <i className="fa-solid fa-receipt" aria-hidden />
        </Link>
        <Link href="/dashboard" title="Dashboard">
          <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden />
        </Link>
      </nav>
      <div className="station-main">
        <header className="station-topbar">
          <h1>Point of sale</h1>
          <div className="station-topbar__meta">
            <span className="station-pill station-pill--muted">{shopName}</span>
            <ThemeToggle />
          </div>
        </header>
        <div className="station-pos-host fb-app">{children}</div>
      </div>
    </div>
  );
}
