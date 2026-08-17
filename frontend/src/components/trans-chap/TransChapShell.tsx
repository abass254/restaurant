"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function TransChapShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = NAV.find((item) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const heading = pathname.startsWith("/trans-chap/make-a-sale/receipt")
    ? "Receipt"
    : pathname.startsWith("/trans-chap/make-a-sale/new")
      ? "Make a sale"
      : pathname.startsWith("/trans-chap/install")
        ? "Download"
        : pathname.startsWith("/trans-chap/sign-in")
          ? "Sign in"
          : (active?.title ?? "Trans Chap");
  const showNav = !pathname.startsWith("/trans-chap/sign-in");

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
          <header className="trans-chap-top">
            <div className="auth-split__brand trans-chap-brand">
              <Link href="/trans-chap" className="auth-split__logo" aria-label="DukAI home">
                <span className="auth-split__wordmark">duk</span>
                <DukAiLogoMark size={48} color="currentColor" accentColor="#e85d04" />
                <span className="auth-split__wordmark">
                  ai<span className="auth-split__tm">™</span>
                </span>
              </Link>
            </div>
            <div className="mobile-header">
              <div>
                <h1>{heading}</h1>
              </div>
              <div className="mobile-header__actions">
                <ThemeToggle />
              </div>
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
