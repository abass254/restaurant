import type { CatalogProduct, InventoryItem } from "@/lib/types";

/** Normalize barcode / SKU scans for comparison (alphanumeric, lowercase). */
export function normalizeScanValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Collect product_code, sku, and attributes.barcode from a catalog product. */
export function productBarcodeCandidates(
  product: CatalogProduct | null | undefined,
): string[] {
  if (!product) return [];
  const candidates: string[] = [];
  for (const raw of [product.product_code, product.sku]) {
    if (typeof raw === "string" && raw.trim()) {
      candidates.push(raw.trim());
    }
  }
  const attrs = product.attributes;
  if (attrs && typeof attrs === "object") {
    const barcode = attrs.barcode;
    if (typeof barcode === "string" && barcode.trim()) {
      candidates.push(barcode.trim());
    }
  }
  return candidates;
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
  const rawScan = code.trim().toLowerCase();
  for (const candidate of productBarcodeCandidates(item.product)) {
    if (codeMatchesCandidate(code, candidate)) return true;
  }
  const productName = item.product?.name?.trim().toLowerCase() ?? "";
  if (productName && rawScan.length >= 4 && productName === rawScan) {
    return true;
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

  const exact = matched.find((item) => {
    const sku = item.product?.sku?.trim().toLowerCase() ?? "";
    const productCode = item.product?.product_code?.trim().toLowerCase() ?? "";
    const lower = scanned.toLowerCase();
    return sku === lower || productCode === lower;
  });
  return exact ?? matched[0];
}
