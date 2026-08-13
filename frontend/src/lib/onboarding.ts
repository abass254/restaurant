/** Merchant onboarding wizard — shared types & step config. */

/** @deprecated Service vertical lives in dukai_services; kept empty for type compat. */
export const SERVICE_BUSINESS_CATEGORIES = [] as const;

export const RETAIL_BUSINESS_CATEGORIES = [
  "Fashion & Apparel",
  "Beauty & Cosmetics",
  "Electronics",
  "Home & Living",
  "Health & Wellness",
  "Other",
] as const;

export const ALL_BUSINESS_CATEGORIES = [...RETAIL_BUSINESS_CATEGORIES] as const;

export type BusinessVertical = "service" | "retail";

export const BUSINESS_VERTICAL_STORAGE_KEY = "dukai_business_vertical";

export function categoriesForVertical(_vertical?: BusinessVertical): readonly string[] {
  return RETAIL_BUSINESS_CATEGORIES;
}

export function defaultCategoryForVertical(_vertical?: BusinessVertical): string {
  return RETAIL_BUSINESS_CATEGORIES[0];
}

/** DukAI Merchants is retail-only. */
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

export const SIGNUP_CITY_STORAGE_KEY = "dukai_signup_city";

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

export const STORAGE_KEY = "dukai_onboarding_v1";

export type OnboardingDraft = {
  stepId: OnboardingStepId;
  category: string | null;
  accountId: string | null;
  registered: boolean;
  vertical?: BusinessVertical | null;
};
