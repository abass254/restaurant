import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type {
  CatalogProductMutationResponse,
  InventoryItem,
  InventoryItemMutationResponse,
  StockMovementsResponse,
} from "@/lib/types";

export function inventoryProductName(item: InventoryItem): string {
  return item.product?.name?.trim() || "Product";
}

export function findInventoryByName(
  items: InventoryItem[],
  name: string,
): InventoryItem | undefined {
  const query = name.trim().toLowerCase();
  if (!query) return undefined;
  return items.find(
    (item) => inventoryProductName(item).toLowerCase() === query,
  );
}

/** Create a catalog product and shop inventory row from a name and amount. */
export async function addLiteInventoryProduct(
  name: string,
  amount: string,
  extras?: {
    buying_price?: number | null;
    stock_quantity?: number | null;
  },
): Promise<InventoryItem> {
  const created = await apiFetch<CatalogProductMutationResponse>(
    apiRoutes.products,
    {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        product_type: "product",
      }),
    },
  );
  const parsedAmount = Number(amount);
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventory,
    {
      method: "POST",
      body: JSON.stringify({
        product_id: created.data.id,
        selling_price:
          Number.isFinite(parsedAmount) && parsedAmount > 0
            ? parsedAmount
            : null,
        buying_price: extras?.buying_price ?? null,
        stock_quantity: extras?.stock_quantity ?? null,
        is_active: true,
      }),
    },
  );
  return inventory.data;
}

export async function addInventoryQuantity(
  item: InventoryItem,
  quantity: number,
  extras?: { buying_price?: number | null },
): Promise<InventoryItem> {
  const nextQty = (item.stock_quantity ?? 0) + quantity;
  const body: {
    stock_quantity: number;
    buying_price?: number;
  } = { stock_quantity: nextQty };
  if (extras?.buying_price != null && Number.isFinite(extras.buying_price)) {
    body.buying_price = extras.buying_price;
  }
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventoryItem(item.id),
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
  return inventory.data;
}

export async function ensureTrackedStock(item: InventoryItem): Promise<InventoryItem> {
  if (item.stock_quantity != null) return item;
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventoryItem(item.id),
    {
      method: "PATCH",
      body: JSON.stringify({ stock_quantity: 0 }),
    },
  );
  return inventory.data;
}

export async function receiveStock(options: {
  item: InventoryItem;
  quantity: number;
  reason: "receive" | "adjustment";
  unitCost?: number | null;
  note?: string | null;
  recordOnly?: boolean;
}): Promise<InventoryItem> {
  const item = await ensureTrackedStock(options.item);
  const line: {
    inventory_item_id: string;
    quantity: number;
    unit_cost?: number;
  } = {
    inventory_item_id: item.id,
    quantity: options.quantity,
  };
  if (options.unitCost != null && Number.isFinite(options.unitCost)) {
    line.unit_cost = options.unitCost;
  }
  const result = await apiFetch<StockMovementsResponse>(apiRoutes.inventoryStockMovements, {
    method: "POST",
    body: JSON.stringify({
      direction: "in",
      reason: options.reason,
      note: options.note?.trim() || null,
      record_only: Boolean(options.recordOnly),
      lines: [line],
    }),
  });
  return result.data[0]?.inventory_item ?? item;
}
