import type { MerchantSection } from "@/lib/merchant-permissions";

export type MerchantNavGroup = "work" | "more";

export type MerchantNavLink = {
  href: string;
  icon: string;
  label: string;
  section?: MerchantSection;
  ownerOnly?: boolean;
  badgeKey?: "tickets" | "orders";
  disabled?: boolean;
  group?: MerchantNavGroup;
  /** Shown as a Facebook-style icon tab in the top-bar center. */
  topTab?: boolean;
};

/** DukAI Merchants — retail commerce navigation. */
export const merchantNavLinks: MerchantNavLink[] = [
  {
    href: "/dashboard",
    icon: "fa-gauge-high",
    label: "Dashboard",
    section: "dashboard",
    group: "work",
    topTab: true,
  },
  {
    href: "/orders",
    icon: "fa-receipt",
    label: "Orders",
    section: "orders",
    badgeKey: "orders",
    group: "work",
    topTab: true,
  },
  {
    href: "/inventory",
    icon: "fa-boxes-stacked",
    label: "Inventory",
    section: "inventory",
    group: "work",
    topTab: true,
  },
  {
    href: "/pos",
    icon: "fa-cash-register",
    label: "POS",
    section: "pos",
    group: "work",
    topTab: true,
  },
  {
    href: "/customer",
    icon: "fa-address-book",
    label: "Customers",
    section: "customer",
    group: "work",
  },
  {
    href: "/tickets",
    icon: "fa-ticket",
    label: "Tickets",
    section: "tickets",
    badgeKey: "tickets",
    group: "work",
    topTab: true,
  },
  {
    href: "/delivery",
    icon: "fa-motorcycle",
    label: "Delivery",
    section: "delivery",
    group: "work",
  },
  {
    href: "/feeds",
    icon: "fa-images",
    label: "Feeds",
    section: "feeds",
    group: "more",
  },
  {
    href: "/station",
    icon: "fa-tablet-screen-button",
    label: "Station",
    section: "orders",
    group: "more",
  },
  {
    href: "/trans-chap",
    icon: "fa-bolt",
    label: "Trans Chap",
    section: "dashboard",
    group: "more",
  },
  {
    href: "/tools",
    icon: "fa-screwdriver-wrench",
    label: "Tools",
    section: "tools",
    group: "more",
  },
  {
    href: "/team",
    icon: "fa-users",
    label: "Team",
    ownerOnly: true,
    group: "more",
  },
  {
    href: "/basics",
    icon: "fa-store",
    label: "Basics",
    section: "settings",
    group: "more",
  },
  {
    href: "/settings",
    icon: "fa-gear",
    label: "Settings",
    section: "settings",
    group: "more",
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
