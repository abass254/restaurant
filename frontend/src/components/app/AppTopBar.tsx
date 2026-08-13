"use client";

import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { AuthUser } from "@/lib/types";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { ThemeToggle } from "./ThemeToggle";
import { MerchantSwitcher } from "./MerchantSwitcher";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppTopBar({
  user,
  onToggleSidebar,
  sidebarExpanded = false,
}: {
  user: AuthUser;
  onToggleSidebar?: () => void;
  sidebarExpanded?: boolean;
}) {
  const businessName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    user.user_role?.replace(/_/g, " ") ||
    "Merchant";

  async function logout() {
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.href = "/sign-in";
  }

  return (
    <header className="fb-topbar">
      <div className="fb-topbar__left">
        {onToggleSidebar ? (
          <button
            type="button"
            className="fb-icon-btn fb-topbar__menu"
            aria-label={sidebarExpanded ? "Close sidebar" : "Open sidebar"}
            aria-expanded={sidebarExpanded}
            aria-controls="app-sidebar"
            onClick={onToggleSidebar}
          >
            <i className="fas fa-bars" aria-hidden="true" />
          </button>
        ) : null}

        <Link href="/dashboard" className="fb-topbar__logo" aria-label="DukAI home">
          <span className="fb-topbar__logo-text">duk</span>
          <DukAiLogoMark size={36} color="#0d1b2a" accentColor="#1877f2" />
          <span className="fb-topbar__logo-text">
            ai<span className="fb-topbar__tm">™</span>
          </span>
        </Link>
      </div>

      <div className="fb-topbar__actions">
        <MerchantSwitcher user={user} className="fb-topbar__merchant-switch" />
        <ThemeToggle />

        <button
          type="button"
          className="fb-topbar__notify"
          aria-label="Notifications"
          title="Notifications"
        >
          <i className="fas fa-bell" aria-hidden="true" />
        </button>

        <button
          type="button"
          className="fb-topbar__user"
          onClick={() => void logout()}
          title="Log out"
        >
          <span className="fb-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span className="fb-topbar__user-meta">
            <span className="fb-topbar__user-name">{user.name}</span>
            <span className="fb-topbar__user-role">{businessName}</span>
          </span>
        </button>
      </div>
    </header>
  );
}
