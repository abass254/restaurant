export type AnalyticsConsent = "accepted" | "rejected";

const STORAGE_KEY = "TransChap-analytics-consent";

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "accepted" || value === "rejected") {
      return value;
    }
  } catch {
    /* private browsing / blocked storage */
  }

  return null;
}

export function writeAnalyticsConsent(consent: AnalyticsConsent): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, consent);
  } catch {
    /* ignore */
  }
}

export function clearAnalyticsConsent(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
