import { apiFetch } from "@/lib/api";
import { extractErrorMessage, internalErrorMessage, promptVoidReason } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  fetchAllPages,
  timeWindowQuery,
  type PageProgressMeta,
  type TimeWindow,
} from "@/lib/paged-fetch";
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
  category: string | null;
  paidAt: string;
  voidedAt: string | null;
  voidReason: string | null;
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
    supplier: supplierLabelFromNote(movement.note),
    category: movement.inventory_item?.product?.category?.trim() || null,
    paidAt: movement.created_at || new Date().toISOString(),
    voidedAt: movement.voided_at ?? null,
    voidReason: movement.void_reason ?? null,
  };
}

export async function promptAndVoidTransChapPurchase(
  purchase: Pick<TransChapPurchase, "id">,
): Promise<TransChapPurchase | null> {
  const reason = await promptVoidReason(
    "Void this purchase?",
    "The stock it added will be taken back out. Get any money back from the supplier yourself.",
    "Void purchase",
  );
  if (!reason) return null;
  return voidTransChapPurchase(purchase.id, reason);
}

export async function voidTransChapPurchase(
  id: string,
  reason: string,
): Promise<TransChapPurchase> {
  const data = await apiFetch<{ data: StockMovement }>(
    apiRoutes.inventoryStockMovementVoid(id),
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
  return purchaseFromMovement(data.data);
}

/** Void several purchases with one reason. One at a time so stock errors stay per row. */
export async function promptAndVoidTransChapPurchases(
  purchases: Pick<TransChapPurchase, "id" | "productName">[],
): Promise<{ updated: TransChapPurchase[]; failures: string[] } | null> {
  if (!purchases.length) return null;
  const count = purchases.length;
  const reason = await promptVoidReason(
    `Void ${count} purchase${count === 1 ? "" : "s"}?`,
    "The stock they added will be taken back out. Get any money back from the supplier yourself.",
    `Void ${count}`,
  );
  if (!reason) return null;
  const updated: TransChapPurchase[] = [];
  const failures: string[] = [];
  for (const purchase of purchases) {
    try {
      updated.push(await voidTransChapPurchase(purchase.id, reason));
    } catch (err) {
      failures.push(`${purchase.productName}: ${extractErrorMessage(err)}`);
    }
  }
  return { updated, failures };
}

function supplierLabelFromNote(note: string | null | undefined): string | null {
  const raw = note?.trim();
  if (!raw) return null;
  const first = raw.split(" · ")[0]?.trim() || "";
  if (!first) return null;
  if (/^(Ref|Status|Date|Pay|Loc|Doc)\b/i.test(first)) return null;
  return first;
}

export type PurchasesProgressCallback = (
  purchases: TransChapPurchase[],
  meta: PageProgressMeta,
) => void;

export async function fetchTransChapPurchases(
  options?: {
    maxPages?: number;
    accountId?: string;
    onProgress?: PurchasesProgressCallback;
  } & TimeWindow,
): Promise<{ purchases: TransChapPurchase[]; error: string | null; truncated: boolean }> {
  if (options?.accountId) {
    await migrateLegacyTransChapPurchases(options.accountId);
  }
  const window = timeWindowQuery(options);
  const result = await fetchAllPages<StockMovementsListResponse["data"][number]>(
    (page) =>
      `${apiRoutes.inventoryStockMovements}?direction=in&reason=receive&per_page=100&page=${page}${window}`,
    options?.maxPages ?? MAX_PAGES,
    options?.onProgress
      ? (rows, meta) =>
          options.onProgress!(
            rows.map((movement) => purchaseFromMovement(movement)),
            meta,
          )
      : undefined,
  );
  return {
    purchases: result.rows.map((movement) => purchaseFromMovement(movement)),
    error: result.failed ? internalErrorMessage() : null,
    truncated: result.truncated,
  };
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
