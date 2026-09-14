import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isVideoMedia } from "@/lib/media";
import type {
  CatalogProduct,
  CatalogProductMutationResponse,
  CatalogProductsResponse,
  InventoryItem,
  InventoryItemMutationResponse,
  InventoryRole,
  ProductImageUploadResponse,
  StockMovementsResponse,
} from "@/lib/types";

export function inventoryProductName(item: InventoryItem): string {
  return item.product?.name?.trim() || "Product";
}

export function inventoryCoverUrl(item: InventoryItem): string | null {
  const photos = (item.media ?? []).filter((media) => !isVideoMedia(media));
  return photos.at(-1)?.url || item.product?.image_url || null;
}

export function isMenuCatalogCategory(category: string | null | undefined): boolean {
  const normalized = (category || "").trim().toLowerCase().replace(/\s+/g, "_");
  return (
    normalized === "food_beverage" ||
    normalized === "food_&_beverage" ||
    normalized === "hotel_menu" ||
    normalized === "hotel"
  );
}

export function isHotelMenuItem(item: InventoryItem): boolean {
  return isMenuCatalogCategory(item.product?.category);
}

export function inventoryRole(item: InventoryItem | null | undefined): InventoryRole {
  const role = String(item?.inventory_role || "for_sale").trim().toLowerCase();
  if (role === "raw_material" || role === "both") return role;
  return "for_sale";
}

export function isSaleableRole(role: InventoryRole): boolean {
  return role === "for_sale" || role === "both";
}

/** Roles that are typically restocked via Purchases (excludes pure sell-only). */
export function isPurchasableRole(role: InventoryRole): boolean {
  return role === "raw_material" || role === "both";
}

export function inventoryRoleLabel(role: InventoryRole): string {
  if (role === "raw_material") return "Raw material";
  if (role === "both") return "Buy & sell";
  return "Sell only";
}

export function inventoryRoleShortLabel(role: InventoryRole): string {
  if (role === "raw_material") return "Raw";
  if (role === "both") return "Buy & sell";
  return "Sell only";
}

export function canSellInventoryItem(item: InventoryItem): boolean {
  if (!item.is_active) return false;
  if (!isSaleableRole(inventoryRole(item))) return false;
  if (item.selling_price == null || item.selling_price <= 0) return false;
  if (item.stock_quantity != null && item.stock_quantity <= 0) return false;
  return true;
}

/** Active shop inventory except hotel menu — available on Purchases select/scan. */
export function canPurchaseInventoryItem(item: InventoryItem): boolean {
  if (!item.is_active) return false;
  if (isHotelMenuItem(item)) return false;
  return true;
}

export function canPurchaseCatalogProduct(product: CatalogProduct): boolean {
  if (product.product_type !== "product") return false;
  if (isMenuCatalogCategory(product.category)) return false;
  return true;
}

/** Create a shop inventory row for an existing global catalog product. */
export async function addInventoryFromCatalogProduct(
  productId: string,
  extras?: {
    buying_price?: number | null;
    selling_price?: number | null;
    stock_quantity?: number | null;
    inventory_role?: InventoryRole;
  },
): Promise<InventoryItem> {
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventory,
    {
      method: "POST",
      body: JSON.stringify({
        product_id: productId,
        selling_price: extras?.selling_price ?? null,
        buying_price: extras?.buying_price ?? null,
        stock_quantity: extras?.stock_quantity ?? 0,
        inventory_role: extras?.inventory_role ?? "both",
        is_active: true,
      }),
    },
  );
  return inventory.data;
}

export async function fetchPurchasableCatalogProducts(
  query?: string,
): Promise<CatalogProduct[]> {
  const items: CatalogProduct[] = [];
  let page = 1;
  let lastPage = 1;
  const q = query?.trim();
  do {
    const params = new URLSearchParams({
      type: "product",
      per_page: "100",
      page: String(page),
    });
    if (q) params.set("q", q);
    const res = await apiFetch<CatalogProductsResponse>(
      `${apiRoutes.products}?${params.toString()}`,
    );
    items.push(...res.data.filter(canPurchaseCatalogProduct));
    lastPage = res.meta?.last_page ?? 1;
    page += 1;
  } while (page <= lastPage && page <= 10);
  return items;
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

export async function updateInventorySellingPrice(
  itemId: string,
  sellingPrice: number,
): Promise<InventoryItem> {
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventoryItem(itemId),
    {
      method: "PATCH",
      body: JSON.stringify({ selling_price: sellingPrice }),
    },
  );
  return inventory.data;
}

export async function updateInventoryActive(
  itemId: string,
  isActive: boolean,
): Promise<InventoryItem> {
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventoryItem(itemId),
    {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    },
  );
  return inventory.data;
}

export async function updateInventoryItem(
  itemId: string,
  payload: {
    selling_price?: number | null;
    buying_price?: number | null;
    stock_quantity?: number | null;
    inventory_role?: InventoryRole;
  },
): Promise<InventoryItem> {
  const inventory = await apiFetch<InventoryItemMutationResponse>(
    apiRoutes.inventoryItem(itemId),
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return inventory.data;
}

export async function updateProductName(
  productId: string,
  name: string,
): Promise<CatalogProduct> {
  const product = await apiFetch<CatalogProductMutationResponse>(
    apiRoutes.product(productId),
    {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim() }),
    },
  );
  return product.data;
}

/** Create a catalog product and shop inventory row from a name and amount. */
export async function addLiteInventoryProduct(
  name: string,
  amount: string,
  extras?: {
    buying_price?: number | null;
    stock_quantity?: number | null;
    sku?: string | null;
    product_code?: string | null;
    category?: string | null;
    inventory_role?: InventoryRole;
  },
): Promise<InventoryItem> {
  const sku = extras?.sku?.trim() || undefined;
  const productCode = extras?.product_code?.trim() || undefined;
  const category = extras?.category?.trim() || undefined;
  const created = await apiFetch<CatalogProductMutationResponse>(
    apiRoutes.products,
    {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        product_type: "product",
        ...(sku ? { sku } : {}),
        ...(productCode ? { product_code: productCode } : {}),
        ...(category ? { category } : {}),
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
        inventory_role: extras?.inventory_role ?? "both",
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

export async function uploadInventoryPhoto(
  itemId: string,
  file: File,
): Promise<InventoryItem> {
  const form = new FormData();
  form.append("files", file);
  const res = await apiFetch<ProductImageUploadResponse>(
    apiRoutes.inventoryMedia(itemId),
    { method: "POST", body: form },
  );
  return res.data;
}
