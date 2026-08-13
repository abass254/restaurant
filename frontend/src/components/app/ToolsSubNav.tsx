"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/tools/starters", label: "Starters", icon: "fa-wand-magic-sparkles" },
  { href: "/tools/auto-reply", label: "Auto-reply", icon: "fa-robot" },
  { href: "/tools/payments", label: "Payments", icon: "fa-mobile-screen-button" },
  { href: "/tools/onboarding", label: "Onboarding", icon: "fa-circle-check" },
];

export function ToolsSubNav() {
  const pathname = usePathname();

  return (
    <nav className="tickets-subnav" aria-label="Tools sections">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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
