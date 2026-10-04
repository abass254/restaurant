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
  "supplier",
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
  supplier: "Suppliers",
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
  "supplier",
  "orders",
  "delivery",
  "tools",
  "settings",
];

/** Sections that map to Trans Chap screens (not the full shop dashboard). */
export const TRANS_CHAP_STAFF_SECTIONS: MerchantSection[] = [
  "dashboard",
  "feeds",
  "tickets",
  "inventory",
  "pos",
  "customer",
  "supplier",
  "settings",
];

/** Trans Chap labels for the same merchant section keys. */
export const TRANS_CHAP_SECTION_LABELS: Record<MerchantSection, string> = {
  dashboard: "Home",
  feeds: "Feeds",
  tickets: "Chats",
  inventory: "Inventory",
  pos: "POS & sales",
  customer: "Customers",
  supplier: "Suppliers",
  orders: "Orders",
  delivery: "Delivery",
  tools: "Tools",
  settings: "Settings",
};

/** Default access for a Trans Chap cashier. Home is required to open the app. */
export const TRANS_CHAP_DEFAULT_STAFF_SECTIONS: MerchantSection[] = [
  "dashboard",
  "inventory",
  "supplier",
  "pos",
];

const TRANS_CHAP_STAFF_SECTION_SET = new Set<string>(TRANS_CHAP_STAFF_SECTIONS);

/** Keep only Trans Chap permission keys (used when inviting from Trans Chap). */
export function clampToTransChapSections(sections: string[]): MerchantSection[] {
  const seen = new Set<string>();
  const out: MerchantSection[] = [];
  for (const key of sections) {
    if (!TRANS_CHAP_STAFF_SECTION_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as MerchantSection);
  }
  return out;
}

/**
 * Staff whose access was scoped to Trans Chap only (no Orders / Delivery / Tools).
 * Requires Home (`dashboard`) so ordinary dashboard POS-only cashiers are not
 * redirected into Trans Chap. Owners and platform admins never match.
 */
export function isTransChapOnlyStaff(user: AuthUser): boolean {
  if (isShopOwner(user) || normalizeMerchantRole(user.user_role) === "superadmin") {
    return false;
  }
  const allowed = userAllowedSections(user);
  if (allowed.length === 0 || !allowed.includes("dashboard")) return false;
  return allowed.every((section) => TRANS_CHAP_STAFF_SECTION_SET.has(section));
}

const PATH_SECTION_MAP: Array<{ prefix: string; section: MerchantSection }> = [
  { prefix: "/dashboard", section: "dashboard" },
  { prefix: "/feeds", section: "feeds" },
  { prefix: "/tickets", section: "tickets" },
  { prefix: "/messages", section: "tickets" },
  { prefix: "/inventory", section: "inventory" },
  { prefix: "/pos", section: "pos" },
  { prefix: "/station", section: "pos" },
  { prefix: "/customer", section: "customer" },
  { prefix: "/supplier", section: "supplier" },
  { prefix: "/orders", section: "orders" },
  { prefix: "/delivery", section: "delivery" },
  { prefix: "/trans-chap/feeds", section: "feeds" },
  { prefix: "/trans-chap/chats", section: "tickets" },
  { prefix: "/trans-chap/stocks", section: "inventory" },
  { prefix: "/trans-chap/purchases", section: "inventory" },
  { prefix: "/trans-chap/sales", section: "pos" },
  { prefix: "/trans-chap/transact", section: "pos" },
  { prefix: "/trans-chap/pos", section: "pos" },
  { prefix: "/trans-chap/mpesa", section: "pos" },
  { prefix: "/trans-chap/credit", section: "customer" },
  { prefix: "/trans-chap/customers", section: "customer" },
  { prefix: "/trans-chap/suppliers", section: "supplier" },
  { prefix: "/trans-chap/settings", section: "settings" },
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

/** Match backend ``normalize_membership_role`` / ``User.normalize_role``. */
export function normalizeMerchantRole(role: string | null | undefined): string {
  return (role ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-\s]/g, "");
}

function activeMembershipForUser(user: AuthUser) {
  const activeId = user.active_account?.id ?? user.account?.id;
  if (activeId == null || !user.memberships?.length) return undefined;
  return user.memberships.find(
    (m) => String(m.account_id) === String(activeId),
  );
}

export function isShopOwner(user: AuthUser): boolean {
  const membership = activeMembershipForUser(user);
  if (membership) {
    return normalizeMerchantRole(membership.role) === "systemadmin";
  }
  return normalizeMerchantRole(user.user_role) === "systemadmin";
}

/** Only the store admin may void sales or purchases. */
export function isStoreAdmin(user: AuthUser): boolean {
  return isShopOwner(user) || normalizeMerchantRole(user.user_role) === "superadmin";
}

export function userAllowedSections(user: AuthUser): MerchantSection[] {
  if (isShopOwner(user) || normalizeMerchantRole(user.user_role) === "superadmin") {
    return [...MERCHANT_SECTIONS];
  }
  const activeMembership = activeMembershipForUser(user);
  const raw = activeMembership?.allowed_sections ?? user.allowed_sections ?? [];
  return raw.filter((s): s is MerchantSection =>
    (MERCHANT_SECTIONS as readonly string[]).includes(s),
  );
}

export function userCanAccessSection(
  user: AuthUser,
  section: MerchantSection,
): boolean {
  if (isShopOwner(user) || normalizeMerchantRole(user.user_role) === "superadmin") {
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
  if (isTransChapOnlyStaff(user)) {
    return "/trans-chap";
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
  if (
    isTransChapOnlyStaff(user) &&
    !pathname.startsWith("/trans-chap") &&
    pathnameToSection(pathname) != null
  ) {
    return false;
  }
  // Purchases staff can also manage the supplier directory.
  if (
    pathname === "/trans-chap/suppliers" ||
    pathname.startsWith("/trans-chap/suppliers/")
  ) {
    return (
      userCanAccessSection(user, "supplier") ||
      userCanAccessSection(user, "inventory")
    );
  }
  const section = pathnameToSection(pathname);
  if (!section) {
    return true;
  }
  return userCanAccessSection(user, section);
}
