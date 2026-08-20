import type { MerchantSection } from "@/lib/merchant-permissions";

export type MerchantNavLink = {
  href: string;
  icon: string;
  label: string;
  section?: MerchantSection;
  ownerOnly?: boolean;
  badgeKey?: "tickets" | "orders";
  disabled?: boolean;
  /** Shown in the top-bar center tab row (Facebook-style). */
  topTab?: boolean;
};

/** DukAI Merchants — retail commerce navigation. */
export const merchantNavLinks: MerchantNavLink[] = [
  {
    href: "/dashboard",
    icon: "fa-gauge-high",
    label: "Dashboard",
    section: "dashboard",
    topTab: true,
  },
  {
    href: "/feeds",
    icon: "fa-images",
    label: "Feeds",
    section: "feeds",
  },
  {
    href: "/tickets",
    icon: "fa-ticket",
    label: "Tickets",
    section: "tickets",
    badgeKey: "tickets",
    topTab: true,
  },
  {
    href: "/inventory",
    icon: "fa-boxes-stacked",
    label: "Inventory",
    section: "inventory",
    topTab: true,
  },
  {
    href: "/pos",
    icon: "fa-cash-register",
    label: "POS",
    section: "pos",
  },
  {
    href: "/orders",
    icon: "fa-receipt",
    label: "Orders",
    section: "orders",
    badgeKey: "orders",
    topTab: true,
  },
  {
    href: "/station",
    icon: "fa-tablet-screen-button",
    label: "Station",
    section: "orders",
  },
  {
    href: "/delivery",
    icon: "fa-user-plus",
    label: "Delivery",
    section: "delivery",
  },
  {
    href: "/trans-chap",
    icon: "fa-bolt",
    label: "Trans Chap",
    section: "dashboard",
  },
  {
    href: "/tools",
    icon: "fa-screwdriver-wrench",
    label: "Tools",
    section: "tools",
    topTab: true,
  },
  {
    href: "/team",
    icon: "fa-users",
    label: "Team",
    ownerOnly: true,
  },
  {
    href: "/basics",
    icon: "fa-store",
    label: "Basics",
    section: "settings",
  },
  {
    href: "/settings",
    icon: "fa-gear",
    label: "Settings",
    section: "settings",
  },
];

export const merchantTopTabLinks = merchantNavLinks.filter((link) => link.topTab);

export function formatNavBadgeCount(value: number): string {
  if (value <= 0) return "";
  if (value > 99) return "99+";
  return String(value);
}

export function navLinkIsActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
