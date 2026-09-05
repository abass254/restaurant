"use client";

import Link from "next/link";
import { OnlineRidersBadge } from "@/components/app/OnlineRidersBadge";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import type { AuthUser } from "@/lib/types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const SHORTCUTS = [
  { href: "/orders", icon: "fa-receipt", label: "Orders", section: "orders" as const },
  { href: "/inventory", icon: "fa-boxes-stacked", label: "Inventory", section: "inventory" as const },
  { href: "/delivery", icon: "fa-motorcycle", label: "Delivery", section: "delivery" as const },
  { href: "/settings", icon: "fa-gear", label: "Shop settings", section: "settings" as const },
];

export function AppRightRail({ user }: { user: AuthUser }) {
  const business = user.active_account ?? user.account;
  const ig = user.instagram_account;
  const shortcuts = SHORTCUTS.filter((item) =>
    userCanAccessSection(user, item.section),
  );

  return (
    <aside className="fb-rail" aria-label="Shortcuts">
      <div className="fb-rail-card">
        <div className="fb-rail-profile">
          <span className="fb-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        {business ? (
          <p className="fb-rail-card__meta">
            {business.business_name}
            {business.business_location ? ` · ${business.business_location}` : ""}
          </p>
        ) : null}
        <OnlineRidersBadge />
      </div>

      <div className="fb-rail-card">
        <h3>Your shortcuts</h3>
        <ul className="fb-rail-links">
          {shortcuts.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>
                <i className={`fas ${item.icon}`} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          ))}
          {ig?.username ? (
            <li>
              <Link href="/settings#section-channels">
                <i className="fab fa-instagram" aria-hidden="true" />
                @{ig.username}
              </Link>
            </li>
          ) : (
            <li>
              <Link href="/settings#section-channels">
                <i className="fab fa-instagram" aria-hidden="true" />
                Connect Instagram
              </Link>
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}
