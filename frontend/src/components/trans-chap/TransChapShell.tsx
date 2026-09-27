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
import { logoutToSignIn } from "@/lib/logout";
import { migrateLegacyTransChapPurchases } from "@/lib/trans-chap-purchases";
import { detectTransChapMachine, syncTransChapMachine } from "@/lib/trans-chap-machine";

import { isRestaurantStore } from "@/lib/onboarding";

const NAV_COLLAPSED_KEY = "trans-chap-nav-collapsed";

type NavDef = {
  href: string;
  label: string;
  title: string;
  icon: string;
  exact?: boolean;
  section?: MerchantSection;
  anySections?: MerchantSection[];
  requiresInstagram?: boolean;
  ownerOnly?: boolean;
};

function getNavItems(restaurant: boolean): NavDef[] {
  return [
    { href: "/trans-chap", label: "Home", title: "Home", icon: "fa-house", exact: true },
    {
      href: "/trans-chap/stocks",
      label: restaurant ? "Hotel Menu" : "Inventory",
      title: restaurant ? "Hotel Menu" : "Inventory",
      icon: restaurant ? "fa-utensils" : "fa-boxes-stacked",
      section: "inventory",
    },
    {
      href: "/trans-chap/make-a-sale",
      label: restaurant ? "Orders" : "Sales",
      title: restaurant ? "Orders" : "Sales",
      icon: restaurant ? "fa-bell-concierge" : "fa-receipt",
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
      href: "/trans-chap/suppliers",
      label: "Suppliers",
      title: "Suppliers",
      icon: "fa-truck-field",
      anySections: ["supplier", "inventory"],
    },
    {
      href: "/trans-chap/purchases",
      label: restaurant ? "Supplies" : "Purchases",
      title: restaurant ? "Supplies" : "Purchases",
      icon: restaurant ? "fa-basket-shopping" : "fa-cart-shopping",
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
}

function headerMeta(
  pathname: string,
  mode: string | null,
  restaurant = false,
): { title: string; backHref: string | null } {
  if (pathname.startsWith("/trans-chap/make-a-sale/receipt")) {
    return { title: "Receipt", backHref: "/trans-chap/make-a-sale" };
  }
  if (pathname.startsWith("/trans-chap/make-a-sale/new")) {
    return {
      title:
        restaurant
          ? mode === "scan"
            ? "Scan order"
            : "Take order"
          : mode === "select" || mode === "single"
            ? "Select"
            : "Scan",
      backHref: "/trans-chap/make-a-sale",
    };
  }
  if (pathname.startsWith("/trans-chap/purchases/unavailable")) {
    return {
      title: restaurant ? "Buy supply" : "Buy",
      backHref: "/trans-chap/purchases",
    };
  }
  if (pathname.startsWith("/trans-chap/purchases/new")) {
    return {
      title:
        restaurant
          ? "Buy supplies"
          : mode === "scan"
            ? "Scan buy"
            : mode === "select" || mode === "single"
              ? "Select buy"
              : "New purchase",
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
    return {
      title: restaurant ? "Edit item" : "Edit product",
      backHref: "/trans-chap/stocks",
    };
  }
  if (pathname.startsWith("/trans-chap/stocks/stock-up")) {
    return {
      title: restaurant ? "Restock supplies" : "Purchases",
      backHref: "/trans-chap/stocks",
    };
  }
  if (pathname.startsWith("/trans-chap/stocks")) {
    return {
      title: restaurant ? "Hotel menu" : "Inventory",
      backHref: "/trans-chap",
    };
  }
  if (pathname.startsWith("/trans-chap/make-a-sale")) {
    return {
      title: restaurant ? "Orders" : "Sales",
      backHref: "/trans-chap",
    };
  }
  if (pathname.startsWith("/trans-chap/purchases")) {
    return {
      title: restaurant ? "Supplies" : "Purchases",
      backHref: "/trans-chap",
    };
  }
  if (pathname.startsWith("/trans-chap/credit")) {
    return { title: "On tab", backHref: "/trans-chap/customers" };
  }
  if (pathname.startsWith("/trans-chap/customers")) {
    return { title: "Customers", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/suppliers")) {
    return { title: "Suppliers", backHref: "/trans-chap" };
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
  const navItems = getNavItems(restaurant);
  const tab = navItems.find((item) =>
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
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const { title, backHref } = headerMeta(
    pathname,
    searchParams.get("mode"),
    restaurant,
  );
  const isSignIn = pathname.startsWith("/trans-chap/sign-in");
  const isNewPost = pathname.startsWith("/trans-chap/feeds/new");
  const isPos =
    pathname.startsWith("/trans-chap/pos") ||
    pathname.startsWith("/trans-chap/purchases/new") ||
    pathname.startsWith("/trans-chap/stocks/menu");
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
      getNavItems(restaurant).filter((item) => {
        if (item.ownerOnly && (user == null || !isShopOwner(user))) {
          return false;
        }
        if (item.anySections?.length) {
          if (
            user == null ||
            !item.anySections.some((section) => userCanAccessSection(user, section))
          ) {
            return false;
          }
        } else if (
          item.section &&
          (user == null || !userCanAccessSection(user, item.section))
        ) {
          return false;
        }
        if (item.requiresInstagram && !instagramConnected) return false;
        return true;
      }),
    [instagramConnected, restaurant, user],
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
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
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

  function renderNavLink(item: NavDef): ReactNode {
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

  const isHome = pathname === "/trans-chap" || pathname === "/trans-chap/";
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <div className={`auth-split trans-chap-root${isSignIn ? " trans-chap-root--signin" : ""}`}>
      <section className="auth-split__panel">
        <div
          className={`mobile-root trans-chap-app${isNewPost ? " trans-chap-app--new-post" : ""}${isPos ? " trans-chap-app--pos" : ""}${navCollapsed ? " trans-chap-app--nav-collapsed" : ""}`}
        >
          {showHeader ? (
            <header className="trans-chap-header">
              <div className="trans-chap-header__side">
                {isHome ? (
                  <span className="trans-chap-header__brand-logo" aria-label="Trans Chap">
                    <TransChapLogoMark size={28} color="var(--app-primary)" accentColor="#e8412a" />
                  </span>
                ) : backHref ? (
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
                <ThemeToggle />
                <button
                  type="button"
                  className="trans-chap-header__icon"
                  aria-label="Log out"
                  title="Log out"
                  onClick={() =>
                    void logoutToSignIn({ href: "/trans-chap/sign-in" })
                  }
                >
                  <i className="fa-solid fa-right-from-bracket" aria-hidden />
                </button>
              </div>
            </header>
          ) : null}
          <main className="trans-chap-app__content">{children}</main>
          {showNav ? (
            <>
              <nav
                className={`mobile-nav mobile-nav--${Math.min(
                  Math.max(items.length + 1, 3),
                  7,
                )}`}
                style={
                  {
                    "--mobile-nav-columns": Math.min(items.length + 1, 5),
                  } as React.CSSProperties
                }
                aria-label="Trans Chap navigation"
              >
                <div className="mobile-nav__brand">
                  <span className="mobile-nav__brand-icon" aria-hidden>
                    <TransChapLogoMark size={30} color="var(--app-primary)" accentColor="#e8412a" />
                  </span>
                  <div className="mobile-nav__brand-meta">
                    <strong className="mobile-nav__brand-title">Trans Chap</strong>
                    {user?.active_account?.business_name || user?.account?.business_name ? (
                      <span className="mobile-nav__brand-shop">
                        {user.active_account?.business_name || user.account?.business_name}
                      </span>
                    ) : null}
                  </div>
                </div>
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
                <button
                  type="button"
                  className={`mobile-nav__more-btn${moreOpen ? " is-active" : ""}`}
                  onClick={() => setMoreOpen(!moreOpen)}
                  aria-label="More navigation options"
                >
                  <span className="mobile-nav__icon">
                    <i className="fa-solid fa-ellipsis-vertical" aria-hidden />
                  </span>
                  <span className="mobile-nav__label">More</span>
                </button>
              </nav>

              {moreOpen ? (
                <div className="trans-chap-more-backdrop" onClick={() => setMoreOpen(false)}>
                  <div className="trans-chap-more-sheet" onClick={(e) => e.stopPropagation()}>
                    <header className="trans-chap-more-sheet__head">
                      <h3>Menu</h3>
                      <button
                        type="button"
                        className="trans-chap-more-sheet__close"
                        onClick={() => setMoreOpen(false)}
                      >
                        <i className="fa-solid fa-xmark" aria-hidden />
                      </button>
                    </header>
                    <div className="trans-chap-more-sheet__grid">
                      <Link
                        href="/trans-chap/pos"
                        className="trans-chap-more-sheet__item"
                        onClick={() => setMoreOpen(false)}
                      >
                        <i className="fa-solid fa-cash-register" aria-hidden />
                        <span>POS</span>
                      </Link>
                      <Link
                        href="/trans-chap/suppliers"
                        className="trans-chap-more-sheet__item"
                        onClick={() => setMoreOpen(false)}
                      >
                        <i className="fa-solid fa-truck-field" aria-hidden />
                        <span>Suppliers</span>
                      </Link>
                      <Link
                        href="/trans-chap/customers"
                        className="trans-chap-more-sheet__item"
                        onClick={() => setMoreOpen(false)}
                      >
                        <i className="fa-solid fa-address-book" aria-hidden />
                        <span>Customers</span>
                      </Link>
                      <Link
                        href="/trans-chap/reports"
                        className="trans-chap-more-sheet__item"
                        onClick={() => setMoreOpen(false)}
                      >
                        <i className="fa-solid fa-chart-pie" aria-hidden />
                        <span>Reports</span>
                      </Link>
                      <Link
                        href="/trans-chap/settings"
                        className="trans-chap-more-sheet__item"
                        onClick={() => setMoreOpen(false)}
                      >
                        <i className="fa-solid fa-gear" aria-hidden />
                        <span>Settings</span>
                      </Link>
                      <button
                        type="button"
                        className="trans-chap-more-sheet__item"
                        onClick={() =>
                          void logoutToSignIn({ href: "/trans-chap/sign-in" })
                        }
                      >
                        <i className="fa-solid fa-right-from-bracket" aria-hidden />
                        <span>Log out</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
