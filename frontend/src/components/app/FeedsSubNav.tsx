"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/feeds", label: "Feed", icon: "fa-images" },
  { href: "/feeds/analytics", label: "Analytics", icon: "fa-chart-line" },
];

export function FeedsSubNav() {
  const pathname = usePathname();

  return (
    <nav className="tickets-subnav" aria-label="Feeds sections">
      {tabs.map((tab) => {
        const active =
          tab.href === "/feeds"
            ? pathname === "/feeds"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tickets-subnav__link${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <i className={`fa-solid ${tab.icon}`} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
