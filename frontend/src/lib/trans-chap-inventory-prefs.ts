/** Local preferences for the Trans Chap inventory experience. */

const ITEM_QUANTITY_ADJUSTMENT_KEY = "trans-chap:allow_item_quantity_adjustment";
const ITEM_QUANTITY_ADJUSTMENT_EVENT = "trans-chap:item-quantity-adjustment-change";

/** Default on to preserve the existing inline quantity editing behavior. */
export function isItemQuantityAdjustmentEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(ITEM_QUANTITY_ADJUSTMENT_KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function setItemQuantityAdjustmentEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ITEM_QUANTITY_ADJUSTMENT_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new Event(ITEM_QUANTITY_ADJUSTMENT_EVENT));
  } catch {
    /* Ignore unavailable storage and retain the in-memory setting. */
  }
}

export function subscribeItemQuantityAdjustment(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === ITEM_QUANTITY_ADJUSTMENT_KEY) onChange();
  };
  window.addEventListener(ITEM_QUANTITY_ADJUSTMENT_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ITEM_QUANTITY_ADJUSTMENT_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
