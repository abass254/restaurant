"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { PwaInstallBanner } from "@/components/station/PwaInstallBanner";
import { CompanionOrderNotifier } from "@/components/station/CompanionOrderNotifier";
import { StationNewOrderAlert } from "@/components/station/StationNewOrderAlert";
import { StationOrdersProvider } from "@/components/station/StationOrdersContext";
import { useStoreStatus } from "@/hooks/useStation";
import { storeStatusLabel } from "@/lib/station";

const NAV = [
  { href: "/m", label: "Home", icon: "fa-house", exact: true },
  { href: "/m/orders", label: "Orders", icon: "fa-receipt" },
  { href: "/m/stock", label: "Stock", icon: "fa-box" },
  { href: "/m/settings", label: "Settings", icon: "fa-gear" },
  { href: "/m/profile", label: "Profile", icon: "fa-user" },
] as const;

export function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthUser();
  const { store } = useStoreStatus();
  const shopName =
    store?.business_name ||
    user?.active_account?.business_name ||
    user?.account?.business_name ||
    "DukAI";

  return (
    <StationOrdersProvider>
      <div className="mobile-root">
        <StationNewOrderAlert />
        <CompanionOrderNotifier />
        <header className="mobile-header">
          <div>
            <h1>{shopName}</h1>
            {store && (
              <span
                className={`station-pill ${
                  store.orders_paused
                    ? "station-pill--danger"
                    : store.busy_extra_prep_minutes > 0
                      ? "station-pill--warn"
                      : "station-pill--ok"
                }`}
              >
                {storeStatusLabel(store)}
              </span>
            )}
          </div>
          <div className="mobile-header__actions">
            <ThemeToggle />
            <Link href="/station" className="station-btn" title="Open tablet station">
              <i className="fa-solid fa-tablet-screen-button" aria-hidden />
            </Link>
          </div>
        </header>
        <PwaInstallBanner />
        <main className="mobile-content">{children}</main>
        <nav className="mobile-nav" aria-label="Companion navigation">
          {NAV.map((item) => {
            const active =
              "exact" in item && item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "is-active" : ""}
              >
                <i className={`fa-solid ${item.icon}`} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </StationOrdersProvider>
  );
}
