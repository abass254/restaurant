"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, LayoutGroup, useReducedMotion } from "motion/react";
import { PageTransition } from "@/components/app/PageTransition";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { springSoft } from "@/lib/motion";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { AdminUserMenu } from "@/components/admin/AdminUserMenu";
import { SessionTimeoutGuard } from "@/components/app/SessionTimeoutGuard";

import { useAuthUser } from "@/components/app/AuthProvider";

type NavLink = {
  href: string;
  icon: string;
  label: string;
  matchPrefix?: boolean;
};

type Theme = "light" | "dark";

const links: NavLink[] = [
  { href: "/admin", icon: "fa-house", label: "Home" },
  {
    href: "/admin/users",
    icon: "fa-users",
    label: "Users",
    matchPrefix: true,
  },
  {
    href: "/admin/catalog",
    icon: "fa-boxes-stacked",
    label: "Catalog",
    matchPrefix: true,
  },
  {
    href: "/admin/merchants",
    icon: "fa-store",
    label: "Merchants",
    matchPrefix: true,
  },
  {
    href: "/admin/orders",
    icon: "fa-receipt",
    label: "Orders",
    matchPrefix: true,
  },
  {
    href: "/admin/mpesa",
    icon: "fa-mobile-screen",
    label: "M-PESA",
    matchPrefix: true,
  },
  {
    href: "/admin/tigo",
    icon: "fa-tower-cell",
    label: "Tigo Pesa",
    matchPrefix: true,
  },
  {
    href: "/admin/whatsapp",
    icon: "fa-brands fa-whatsapp",
    label: "WhatsApp",
    matchPrefix: true,
  },
  {
    href: "/admin/bot-test",
    icon: "fa-flask",
    label: "Test bot",
    matchPrefix: true,
  },
  {
    href: "/admin/webhooks",
    icon: "fa-tower-broadcast",
    label: "Webhook log",
    matchPrefix: true,
  },
  {
    href: "/admin/settings",
    icon: "fa-gear",
    label: "Settings",
    matchPrefix: true,
  },
];

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = localStorage.getItem("dukai-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();
  const pathname = usePathname();
  const isBotTest = pathname.startsWith("/admin/bot-test");
  const reduce = useReducedMotion();
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
    setMounted(true);
  }, []);

  async function logout() {
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.href = "/admin/login";
  }

  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dukai-theme", next);
  }

  return (
    <div className={`admin-app${isBotTest ? " admin-app--bot-test" : ""}`} data-theme={theme}>
      <SessionTimeoutGuard loginPath="/admin/login" />

      {/* Top Full-Width Navbar across entire window (matching reference screenshot) */}
      <header className="admin-app__navbar">
        <Link href="/admin" className="admin-app__navbar-brand">
          <div className="admin-app__brand-icon">
            <DukAiLogoMark size={22} />
          </div>
          <div className="admin-app__brand-text">
            <span className="admin-app__brand-title">
              Duk<span className="admin-app__brand-accent">AI</span>
            </span>
            <span className="admin-app__brand-sub">ADMIN CONSOLE</span>
          </div>
        </Link>

        <div className="admin-app__navbar-right">
          {user?.email ? (
            <span className="admin-app__navbar-email" title={user.email}>
              {user.email}
            </span>
          ) : null}

          <Link
            href="/dashboard"
            className="admin-app__switcher-btn"
            title="Open Merchant Dashboard app"
          >
            <span>Merchant app</span>
          </Link>

          <button
            type="button"
            className="admin-app__theme-toggle"
            onClick={toggleTheme}
            disabled={!mounted}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            {theme === "light" ? (
              <i className="fas fa-moon" aria-hidden="true" />
            ) : (
              <i className="fas fa-sun" aria-hidden="true" />
            )}
          </button>
          <AdminUserMenu />
        </div>
      </header>

      {/* Below-Navbar Layout: Sidebar on Left, Main Content on Right */}
      <div className="admin-app__layout">
        <aside className="admin-app__sidebar" aria-label="Admin navigation">
          <div className="admin-app__section-heading">TOOLS</div>

          <nav className="admin-app__nav">
            <LayoutGroup id="admin-sidebar-active">
              {links.map((link) => {
                const isActive = link.matchPrefix
                  ? pathname === link.href || pathname.startsWith(`${link.href}/`)
                  : pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`admin-app__nav-link${
                      isActive ? " is-active" : ""
                    }`}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId={reduce ? undefined : "admin-sidebar-active-pill"}
                        className="admin-app__nav-pill"
                        aria-hidden="true"
                        transition={reduce ? { duration: 0 } : springSoft}
                      />
                    ) : null}
                    <i className={`fas ${link.icon}`} aria-hidden="true" />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </LayoutGroup>
          </nav>

          <div className="admin-app__sidebar-footer">
            <Link href="/dashboard" className="admin-app__nav-link">
              <i className="fas fa-arrow-up-right-from-square" aria-hidden="true" />
              <span>Merchant view</span>
            </Link>
            <button
              type="button"
              className="admin-app__nav-link admin-app__nav-link--button"
              onClick={() => void logout()}
            >
              <i className="fas fa-right-from-bracket" aria-hidden="true" />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        <main
          className={`admin-app__content${isBotTest ? " admin-app__content--bot-test" : ""}`}
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
