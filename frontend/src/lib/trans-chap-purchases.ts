import { apiFetch } from "@/lib/api";
import { internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  findInventoryByName,
  inventoryProductName,
  inventoryRole,
  receiveStock,
} from "@/lib/trans-chap-product";
import type {
  InventoryItem,
  InventoryResponse,
  InventoryRole,
  StockMovement,
  StockMovementsListResponse,
} from "@/lib/types";

export type TransChapPurchase = {
  id: string;
  productName: string;
  inventoryItemId: string | null;
  inventoryRole: InventoryRole;
  quantity: number;
  unitCost: number;
  total: number;
  supplier: string | null;
  paidAt: string;
};

const MAX_PAGES = 20;

export function purchaseFromMovement(movement: StockMovement): TransChapPurchase {
  const unitCost =
    movement.unit_cost != null && Number.isFinite(movement.unit_cost)
      ? movement.unit_cost
      : movement.inventory_item?.buying_price ?? 0;
  const quantity = movement.quantity || 0;
  return {
    id: movement.id,
    productName: movement.inventory_item
      ? inventoryProductName(movement.inventory_item)
      : "Product",
    inventoryItemId: movement.inventory_item_id,
    inventoryRole: inventoryRole(movement.inventory_item),
    quantity,
    unitCost,
    total: unitCost * quantity,
    supplier: movement.note?.trim() || null,
    paidAt: movement.created_at || new Date().toISOString(),
  };
}

export async function fetchTransChapPurchases(options?: {
  maxPages?: number;
  accountId?: string;
}): Promise<{ purchases: TransChapPurchase[]; error: string | null; truncated: boolean }> {
  if (options?.accountId) {
    await migrateLegacyTransChapPurchases(options.accountId);
  }
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const purchases: TransChapPurchase[] = [];
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await apiFetch<StockMovementsListResponse>(
        `${apiRoutes.inventoryStockMovements}?direction=in&reason=receive&per_page=100&page=${page}`,
      );
      purchases.push(...data.data.map(purchaseFromMovement));
      if (page >= data.meta.last_page) {
        return { purchases, error: null, truncated: false };
      }
    }
    return { purchases, error: null, truncated: true };
  } catch {
    return {
      purchases,
      error: internalErrorMessage(),
      truncated: false,
    };
  }
}

const LEGACY_PURCHASES_KEY = "trans-chap:purchases";
const MIGRATION_FLAG_KEY = "trans-chap:purchases-migrated";

type LegacyPurchase = {
  id?: string;
  productName?: string;
  inventoryItemId?: string | null;
  quantity?: number;
  unitCost?: number;
  supplier?: string | null;
};

function legacyStorageKey(accountId: string): string {
  return `${LEGACY_PURCHASES_KEY}:${accountId}`;
}

function migrationFlagKey(accountId: string): string {
  return `${MIGRATION_FLAG_KEY}:${accountId}`;
}

function readLegacyPurchases(accountId: string): LegacyPurchase[] {
  const keys = [legacyStorageKey(accountId), LEGACY_PURCHASES_KEY];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as LegacyPurchase[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function clearLegacyPurchases(accountId: string): void {
  try {
    localStorage.removeItem(legacyStorageKey(accountId));
    localStorage.removeItem(LEGACY_PURCHASES_KEY);
    localStorage.setItem(migrationFlagKey(accountId), "1");
  } catch {
    /* ignore quota / private mode */
  }
}

const migrating = new Map<string, Promise<void>>();

/** Copy device-only purchase history to the server without adding stock twice. */
export async function migrateLegacyTransChapPurchases(accountId: string): Promise<void> {
  if (typeof window === "undefined" || !accountId) return;
  const inFlight = migrating.get(accountId);
  if (inFlight) return inFlight;
  const job = runLegacyPurchaseMigration(accountId).finally(() => {
    migrating.delete(accountId);
  });
  migrating.set(accountId, job);
  return job;
}

async function runLegacyPurchaseMigration(accountId: string): Promise<void> {
  if (typeof window === "undefined" || !accountId) return;
  try {
    if (localStorage.getItem(migrationFlagKey(accountId)) === "1") return;
  } catch {
    return;
  }
  const rows = readLegacyPurchases(accountId);
  if (!rows.length) {
    clearLegacyPurchases(accountId);
    return;
  }

  let inventory: InventoryItem[] = [];
  try {
    const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
    inventory = data.data;
  } catch {
    return;
  }

  const leftover: LegacyPurchase[] = [];
  for (const row of rows) {
    const name = row.productName?.trim();
    const qty = Number(row.quantity);
    const cost = Number(row.unitCost);
    if (!name || !Number.isInteger(qty) || qty <= 0) continue;
    if (!Number.isFinite(cost) || cost < 0) continue;
    const item =
      (row.inventoryItemId
        ? inventory.find((entry) => entry.id === row.inventoryItemId)
        : undefined) ?? findInventoryByName(inventory, name);
    if (!item) continue;
    try {
      const note = [row.supplier?.trim() || null, row.id ? `migrated:${row.id}` : null]
        .filter(Boolean)
        .join(" · ");
      const updated = await receiveStock({
        item,
        quantity: qty,
        reason: "receive",
        unitCost: cost,
        note: note || null,
        recordOnly: true,
      });
      inventory = [updated, ...inventory.filter((entry) => entry.id !== updated.id)];
    } catch {
      leftover.push(row);
    }
  }
  if (leftover.length) {
    try {
      localStorage.setItem(legacyStorageKey(accountId), JSON.stringify(leftover));
    } catch {
      /* ignore quota / private mode */
    }
    return;
  }
  clearLegacyPurchases(accountId);
}
