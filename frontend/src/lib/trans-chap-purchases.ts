export const TRANS_CHAP_PURCHASES_KEY = "trans-chap:purchases";

export type TransChapPurchase = {
  id: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  supplier: string | null;
  paidAt: string;
};

function storageKey(accountId: string): string {
  return `${TRANS_CHAP_PURCHASES_KEY}:${accountId}`;
}

export function loadTransChapPurchases(accountId: string): TransChapPurchase[] {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TransChapPurchase[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row) =>
        row &&
        typeof row.productName === "string" &&
        Number.isFinite(row.quantity) &&
        Number.isFinite(row.unitCost),
    );
  } catch {
    return [];
  }
}

export function saveTransChapPurchase(
  accountId: string,
  purchase: TransChapPurchase,
): void {
  const next = [purchase, ...loadTransChapPurchases(accountId)];
  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}
