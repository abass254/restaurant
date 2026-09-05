import type { AuthUser } from "@/lib/types";
import { isInternalToolsPath, isInternalToolsUser } from "@/lib/internal-tools-access";
import {
  merchantNavLinks,
  type MerchantNavLink,
} from "@/lib/merchant-nav";

export const MERCHANT_SECTIONS = [
  "dashboard",
  "feeds",
  "tickets",
  "inventory",
  "pos",
  "customer",
  "orders",
  "delivery",
  "tools",
  "settings",
] as const;

export type MerchantSection = (typeof MERCHANT_SECTIONS)[number];

export const MERCHANT_SECTION_LABELS: Record<MerchantSection, string> = {
  dashboard: "Dashboard",
  feeds: "Feeds",
  tickets: "Tickets",
  inventory: "Inventory",
  pos: "POS",
  customer: "Customers",
  orders: "Orders",
  delivery: "Delivery",
  tools: "Tools",
  settings: "Settings",
};

/** Sections relevant when inviting staff (retail-only product). */
export const RETAIL_STAFF_SECTIONS: MerchantSection[] = [
  "dashboard",
  "feeds",
  "tickets",
  "inventory",
  "pos",
  "customer",
  "orders",
  "delivery",
  "tools",
  "settings",
];

const PATH_SECTION_MAP: Array<{ prefix: string; section: MerchantSection }> = [
  { prefix: "/dashboard", section: "dashboard" },
  { prefix: "/feeds", section: "feeds" },
  { prefix: "/tickets", section: "tickets" },
  { prefix: "/messages", section: "tickets" },
  { prefix: "/inventory", section: "inventory" },
  { prefix: "/pos", section: "pos" },
  { prefix: "/customer", section: "customer" },
  { prefix: "/orders", section: "orders" },
  { prefix: "/station", section: "orders" },
  { prefix: "/delivery", section: "delivery" },
  { prefix: "/trans-chap/feeds", section: "feeds" },
  { prefix: "/trans-chap/chats", section: "tickets" },
  { prefix: "/trans-chap", section: "dashboard" },
  { prefix: "/tools", section: "tools" },
  { prefix: "/bot", section: "tools" },
  { prefix: "/basics", section: "settings" },
  { prefix: "/settings", section: "settings" },
  { prefix: "/team", section: "dashboard" },
];

/** DukAI Merchants is retail-only. */
export function businessModeForUser(_user: AuthUser): "retail" {
  return "retail";
}

export function staffSectionsForMode(_mode?: "retail" | "service"): MerchantSection[] {
  return [...RETAIL_STAFF_SECTIONS];
}

export function isShopOwner(user: AuthUser): boolean {
  if (user.memberships && user.active_account) {
    const membership = user.memberships.find(
      (m) => m.account_id === user.active_account?.id,
    );
    if (membership) return membership.role === "system_admin";
  }
  return user.user_role === "system_admin";
}

export function userAllowedSections(user: AuthUser): MerchantSection[] {
  if (isShopOwner(user) || user.user_role === "super_admin") {
    return [...MERCHANT_SECTIONS];
  }
  const activeMembership = user.memberships?.find(
    (m) => m.account_id === user.active_account?.id,
  );
  const raw = activeMembership?.allowed_sections ?? user.allowed_sections ?? [];
  return raw.filter((s): s is MerchantSection =>
    (MERCHANT_SECTIONS as readonly string[]).includes(s),
  );
}

export function userCanAccessSection(
  user: AuthUser,
  section: MerchantSection,
): boolean {
  if (isShopOwner(user) || user.user_role === "super_admin") {
    return true;
  }
  return userAllowedSections(user).includes(section);
}

export function pathnameToSection(pathname: string): MerchantSection | null {
  for (const { prefix, section } of PATH_SECTION_MAP) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return section;
    }
  }
  return null;
}

export function isOwnerOnlyPath(pathname: string): boolean {
  return pathname === "/team" || pathname.startsWith("/team/");
}

export function filterNavLinksForUser(user: AuthUser): MerchantNavLink[] {
  return merchantNavLinks.filter((link) => {
    if (link.ownerOnly) {
      return isShopOwner(user);
    }
    if (!link.section) {
      return true;
    }
    return userCanAccessSection(user, link.section);
  });
}

export function firstAllowedPath(user: AuthUser): string {
  const hasShop = Boolean(
    user.active_account?.id ||
      user.account?.id ||
      (user.memberships && user.memberships.length > 0),
  );
  if (!hasShop && user.user_role !== "super_admin") {
    return "/onboarding";
  }
  const links = filterNavLinksForUser(user);
  if (links.length > 0) {
    return links[0].href;
  }
  return "/dashboard";
}

export function userCanAccessPath(user: AuthUser, pathname: string): boolean {
  if (isInternalToolsPath(pathname)) {
    return isInternalToolsUser(user);
  }
  if (isOwnerOnlyPath(pathname)) {
    return isShopOwner(user);
  }
  const section = pathnameToSection(pathname);
  if (!section) {
    return true;
  }
  return userCanAccessSection(user, section);
}
