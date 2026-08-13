"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, LayoutGroup, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  formatNavBadgeCount,
  navLinkIsActive,
  type MerchantNavLink,
} from "@/lib/merchant-nav";
import { filterNavLinksForUser } from "@/lib/merchant-permissions";
import { useNavCounts } from "@/lib/use-nav-counts";
import { springSoft } from "@/lib/motion";
import { useAuthUser } from "@/components/app/AuthProvider";
import { MerchantSwitcher } from "@/components/app/MerchantSwitcher";
import { ThemeToggle } from "@/components/app/ThemeToggle";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function NavItems({
  links,
  pathname,
  counts,
  expanded,
  reduce,
}: {
  links: MerchantNavLink[];
  pathname: string;
  counts: ReturnType<typeof useNavCounts>;
  expanded: boolean;
  reduce: boolean | null;
}) {
  return (
    <>
      {links.map((link, index) => {
        const isActive = navLinkIsActive(pathname, link.href);
        const badgeCount = link.badgeKey ? counts[link.badgeKey] : 0;
        const badgeLabel = formatNavBadgeCount(badgeCount);
        const content = (
          <>
            {isActive ? (
              <motion.span
                layoutId={reduce ? undefined : "sidebar-active-pill"}
                className="fb-sidebar__active-pill"
                aria-hidden="true"
                transition={reduce ? { duration: 0 } : springSoft}
              />
            ) : null}
            <span className="fb-sidebar__icon-wrap">
              <i className={`fas ${link.icon}`} aria-hidden="true" />
              {badgeLabel ? (
                <span className="fb-sidebar__badge" aria-hidden="true">
                  {badgeLabel}
                </span>
              ) : null}
            </span>
            <span className="fb-sidebar__label">{link.label}</span>
            {expanded && badgeLabel ? (
              <span className="fb-sidebar__badge fb-sidebar__badge--inline" aria-hidden="true">
                {badgeLabel}
              </span>
            ) : null}
          </>
        );

        const ariaLabel =
          badgeCount > 0 ? `${link.label}, ${badgeCount} new` : link.label;

        return (
          <li
            key={`${link.href}-${link.label}-${index}`}
            className={isActive ? "fb-sidebar__item is-active" : "fb-sidebar__item"}
          >
            {link.disabled ? (
              <span
                className={`fb-sidebar__link is-disabled${isActive ? " is-active" : ""}`}
                title={expanded ? undefined : link.label}
                aria-label={ariaLabel}
                aria-disabled="true"
              >
                {content}
              </span>
            ) : (
              <Link
                href={link.href}
                className={`fb-sidebar__link${isActive ? " is-active" : ""}`}
                title={expanded ? undefined : link.label}
                aria-label={ariaLabel}
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </>
  );
}

export function AppSidebar({ expanded = false }: { expanded?: boolean } = {}) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const counts = useNavCounts();
  const user = useAuthUser();
  const navLinks = filterNavLinksForUser(user);
  const otherHrefs = new Set(["/settings", "/basics"]);
  const primaryLinks = navLinks.filter((link) => !otherHrefs.has(link.href));
  const otherLinks = navLinks.filter((link) => otherHrefs.has(link.href));

  async function logout() {
    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/sign-in";
  }

  return (
    <aside
      id="app-sidebar"
      className={`fb-sidebar${expanded ? " fb-sidebar--expanded" : ""}`}
      aria-label="Primary navigation"
    >
      <div className="fb-sidebar__profile">
        <div className="fb-sidebar__profile-row">
          <span className="fb-avatar fb-sidebar__profile-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span className="fb-sidebar__profile-name">{user.name}</span>
        </div>
        <MerchantSwitcher user={user} className="fb-sidebar__merchant-switch" />
      </div>

      <LayoutGroup id="sidebar-active">
        <ul className="fb-sidebar__nav">
          <NavItems
            links={primaryLinks}
            pathname={pathname}
            counts={counts}
            expanded={expanded}
            reduce={reduce}
          />
          {otherLinks.length > 0 ? (
            <>
              <li className="fb-sidebar__group-label" aria-hidden="true">
                Other
              </li>
              <NavItems
                links={otherLinks}
                pathname={pathname}
                counts={counts}
                expanded={expanded}
                reduce={reduce}
              />
            </>
          ) : null}
        </ul>
      </LayoutGroup>

      <div className="fb-sidebar__footer">
        <div className="fb-sidebar__divider" />
        <div className="fb-sidebar__theme">
          <ThemeToggle />
          <span className="fb-sidebar__theme-label">Theme</span>
        </div>
        <button
          type="button"
          className="fb-sidebar__link fb-sidebar__logout"
          onClick={() => void logout()}
          title={expanded ? undefined : "Log out"}
          aria-label="Log out"
        >
          <span className="fb-sidebar__icon-wrap">
            <i className="fas fa-right-from-bracket" aria-hidden="true" />
          </span>
          <span className="fb-sidebar__label">Log out</span>
        </button>
      </div>
    </aside>
  );
}
