/** Session draft for an in-progress Trans Chap purchase (survives nav to POS). */

import type { PurchaseMeta } from "@/components/trans-chap/TransChapPurchaseFields";
import type { InventoryRole } from "@/lib/types";

export type PurchaseDraftLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  catalogProductId: string | null;
  quantity: number;
  unitCost: number;
  unitCostInput: string;
  sellingPrice: number;
  sellingPriceInput: string;
  role: InventoryRole;
  imageUrl: string | null;
  sku?: string | null;
  productCode?: string | null;
  sellUnit?: string | null;
  unitFactor?: number;
};

export type PurchaseDraft = {
  version: 1;
  lines: PurchaseDraftLine[];
  meta: PurchaseMeta;
  updatedAt: number;
};

const DRAFT_KEY_PREFIX = "trans-chap:purchase_draft:";

function storageKey(accountId: string | null | undefined): string {
  return `${DRAFT_KEY_PREFIX}${accountId?.trim() || "default"}`;
}

function isInventoryRole(value: unknown): value is InventoryRole {
  return value === "for_sale" || value === "raw_material" || value === "both";
}

function isDraftLine(value: unknown): value is PurchaseDraftLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.key === "string" &&
    typeof row.productName === "string" &&
    typeof row.quantity === "number" &&
    Number.isFinite(row.quantity) &&
    row.quantity > 0 &&
    typeof row.unitCost === "number" &&
    typeof row.unitCostInput === "string" &&
    typeof row.sellingPrice === "number" &&
    typeof row.sellingPriceInput === "string" &&
    isInventoryRole(row.role) &&
    (row.inventoryItemId === null || typeof row.inventoryItemId === "string") &&
    (row.catalogProductId === null || typeof row.catalogProductId === "string") &&
    (row.imageUrl === null || typeof row.imageUrl === "string")
  );
}

function isPurchaseMeta(value: unknown): value is PurchaseMeta {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.supplier === "string" &&
    typeof row.supplierAddress === "string" &&
    typeof row.referenceNo === "string" &&
    typeof row.purchaseDate === "string" &&
    (row.purchaseStatus === "received" ||
      row.purchaseStatus === "pending" ||
      row.purchaseStatus === "ordered") &&
    typeof row.businessLocation === "string" &&
    typeof row.payTerm === "string" &&
    (row.payTermUnit === "days" || row.payTermUnit === "months") &&
    typeof row.documentName === "string"
  );
}

export function loadPurchaseDraft(
  accountId?: string | null,
): PurchaseDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (row.version !== 1 || !Array.isArray(row.lines) || !isPurchaseMeta(row.meta)) {
      return null;
    }
    const lines = row.lines.filter(isDraftLine);
    if (lines.length === 0) return null;
    return {
      version: 1,
      lines,
      meta: row.meta,
      updatedAt:
        typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
          ? row.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function hasPurchaseDraft(accountId?: string | null): boolean {
  return loadPurchaseDraft(accountId) != null;
}

export function purchaseDraftSummary(accountId?: string | null): {
  itemCount: number;
  lineCount: number;
} | null {
  const draft = loadPurchaseDraft(accountId);
  if (!draft) return null;
  const itemCount = draft.lines.reduce((sum, line) => sum + line.quantity, 0);
  return { itemCount, lineCount: draft.lines.length };
}

export function savePurchaseDraft(
  accountId: string | null | undefined,
  input: { lines: PurchaseDraftLine[]; meta: PurchaseMeta },
): void {
  if (typeof window === "undefined") return;
  if (!input.lines.length) {
    clearPurchaseDraft(accountId);
    return;
  }
  const draft: PurchaseDraft = {
    version: 1,
    lines: input.lines,
    meta: input.meta,
    updatedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(storageKey(accountId), JSON.stringify(draft));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPurchaseDraft(accountId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(accountId));
  } catch {
    /* ignore */
  }
}
