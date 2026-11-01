/** Merchant onboarding wizard — shared types & step config. */

/** @deprecated Service vertical lives in TransChap_services; kept empty for type compat. */
export const SERVICE_BUSINESS_CATEGORIES = [] as const;

export const RETAIL_BUSINESS_CATEGORIES = [
  "Fashion & Apparel",
  "Beauty & Cosmetics",
  "Electronics",
  "Home & Living",
  "Health & Wellness",
  "Other",
] as const;

export const RESTAURANT_BUSINESS_CATEGORIES = [
  "Fast Food",
  "Cafe & Coffee",
  "Bakery",
  "Restaurant & Dining",
  "Juice & Smoothies",
  "Grocery & Provisions",
  "Other",
] as const;

export const STORE_TYPES = [
  {
    value: "retail",
    label: "Retail shop",
    description: "Sells products — fashion, electronics, home goods, and more.",
    icon: "fa-store",
  },
  {
    value: "restaurant",
    label: "Restaurant / F&B",
    description: "Sells food and drinks — cafe, bakery, kitchen, or dining.",
    icon: "fa-utensils",
  },
] as const;

export type StoreType = (typeof STORE_TYPES)[number]["value"];

export const DEFAULT_STORE_TYPE: StoreType = "retail";

export function parseStoreType(value: string | null | undefined): StoreType {
  if (value === "restaurant" || value === "retail") return value;
  return DEFAULT_STORE_TYPE;
}

export function storeTypeFromAccount(
  account: { store_type?: string | null } | null | undefined,
): StoreType {
  return parseStoreType(account?.store_type);
}

/** Restaurant / F&B shops get hotel menu + raw-material inventory roles. */
export function isRestaurantStore(
  account: { store_type?: string | null } | null | undefined,
): boolean {
  return storeTypeFromAccount(account) === "restaurant";
}

export function storeTypeLabel(value: string | null | undefined): string {
  const parsed = parseStoreType(value);
  return STORE_TYPES.find((option) => option.value === parsed)?.label ?? "Retail shop";
}

export function categoriesForStoreType(
  storeType: string | null | undefined,
): readonly string[] {
  return parseStoreType(storeType) === "restaurant"
    ? RESTAURANT_BUSINESS_CATEGORIES
    : RETAIL_BUSINESS_CATEGORIES;
}

export function defaultCategoryForStoreType(
  storeType: string | null | undefined,
): string {
  return categoriesForStoreType(storeType)[0];
}

export const ALL_BUSINESS_CATEGORIES = [
  ...RETAIL_BUSINESS_CATEGORIES,
  ...RESTAURANT_BUSINESS_CATEGORIES,
] as const;

export type BusinessVertical = "service" | "retail";

export const BUSINESS_VERTICAL_STORAGE_KEY = "TransChap_business_vertical";

export function categoriesForVertical(_vertical?: BusinessVertical): readonly string[] {
  return RETAIL_BUSINESS_CATEGORIES;
}

export function defaultCategoryForVertical(_vertical?: BusinessVertical): string {
  return RETAIL_BUSINESS_CATEGORIES[0];
}

/** TransChap Merchants is retail-only. */
export function isServiceBusinessCategory(
  _category?: string | null | undefined,
): boolean {
  return false;
}

export function verticalFromCategory(
  _category?: string | null | undefined,
): BusinessVertical {
  return "retail";
}

export function parseBusinessVertical(
  value: string | null | undefined,
): BusinessVertical | null {
  if (value === "service" || value === "retail") return "retail";
  return null;
}

export function saveBusinessVertical(_vertical?: BusinessVertical): void {
  try {
    localStorage.setItem(BUSINESS_VERTICAL_STORAGE_KEY, "retail");
  } catch {
    /* ignore */
  }
}

export function loadBusinessVertical(): BusinessVertical {
  return "retail";
}

export const SIGNUP_CITY_STORAGE_KEY = "TransChap_signup_city";

export function saveSignupCity(city: string): void {
  try {
    const cleaned = city.trim();
    if (cleaned) {
      localStorage.setItem(SIGNUP_CITY_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(SIGNUP_CITY_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function loadSignupCity(): string | null {
  try {
    return localStorage.getItem(SIGNUP_CITY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export type OnboardingStepId = "welcome" | "location" | "catalog";

export type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
};

/** Post-login setup: welcome → location → products. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: "welcome", label: "Welcome" },
  { id: "location", label: "Location" },
  { id: "catalog", label: "Products" },
];

export function stepsForCategory(
  _category?: string | null | undefined,
): OnboardingStep[] {
  return [...ONBOARDING_STEPS];
}

export const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const STORAGE_KEY = "TransChap_onboarding_v1";

export type OnboardingDraft = {
  stepId: OnboardingStepId;
  category: string | null;
  accountId: string | null;
  registered: boolean;
  vertical?: BusinessVertical | null;
};
