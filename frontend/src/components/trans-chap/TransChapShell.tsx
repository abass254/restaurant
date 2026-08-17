"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";

const NAV = [
  { href: "/trans-chap", label: "Home", title: "Home", icon: "fa-house", exact: true },
  {
    href: "/trans-chap/make-a-sale",
    label: "Sales",
    title: "Sales",
    icon: "fa-cash-register",
  },
  { href: "/trans-chap/settings", label: "Settings", title: "Settings", icon: "fa-gear" },
] as const;

function headerMeta(pathname: string): { title: string; backHref: string | null } {
  if (pathname.startsWith("/trans-chap/make-a-sale/receipt")) {
    return { title: "Receipt", backHref: "/trans-chap/make-a-sale" };
  }
  if (pathname.startsWith("/trans-chap/make-a-sale/new")) {
    return { title: "New sale", backHref: "/trans-chap/make-a-sale" };
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
  const showNav = !pathname.startsWith("/trans-chap/sign-in");
  const shopName =
    user?.active_account?.business_name || user?.account?.business_name || null;
  const subtitle =
    pathname === "/trans-chap" || pathname === "/trans-chap/" ? shopName : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <div className="auth-split trans-chap-root">
      <section className="auth-split__panel">
        <div className="mobile-root trans-chap-app">
          <header className="trans-chap-header">
            <div className="trans-chap-header__side">
              {backHref ? (
                <Link href={backHref} className="trans-chap-header__icon" aria-label="Back">
                  <i className="fa-solid fa-chevron-left" aria-hidden />
                </Link>
              ) : (
                <Link href="/trans-chap" className="trans-chap-header__brand" aria-label="Trans Chap home">
                  <DukAiLogoMark size={28} color="currentColor" accentColor="#e85d04" />
                </Link>
              )}
            </div>
            <div className="trans-chap-header__center">
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            <div className="trans-chap-header__side trans-chap-header__side--end">
              <ThemeToggle />
            </div>
          </header>
          <main className="trans-chap-app__content">{children}</main>
          {showNav ? (
            <nav className="mobile-nav mobile-nav--3" aria-label="Trans Chap navigation">
              {NAV.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
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
