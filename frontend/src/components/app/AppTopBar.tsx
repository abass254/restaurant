"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  formatNavBadgeCount,
  merchantTopTabLinks,
  navLinkIsActive,
  type MerchantNavLink,
} from "@/lib/merchant-nav";
import { filterNavLinksForUser } from "@/lib/merchant-permissions";
import { logoutToSignIn } from "@/lib/logout";
import type { AuthUser } from "@/lib/types";
import { useNavCounts } from "@/lib/use-nav-counts";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { FullscreenToggle } from "./FullscreenToggle";
import { MerchantSwitcher } from "./MerchantSwitcher";
import { ThemeToggle } from "./ThemeToggle";

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
  const router = useRouter();
  const pathname = usePathname();
  const counts = useNavCounts();
  const navLinks = filterNavLinksForUser(user);
  const barRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const businessName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    user.user_role?.replace(/_/g, " ") ||
    "Merchant";
  const email = user.email?.trim() || "";

  const topTabs = navLinks.filter((link) =>
    merchantTopTabLinks.some((tab) => tab.href === link.href),
  );
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navLinks;
    return navLinks.filter((link) => link.label.toLowerCase().includes(q));
  }, [navLinks, query]);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
    setQuery("");
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen && !searchOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!barRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setSearchOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, searchOpen]);

  function goTo(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  function onSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const first = searchResults[0];
    if (first) goTo(first.href);
  }

  return (
    <header className="fb-topbar" ref={barRef}>
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
          <DukAiLogoMark size={32} color="#1a100c" accentColor="#e85d04" />
          <span className="fb-topbar__logo-text">
            ai<span className="fb-topbar__tm">™</span>
          </span>
        </Link>

        <form className="fb-topbar__search" role="search" onSubmit={onSearchSubmit}>
          <label className="fb-topbar__search-wrap">
            <i className="fas fa-magnifying-glass" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder="Search pages"
              aria-label="Search pages"
              autoComplete="off"
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
            />
          </label>
          {searchOpen ? (
            <div className="fb-topbar__search-results" role="listbox" aria-label="Pages">
              {searchResults.length === 0 ? (
                <p className="fb-topbar__search-empty">No matching pages</p>
              ) : (
                searchResults.map((link) => (
                  <SearchResultRow
                    key={`${link.href}-${link.label}`}
                    link={link}
                    active={navLinkIsActive(pathname, link.href)}
                    counts={counts}
                    onSelect={goTo}
                  />
                ))
              )}
            </div>
          ) : null}
        </form>
      </div>

      <nav className="fb-topbar__center" aria-label="Primary sections">
        <div className="fb-topbar__tabs">
          {topTabs.map((link) => {
            const active = navLinkIsActive(pathname, link.href);
            const badgeCount = link.badgeKey ? counts[link.badgeKey] : 0;
            const badgeLabel = formatNavBadgeCount(badgeCount);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="fb-topbar__tab"
                aria-current={active ? "page" : undefined}
                aria-label={
                  badgeCount > 0 ? `${link.label}, ${badgeCount} new` : link.label
                }
                title={link.label}
              >
                <span className="fb-topbar__tab-icon-wrap">
                  <i className={`fas ${link.icon}`} aria-hidden="true" />
                  {badgeLabel ? (
                    <span className="fb-topbar__tab-badge" aria-hidden="true">
                      {badgeLabel}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <span className="fb-topbar__tab-indicator" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="fb-topbar__actions">
        <ThemeToggle />
        <FullscreenToggle />

        <Link
          href="/tickets"
          className="fb-topbar__notify"
          aria-label={
            counts.tickets > 0 ? `Tickets, ${counts.tickets} new` : "Notifications"
          }
          title="Tickets"
        >
          <i className="fas fa-bell" aria-hidden="true" />
          {formatNavBadgeCount(counts.tickets) ? (
            <span className="fb-topbar__icon-badge" aria-hidden="true">
              {formatNavBadgeCount(counts.tickets)}
            </span>
          ) : null}
        </Link>

        <div className="fb-topbar__profile">
          <button
            type="button"
            className="fb-topbar__user"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setSearchOpen(false);
              setMenuOpen((open) => !open);
            }}
          >
            <span className="fb-avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="fb-topbar__user-meta">
              <span className="fb-topbar__user-name">{user.name}</span>
              <span className="fb-topbar__user-role">{businessName}</span>
            </span>
          </button>
          {menuOpen ? (
            <div className="fb-topbar__menu-panel" role="menu" aria-label="Account">
              <div className="fb-topbar__menu-identity">
                <strong>{user.name}</strong>
                {email ? <span>{email}</span> : null}
              </div>
              <MerchantSwitcher user={user} className="fb-topbar__merchant-switch" />
              <Link
                href="/settings"
                className="fb-topbar__menu-item"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                <i className="fas fa-gear" aria-hidden="true" />
                Settings
              </Link>
              <Link
                href="/basics"
                className="fb-topbar__menu-item"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                <i className="fas fa-store" aria-hidden="true" />
                Shop profile
              </Link>
              <button
                type="button"
                className="fb-topbar__menu-item"
                role="menuitem"
                onClick={() => void logoutToSignIn()}
              >
                <i className="fas fa-right-from-bracket" aria-hidden="true" />
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function SearchResultRow({
  link,
  active,
  counts,
  onSelect,
}: {
  link: MerchantNavLink;
  active: boolean;
  counts: ReturnType<typeof useNavCounts>;
  onSelect: (href: string) => void;
}) {
  const badgeCount = link.badgeKey ? counts[link.badgeKey] : 0;
  const badgeLabel = formatNavBadgeCount(badgeCount);

  return (
    <button
      type="button"
      className={`fb-topbar__search-item${active ? " is-active" : ""}`}
      role="option"
      aria-selected={active}
      onClick={() => onSelect(link.href)}
    >
      <i className={`fas ${link.icon}`} aria-hidden="true" />
      <span>{link.label}</span>
      {badgeLabel ? <span className="fb-topbar__search-badge">{badgeLabel}</span> : null}
    </button>
  );
}
