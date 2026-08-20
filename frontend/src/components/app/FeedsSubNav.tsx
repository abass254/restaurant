"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FeedsSubNav() {
  const pathname = usePathname();
  const base = pathname.startsWith("/trans-chap") ? "/trans-chap/feeds" : "/feeds";
  const tabs = [
    { href: base, label: "Feed", icon: "fa-images" },
    { href: `${base}/analytics`, label: "Analytics", icon: "fa-chart-line" },
  ];

  return (
    <nav className="tickets-subnav" aria-label="Feeds sections">
      {tabs.map((tab) => {
        const active =
          tab.href === base
            ? pathname === base || pathname === `${base}/`
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
