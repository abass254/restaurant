import type { CatalogProduct, InventoryItem } from "@/lib/types";

/** Normalize barcode / SKU scans for comparison (alphanumeric, lowercase). */
export function normalizeScanValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Scan matching always uses the product SKU column. */
export function productBarcodeCandidates(
  product: CatalogProduct | null | undefined,
): string[] {
  const sku = product?.sku;
  if (typeof sku === "string" && sku.trim()) {
    return [sku.trim()];
  }
  return [];
}

export function codeMatchesCandidate(code: string, candidate: string): boolean {
  const rawScan = code.trim().toLowerCase();
  const normalizedScan = normalizeScanValue(code);
  if (!rawScan && !normalizedScan) return false;

  const raw = candidate.trim().toLowerCase();
  const normalized = normalizeScanValue(candidate);
  if (rawScan === raw || (normalizedScan && normalizedScan === normalized)) {
    return true;
  }
  if (raw && rawScan.length >= 4 && raw.startsWith(rawScan)) return true;
  if (
    normalized &&
    normalizedScan.length >= 4 &&
    normalized.includes(normalizedScan)
  ) {
    return true;
  }
  return false;
}

export function itemMatchesBarcode(
  item: InventoryItem,
  code: string,
): boolean {
  for (const candidate of productBarcodeCandidates(item.product)) {
    if (codeMatchesCandidate(code, candidate)) return true;
  }
  return false;
}

export function findInventoryByBarcode(
  items: InventoryItem[],
  code: string,
): InventoryItem | undefined {
  const scanned = code.trim();
  if (!scanned) return undefined;
  const matched = items.filter((item) => itemMatchesBarcode(item, scanned));
  if (matched.length === 0) return undefined;
  if (matched.length === 1) return matched[0];

  const lower = scanned.toLowerCase();
  const exact = matched.find((item) => {
    const sku = item.product?.sku?.trim().toLowerCase() ?? "";
    return sku === lower;
  });
  return exact ?? matched[0];
}
