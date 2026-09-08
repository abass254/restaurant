"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import {
  userCanAccessSection,
  type MerchantSection,
} from "@/lib/merchant-permissions";
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
    href: "/trans-chap/stocks",
    label: "Inventory",
    title: "Inventory",
    icon: "fa-boxes-stacked",
  },
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
    href: "/trans-chap/settings",
    label: "Settings",
    title: "Settings",
    icon: "fa-gear",
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
    return { title: "Buy new item", backHref: "/trans-chap/purchases" };
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
  if (pathname.startsWith("/trans-chap/stocks/edit")) {
    return { title: "Edit product", backHref: "/trans-chap/stocks" };
  }
  if (pathname.startsWith("/trans-chap/stocks/stock-up")) {
    return { title: "Purchases", backHref: "/trans-chap/stocks" };
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
  const showNav = !isSignIn && !isNewPost;
  const showHeader = !isSignIn && !isNewPost;
  const instagramConnected = Boolean(user?.instagram_account);

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
      >
        <span className="mobile-nav__icon">
          <i className={`fa-solid ${item.icon}`} aria-hidden />
        </span>
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
                <span className="trans-chap-header__logo" aria-hidden>
                  <TransChapLogoMark size={34} color="currentColor" accentColor="#e8412a" />
                </span>
              </div>
            </header>
          ) : null}
          <main className="trans-chap-app__content">{children}</main>
          {showNav ? (
            <nav className="mobile-nav mobile-nav--5" aria-label="Trans Chap navigation">
              {items.map((item) => renderNavLink(item))}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
