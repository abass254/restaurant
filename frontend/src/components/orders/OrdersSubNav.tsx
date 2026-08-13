"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/orders", label: "Orders", icon: "fa-receipt" },
  { href: "/orders/analytics", label: "Analytics", icon: "fa-chart-line" },
];

export function OrdersSubNav() {
  const pathname = usePathname();

  return (
    <nav className="tickets-subnav" aria-label="Orders sections">
      {tabs.map((tab) => {
        const active =
          tab.href === "/orders"
            ? pathname === "/orders"
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
