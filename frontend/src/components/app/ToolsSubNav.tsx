"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { isInternalToolsUser } from "@/lib/internal-tools-access";

const publicTabs = [
  { href: "/tools/starters", label: "Starters", icon: "fa-wand-magic-sparkles" },
  { href: "/tools/auto-reply", label: "Auto-reply", icon: "fa-robot" },
  { href: "/tools/onboarding", label: "Onboarding", icon: "fa-circle-check" },
];

const paymentsTab = {
  href: "/tools/payments",
  label: "Payments",
  icon: "fa-mobile-screen-button",
};

const internalTabs = [
  { href: "/tools/login-codes", label: "Login codes", icon: "fa-key" },
  { href: "/tools/sms", label: "SMS", icon: "fa-comment-sms" },
  { href: "/tools/qa", label: "QA", icon: "fa-bug" },
];

export function ToolsSubNav() {
  const pathname = usePathname();
  const user = useAuthUser();
  const canSeePayments = user.user_role === "system_admin";
  const visibleTabs = [
    ...publicTabs.slice(0, 2),
    ...(canSeePayments ? [paymentsTab] : []),
    ...publicTabs.slice(2),
    ...(isInternalToolsUser(user) ? internalTabs : []),
  ];

  return (
    <nav className="tickets-subnav" aria-label="Tools sections">
      {visibleTabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tickets-subnav__link${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <i className={tab.icon.startsWith("fa-brands") ? tab.icon : `fa-solid ${tab.icon}`} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
