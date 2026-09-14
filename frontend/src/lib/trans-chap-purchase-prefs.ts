/** Local prefs for Trans Chap purchase behavior. */

const ADJUST_SELLING_PRICE_KEY = "trans-chap:adjust_selling_price";

/** Default on: purchases can set selling price beside buying price. */
export function isAdjustSellingPriceEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(ADJUST_SELLING_PRICE_KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function setAdjustSellingPriceEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADJUST_SELLING_PRICE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
