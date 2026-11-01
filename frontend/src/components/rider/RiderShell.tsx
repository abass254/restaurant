"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { useRider } from "@/components/rider/RiderProvider";

export function RiderShell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useRider();
  const pathname = usePathname();
  const { canPrompt, promptInstall, installed, platform } = usePwaInstall();
  const isLogin = pathname === "/r/login";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  if (isLogin) {
    return <div className="rider-app">{children}</div>;
  }

  return (
    <div className="rider-app">
      <header className="rider-topbar">
        <div className="rider-topbar__brand">
          <span className="rider-topbar__mark">TransChap</span>
          <span className="rider-topbar__sub">Rider</span>
        </div>
        {!loading && me ? (
          <button type="button" className="rider-link-btn" onClick={() => void logout()}>
            Sign out
          </button>
        ) : null}
      </header>

      {!installed && canPrompt ? (
        <div className="rider-install">
          <p>Install the rider app for quicker access.</p>
          <button type="button" className="rider-btn rider-btn--ghost" onClick={() => void promptInstall()}>
            {platform === "ios" ? "How to install" : "Install"}
          </button>
        </div>
      ) : null}

      <main className="rider-main">{children}</main>

      {me ? (
        <nav className="rider-tabbar" aria-label="Rider navigation">
          <Link href="/r/home" className={pathname === "/r/home" ? "is-active" : undefined}>
            Home
          </Link>
          <Link
            href={me.is_online ? "/r/online" : "/r/home"}
            className={pathname === "/r/online" || pathname?.startsWith("/r/offer") ? "is-active" : undefined}
          >
            Online
          </Link>
          <Link href="/r/earnings" className={pathname === "/r/earnings" ? "is-active" : undefined}>
            Earnings
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
