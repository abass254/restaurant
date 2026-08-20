"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import {
  userCanAccessSection,
  type MerchantSection,
} from "@/lib/merchant-permissions";

const NAV: Array<{
  href: string;
  label: string;
  title: string;
  icon: string;
  exact?: boolean;
  section?: MerchantSection;
  requiresInstagram?: boolean;
}> = [
  { href: "/trans-chap", label: "Home", title: "Home", icon: "fa-house", exact: true },
  {
    href: "/trans-chap/make-a-sale",
    label: "Sales",
    title: "Sales",
    icon: "fa-cash-register",
  },
  {
    href: "/trans-chap/chats",
    label: "Chats",
    title: "Chats",
    icon: "fa-comments",
    section: "tickets",
    requiresInstagram: true,
  },
  {
    href: "/trans-chap/feeds",
    label: "Feeds",
    title: "Feeds",
    icon: "fa-images",
    section: "feeds",
    requiresInstagram: true,
  },
  { href: "/trans-chap/settings", label: "Settings", title: "Settings", icon: "fa-gear" },
];

function headerMeta(pathname: string): { title: string; backHref: string | null } {
  if (pathname.startsWith("/trans-chap/make-a-sale/receipt")) {
    return { title: "Receipt", backHref: "/trans-chap/make-a-sale" };
  }
  if (pathname.startsWith("/trans-chap/make-a-sale/new")) {
    return { title: "New sale", backHref: "/trans-chap/make-a-sale" };
  }
  if (pathname.startsWith("/trans-chap/purchases/new")) {
    return { title: "New purchase", backHref: "/trans-chap/purchases" };
  }
  if (pathname.startsWith("/trans-chap/purchases")) {
    return { title: "Purchases", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/stocks/stock-up")) {
    return { title: "Stock up", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/stocks")) {
    return { title: "Stocks", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/reports")) {
    return { title: "Reports", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/feeds/analytics")) {
    return { title: "Feed analytics", backHref: "/trans-chap/feeds" };
  }
  if (pathname.startsWith("/trans-chap/install")) {
    return { title: "Download", backHref: "/trans-chap/settings" };
  }
  if (pathname.startsWith("/trans-chap/sign-in")) {
    return { title: "Sign in", backHref: null };
  }
  if (pathname === "/trans-chap" || pathname === "/trans-chap/") {
    return { title: "Trans Chap", backHref: null };
  }
  const tab = NAV.find((item) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return { title: tab?.title ?? "Trans Chap", backHref: null };
}

export function TransChapShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useOptionalAuthUser();
  const { title, backHref } = headerMeta(pathname);
  const isSignIn = pathname.startsWith("/trans-chap/sign-in");
  const showNav = !isSignIn;
  const instagramConnected = Boolean(user?.instagram_account);
  const items = useMemo(
    () =>
      NAV.filter(
        (item) =>
          !item.section || (user != null && userCanAccessSection(user, item.section)),
      ),
    [user],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <div className={`auth-split trans-chap-root${isSignIn ? " trans-chap-root--signin" : ""}`}>
      <section className="auth-split__panel">
        <div className="mobile-root trans-chap-app">
          {isSignIn ? null : (
            <header className="trans-chap-header">
              <div className="trans-chap-header__side">
                {backHref ? (
                  <Link href={backHref} className="trans-chap-header__icon" aria-label="Back">
                    <i className="fa-solid fa-chevron-left" aria-hidden />
                  </Link>
                ) : (
                  <Link href="/trans-chap" className="trans-chap-header__icon" aria-label="Trans Chap home">
                    <DukAiLogoMark size={42} color="currentColor" accentColor="#e85d04" />
                  </Link>
                )}
              </div>
              <div className="trans-chap-header__center">
                <span className="trans-chap-header__logo" aria-hidden>
                  <TransChapLogoMark size={34} color="currentColor" accentColor="#e8412a" />
                </span>
                <h1>{title}</h1>
              </div>
              <div className="trans-chap-header__side trans-chap-header__side--end">
                <ThemeToggle />
              </div>
            </header>
          )}
          <main className="trans-chap-app__content">{children}</main>
          {showNav ? (
            <nav
              className={`mobile-nav mobile-nav--${items.length}`}
              aria-label="Trans Chap navigation"
            >
              {items.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const disabled = Boolean(item.requiresInstagram && !instagramConnected);
                if (disabled) {
                  return (
                    <span
                      key={item.href}
                      className="is-disabled"
                      aria-disabled="true"
                      title="Connect Instagram to use this"
                    >
                      <i className={`fa-solid ${item.icon}`} aria-hidden />
                      {item.label}
                    </span>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={isActive ? "is-active" : ""}
                  >
                    <i className={`fa-solid ${item.icon}`} aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
