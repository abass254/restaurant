import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type {
  CatalogProductMutationResponse,
  InventoryItem,
  InventoryItemMutationResponse,
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
        stock_quantity: null,
        is_active: true,
      }),
    },
  );
  return inventory.data;
}
