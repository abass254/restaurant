"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import { formatNavBadgeCount } from "@/lib/merchant-nav";
import {
  userCanAccessSection,
  type MerchantSection,
} from "@/lib/merchant-permissions";
import { useNavCounts } from "@/lib/use-nav-counts";
import { migrateLegacyTransChapPurchases } from "@/lib/trans-chap-purchases";
import { detectTransChapMachine, syncTransChapMachine } from "@/lib/trans-chap-machine";

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
    href: "/trans-chap/purchases",
    label: "Purchases",
    title: "Purchases",
    icon: "fa-truck",
  },
  {
    href: "/trans-chap/feeds",
    label: "Feeds",
    title: "Feeds",
    icon: "fa-images",
    section: "feeds",
    requiresInstagram: true,
  },
];

const CREATE_ACTIONS: Array<{
  href: string;
  label: string;
  icon: string;
  requiresInstagram?: boolean;
  section?: MerchantSection;
}> = [
  {
    href: "/trans-chap/make-a-sale/new",
    label: "New sale",
    icon: "fa-cash-register",
  },
  {
    href: "/trans-chap/purchases/new",
    label: "New purchase",
    icon: "fa-cart-plus",
  },
  {
    href: "/trans-chap/feeds/new",
    label: "New post",
    icon: "fa-plus",
    requiresInstagram: true,
    section: "feeds",
  },
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
  if (pathname.startsWith("/trans-chap/stocks/stock-up")) {
    return { title: "Stock up", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/stocks")) {
    return { title: "Stocks", backHref: "/trans-chap" };
  }
  if (pathname.startsWith("/trans-chap/credit")) {
    return { title: "On tab", backHref: "/trans-chap" };
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
    return { title: "Feeds", backHref: null };
  }
  if (pathname.startsWith("/trans-chap/chats")) {
    return { title: "Chats", backHref: null };
  }
  if (pathname.startsWith("/trans-chap/settings")) {
    return { title: "Settings", backHref: null };
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
  const router = useRouter();
  const user = useOptionalAuthUser();
  const counts = useNavCounts();
  const { title, backHref } = headerMeta(pathname);
  const isSignIn = pathname.startsWith("/trans-chap/sign-in");
  const isNewPost = pathname.startsWith("/trans-chap/feeds/new");
  const showNav = !isSignIn && !isNewPost;
  const showHeader = !isSignIn && !isNewPost;
  const instagramConnected = Boolean(user?.instagram_account);
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () =>
      NAV.filter((item) => {
        if (item.section && (user == null || !userCanAccessSection(user, item.section))) {
          return false;
        }
        if (item.requiresInstagram && !instagramConnected) return false;
        return true;
      }),
    [instagramConnected, user],
  );

  const createActions = useMemo(
    () =>
      CREATE_ACTIONS.filter((action) => {
        if (action.section && (user == null || !userCanAccessSection(user, action.section))) {
          return false;
        }
        if (action.requiresInstagram && !instagramConnected) return false;
        return true;
      }),
    [instagramConnected, user],
  );

  const canAccessChats =
    user != null &&
    userCanAccessSection(user, "tickets") &&
    Boolean(user.instagram_account);
  const chatsBadge = formatNavBadgeCount(counts.messages);

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
    setCreateOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!createOpen) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (createRef.current && target && !createRef.current.contains(target)) {
        setCreateOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setCreateOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [createOpen]);

  const homeItem = items.find((item) => item.exact);
  const salesItem = items.find((item) => item.href === "/trans-chap/make-a-sale");
  const purchasesItem = items.find((item) => item.href === "/trans-chap/purchases");
  const feedsItem = items.find((item) => item.href === "/trans-chap/feeds");

  function renderNavLink(
    item: (typeof NAV)[number] | undefined,
  ): ReactNode {
    if (!item) return null;
    const isActive = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    const disabled = Boolean(item.requiresInstagram && !instagramConnected);
    const icon = (
      <span className="mobile-nav__icon">
        <i className={`fa-solid ${item.icon}`} aria-hidden />
      </span>
    );
    if (disabled) return null;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={isActive ? "is-active" : ""}
        aria-label={item.label}
      >
        {icon}
        {item.label}
      </Link>
    );
  }

  return (
    <div className={`auth-split trans-chap-root${isSignIn ? " trans-chap-root--signin" : ""}`}>
      <section className="auth-split__panel">
        <div className={`mobile-root trans-chap-app${isNewPost ? " trans-chap-app--new-post" : ""}`}>
          {showHeader ? (
            <header className="trans-chap-header">
              <div className="trans-chap-header__side">
                {backHref ? (
                  <Link href={backHref} className="trans-chap-header__icon" aria-label="Back">
                    <i className="fa-solid fa-chevron-left" aria-hidden />
                  </Link>
                ) : (
                  <Link href="/trans-chap" className="trans-chap-header__icon" aria-label="Trans Chap home">
                    <i className="fa-solid fa-house" aria-hidden />
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
                {canAccessChats ? (
                  <Link
                    href="/trans-chap/chats"
                    className={`trans-chap-header__icon${
                      pathname.startsWith("/trans-chap/chats") ? " is-active" : ""
                    }`}
                    aria-label={
                      counts.messages > 0
                        ? `Chats, ${counts.messages} new`
                        : "Chats"
                    }
                  >
                    <span className="trans-chap-header__icon-wrap">
                      <i className="fa-solid fa-comments" aria-hidden />
                      {chatsBadge ? (
                        <span className="trans-chap-header__badge" aria-hidden="true">
                          {chatsBadge}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                ) : null}
                <Link
                  href="/trans-chap/settings"
                  className={`trans-chap-header__icon${
                    pathname.startsWith("/trans-chap/settings") ? " is-active" : ""
                  }`}
                  aria-label="Settings"
                >
                  <i className="fa-solid fa-gear" aria-hidden />
                </Link>
              </div>
            </header>
          ) : null}
          <main className="trans-chap-app__content">{children}</main>
          {showNav ? (
            <nav className="mobile-nav mobile-nav--create" aria-label="Trans Chap navigation">
              {renderNavLink(homeItem)}
              {renderNavLink(salesItem)}
              <div className="mobile-nav__create" ref={createRef}>
                {createOpen ? (
                  <div className="mobile-nav__create-menu" role="menu" aria-label="Create">
                    {createActions.map((action) => {
                      const disabled = Boolean(
                        action.requiresInstagram && !instagramConnected,
                      );
                      if (disabled) {
                        return (
                          <span
                            key={action.href}
                            className="mobile-nav__create-item is-disabled"
                            role="menuitem"
                            aria-disabled="true"
                            title="Connect Instagram to post"
                          >
                            <i className={`fa-solid ${action.icon}`} aria-hidden />
                            {action.label}
                          </span>
                        );
                      }
                      return (
                        <button
                          key={action.href}
                          type="button"
                          className="mobile-nav__create-item"
                          role="menuitem"
                          onClick={() => {
                            setCreateOpen(false);
                            router.push(action.href);
                          }}
                        >
                          <i className={`fa-solid ${action.icon}`} aria-hidden />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`mobile-nav__create-btn${createOpen ? " is-open" : ""}`}
                  aria-label={createOpen ? "Close create menu" : "Create"}
                  aria-expanded={createOpen}
                  aria-haspopup="menu"
                  onClick={() => setCreateOpen((open) => !open)}
                >
                  <i className={`fa-solid ${createOpen ? "fa-xmark" : "fa-plus"}`} aria-hidden />
                  <span className="mobile-nav__create-label" aria-hidden="true">
                    {createOpen ? "Close" : "Create"}
                  </span>
                </button>
              </div>
              {renderNavLink(purchasesItem)}
              {feedsItem ? renderNavLink(feedsItem) : <span className="mobile-nav__spacer" aria-hidden />}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
