"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { FullscreenToggle } from "@/components/app/FullscreenToggle";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import {
  isShopOwner,
  userCanAccessPath,
  userCanAccessSection,
  type MerchantSection,
} from "@/lib/merchant-permissions";
import { migrateLegacyTransChapPurchases } from "@/lib/trans-chap-purchases";
import { detectTransChapMachine, syncTransChapMachine } from "@/lib/trans-chap-machine";

const NAV_COLLAPSED_KEY = "trans-chap-nav-collapsed";

const NAV: Array<{
  href: string;
  label: string;
  title: string;
  icon: string;
  exact?: boolean;
  section?: MerchantSection;
  requiresInstagram?: boolean;
  ownerOnly?: boolean;
}> = [
  { href: "/trans-chap", label: "Home", title: "Home", icon: "fa-house", exact: true },
  {
    href: "/trans-chap/stocks",
    label: "Inventory",
    title: "Inventory",
    icon: "fa-boxes-stacked",
    section: "inventory",
  },
  {
    href: "/trans-chap/make-a-sale",
    label: "Sales",
    title: "Sales",
    icon: "fa-receipt",
    section: "pos",
  },
  {
    href: "/trans-chap/pos",
    label: "POS",
    title: "POS",
    icon: "fa-cash-register",
    section: "pos",
  },
  {
    href: "/trans-chap/customers",
    label: "Customers",
    title: "Customers",
    icon: "fa-address-book",
    section: "customer",
  },
  {
    href: "/trans-chap/purchases",
    label: "Purchases",
    title: "Purchases",
    icon: "fa-truck",
    section: "inventory",
  },
  {
    href: "/trans-chap/settings",
    label: "Settings",
    title: "Settings",
    icon: "fa-gear",
    section: "settings",
  },
];

function headerMeta(pathname: string, mode: string | null): { title: string; backHref: string | null } {
  if (pathname.startsWith("/trans-chap/make-a-sale/receipt")) {
    return { title: "Receipt", backHref: "/trans-chap/make-a-sale" };
  }
  if (pathname.startsWith("/trans-chap/make-a-sale/new")) {
    return {
      title: mode === "select" || mode === "single" ? "Select" : "Scan",
      backHref: "/trans-chap/make-a-sale",
    };
  }
  if (pathname.startsWith("/trans-chap/purchases/unavailable")) {
    return { title: "Buy", backHref: "/trans-chap/purchases" };
  }
  if (pathname.startsWith("/trans-chap/purchases/new")) {
    return {
      title: mode === "select" || mode === "single" ? "Select buy" : "Scan buy",
      backHref: "/trans-chap/purchases",
    };
  }
  if (pathname.startsWith("/trans-chap/stocks/menu")) {
    return { title: "Hotel menu", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/stocks/opening")) {
    return { title: "Opening stock", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/stocks/edit")) {
    return { title: "Edit product", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/stocks/stock-up")) {
    return { title: "Purchases", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/credit")) {
    return { title: "On tab", backHref: "/trans-chap/customers" };
  }
  if (pathname.startsWith("/trans-chap/customers")) {
    return { title: "Customers", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/reports")) {
    return { title: "Reports", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/feeds/new")) {
    return { title: "New post", backHref: "/trans-chap/feeds" };
  }
  if (pathname.startsWith("/trans-chap/feeds/analytics")) {
    return { title: "Reports", backHref: "/trans-chap/reports" };
  }
  if (pathname.startsWith("/trans-chap/feeds")) {
    return { title: "Feeds", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/chats")) {
    return { title: "Chats", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/install")) {
    return { title: "Download", backHref: "/trans-chap/settings" };
  }
  if (pathname.startsWith("/trans-chap/sign-in")) {
    return { title: "Sign in", backHref: null };
  }
  if (pathname === "/trans-chap" || pathname === "/trans-chap/") {
    return { title: "Home", backHref: null };
  }
  const tab = NAV.find((item) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (tab) {
    return { title: tab.title, backHref: tab.exact ? null : "/trans-chap" };
  }
  return { title: "Trans Chap", backHref: "/trans-chap" };
}

export function TransChapShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useOptionalAuthUser();
  const { title, backHref } = headerMeta(pathname, searchParams.get("mode"));
  const isSignIn = pathname.startsWith("/trans-chap/sign-in");
  const isNewPost = pathname.startsWith("/trans-chap/feeds/new");
  const isPos = pathname.startsWith("/trans-chap/pos");
  const showNav = !isSignIn && !isNewPost;
  const showHeader = !isSignIn && !isNewPost;
  const instagramConnected = Boolean(user?.instagram_account);
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    try {
      setNavCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === "1");
    } catch {
      setNavCollapsed(false);
    }
  }, []);

  function toggleNavCollapsed() {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const items = useMemo(
    () =>
      NAV.filter((item) => {
        if (item.ownerOnly && (user == null || !isShopOwner(user))) {
          return false;
        }
        if (item.section && (user == null || !userCanAccessSection(user, item.section))) {
          return false;
        }
        if (item.requiresInstagram && !instagramConnected) return false;
        return true;
      }),
    [instagramConnected, user],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      syncTransChapMachine(detectTransChapMachine());
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  useEffect(() => {
    const accountId = user?.active_account?.id || user?.account?.id;
    if (!accountId) return;
    void migrateLegacyTransChapPurchases(accountId);
  }, [user?.account?.id, user?.active_account?.id]);

  useEffect(() => {
    if (!user || isSignIn) return;
    if (!userCanAccessPath(user, pathname)) {
      router.replace("/trans-chap");
    }
  }, [isSignIn, pathname, router, user]);

  function renderNavLink(item: (typeof NAV)[number]): ReactNode {
    const isActive = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={isActive ? "is-active" : ""}
        aria-label={item.label}
        title={item.label}
      >
        <span className="mobile-nav__icon">
          <i className={`fa-solid ${item.icon}`} aria-hidden />
        </span>
        <span className="mobile-nav__label">{item.label}</span>
      </Link>
    );
  }

  return (
    <div className={`auth-split trans-chap-root${isSignIn ? " trans-chap-root--signin" : ""}`}>
      <section className="auth-split__panel">
        <div
          className={`mobile-root trans-chap-app${isNewPost ? " trans-chap-app--new-post" : ""}${isPos ? " trans-chap-app--pos" : ""}${navCollapsed ? " trans-chap-app--nav-collapsed" : ""}`}
        >
          {showHeader ? (
            <header className="trans-chap-header">
              <div className="trans-chap-header__side">
                {backHref ? (
                  <Link href={backHref} className="trans-chap-header__icon" aria-label="Back">
                    <i className="fa-solid fa-chevron-left" aria-hidden />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="trans-chap-header__icon"
                    aria-label="Back"
                    onClick={() => router.back()}
                  >
                    <i className="fa-solid fa-chevron-left" aria-hidden />
                  </button>
                )}
              </div>
              <div className="trans-chap-header__center">
                <h1>{title}</h1>
              </div>
              <div className="trans-chap-header__side trans-chap-header__side--end">
                <FullscreenToggle className="trans-chap-header__icon" />
                <ThemeToggle />
                <span className="trans-chap-header__logo" aria-hidden>
                  <TransChapLogoMark size={34} color="currentColor" accentColor="#e8412a" />
                </span>
              </div>
            </header>
          ) : null}
          <main className="trans-chap-app__content">{children}</main>
          {showNav ? (
            <nav
              className={`mobile-nav mobile-nav--${Math.min(Math.max(items.length, 3), 7)}`}
              aria-label="Trans Chap navigation"
            >
              <button
                type="button"
                className="mobile-nav__collapse"
                aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-pressed={navCollapsed}
                title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={toggleNavCollapsed}
              >
                <i
                  className={`fa-solid ${navCollapsed ? "fa-angles-right" : "fa-angles-left"}`}
                  aria-hidden
                />
                <span className="mobile-nav__label">
                  {navCollapsed ? "Expand" : "Collapse"}
                </span>
              </button>
              {items.map((item) => renderNavLink(item))}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
