"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/tickets", label: "Inbox", icon: "fa-inbox" },
  { href: "/tickets/analytics", label: "Analytics", icon: "fa-chart-line" },
];

export function TicketsSubNav() {
  const pathname = usePathname();

  return (
    <nav className="tickets-subnav" aria-label="Tickets sections">
      {tabs.map((tab) => {
        const active =
          tab.href === "/tickets"
            ? pathname === "/tickets"
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
