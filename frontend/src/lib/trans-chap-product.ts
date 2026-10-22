import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isVideoMedia } from "@/lib/media";
import { allSellUnits, unitHasSellPrice } from "@/lib/sell-units";
import type {
  CatalogProduct,
  CatalogProductMutationResponse,
  CatalogProductsResponse,
  ComboComponent,
  InventoryItem,
  InventoryItemMutationResponse,
  InventoryRole,
  MealAddon,
  ModifierGroup,
  ModifierOption,
  OptionAvailability,
  RecipeLine,
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
  const type = item.product?.product_type;
  return (
    type === "meal" ||
    type === "combo" ||
    type === "addon" ||
    isMenuCatalogCategory(item.product?.category)
  );
}

export function supportsKitchenRecipe(item: InventoryItem): boolean {
  const type = item.product?.product_type;
  return type === "meal" || (
    type !== "combo" &&
    type !== "addon" &&
    type !== "service" &&
    isMenuCatalogCategory(item.product?.category)
  );
}

/** Stock bought in (sold as-is or used in cooking), as opposed to dishes made in the kitchen. */
export function isSupplyItem(item: InventoryItem): boolean {
  const type = item.product?.product_type;
  return type !== "meal" && type !== "combo" && type !== "addon" && type !== "service";
}

export function isMenuComboItem(item: InventoryItem): boolean {
  return item.product?.product_type === "combo";
}

/** "Required · pick 1", "Optional · up to 3", "Pick 2–4". */
export function modifierRuleLabel(group: Pick<ModifierGroup, "min_select" | "max_select">): string {
  const low = group.min_select || 0;
  const high = Math.max(group.max_select || 1, low);
  if (low === 0) return high === 1 ? "Optional · pick 1" : `Optional · up to ${high}`;
  if (low === high) return `Required · pick ${low}`;
  return `Pick ${low}–${high}`;
}

/** Every option group the till asks for an item, including the dishes inside a meal. */
export function itemModifierGroups(item: InventoryItem): { label: string | null; group: ModifierGroup }[] {
  const product = item.product;
  if (!product) return [];
  const own = (product.modifier_groups ?? []).map((group) => ({ label: null, group }));
  const nested = (product.combo_components ?? []).flatMap((component) =>
    component.modifier_groups.map((group) => ({ label: component.name || "Item", group })),
  );
  return [...own, ...nested].filter((entry) => entry.group.options.some((o) => o.is_active));
}

export type ModifierGroupInput = {
  name: string;
  min_select: number;
  max_select: number;
  included: boolean;
  options: {
    id?: string;
    name: string;
    price_delta: number;
    product_id?: string | null;
    stock_qty?: number;
    is_default: boolean;
  }[];
};

/** Price of one pick, as the server charges it: included groups are free, otherwise the option's own price. */
export function modifierOptionPrice(option: ModifierOption, group: Pick<ModifierGroup, "included">): number {
  if (group.included) return 0;
  return Number(option.price_delta) || 0;
}

export type OptionAvailabilityMap = Map<string, OptionAvailability>;

export async function fetchOptionAvailability(): Promise<OptionAvailabilityMap> {
  const res = await apiFetch<{ data: OptionAvailability[] }>(apiRoutes.menuOptionAvailability);
  return new Map(res.data.map((row) => [row.option_id, row]));
}

export async function setModifierOptionActive(optionId: string, isActive: boolean): Promise<ModifierOption> {
  const res = await apiFetch<{ data: ModifierOption }>(apiRoutes.menuModifierOption(optionId), {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
  return res.data;
}

/** Options missing from the map (e.g. just created) count as available unless switched off. */
export function isOptionAvailable(option: ModifierOption, availability: OptionAvailabilityMap | null): boolean {
  const row = availability?.get(option.id);
  return row ? row.available : option.is_active !== false;
}

export function optionUnavailableLabel(
  option: ModifierOption,
  availability: OptionAvailabilityMap | null,
): string | null {
  if (isOptionAvailable(option, availability)) return null;
  return availability?.get(option.id)?.reason === "out_of_stock" ? "Out of stock" : "Sold out";
}

/** First required modifier on a meal with fewer available options than customers must pick. */
export function mealBlockedBy(
  item: InventoryItem,
  availability: OptionAvailabilityMap | null,
): ModifierGroup | null {
  for (const group of item.product?.modifier_groups ?? []) {
    const required = group.min_select ?? 0;
    if (required <= 0) continue;
    const available = group.options.filter((option) => isOptionAvailable(option, availability)).length;
    if (available < required) return group;
  }
  return null;
}

export async function fetchModifierGroups(): Promise<ModifierGroup[]> {
  const res = await apiFetch<{ data: ModifierGroup[] }>(apiRoutes.menuModifierGroups);
  return res.data;
}

export async function saveModifierGroup(
  groupId: string | null,
  input: ModifierGroupInput,
): Promise<ModifierGroup> {
  const res = await apiFetch<{ data: ModifierGroup }>(
    groupId ? apiRoutes.menuModifierGroup(groupId) : apiRoutes.menuModifierGroups,
    { method: groupId ? "PATCH" : "POST", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteModifierGroup(groupId: string): Promise<void> {
  await apiFetch(apiRoutes.menuModifierGroup(groupId), { method: "DELETE" });
}

export async function saveItemModifierGroups(
  productId: string,
  groupIds: string[],
): Promise<ModifierGroup[]> {
  const res = await apiFetch<{ data: ModifierGroup[] }>(apiRoutes.productModifierGroups(productId), {
    method: "PUT",
    body: JSON.stringify({ group_ids: groupIds }),
  });
  return res.data;
}

export async function saveRecipe(
  dishProductId: string,
  lines: { product_id: string; quantity: number }[],
  servingUnit: string,
): Promise<{ lines: RecipeLine[]; servingUnit: string }> {
  const res = await apiFetch<{ data: RecipeLine[]; serving_unit: string }>(apiRoutes.productRecipe(dishProductId), {
    method: "PUT",
    body: JSON.stringify({ lines, serving_unit: servingUnit }),
  });
  return { lines: res.data, servingUnit: res.serving_unit };
}

/**
 * Ingredient cost of one portion from the supplies' buying prices.
 * ``priced`` is false when some ingredient has no buying price yet.
 */
export function recipeCost(
  lines: { productId: string; quantity: number }[],
  supplyByProductId: Map<string, InventoryItem>,
): { cost: number; priced: boolean } {
  let cost = 0;
  let priced = true;
  for (const line of lines) {
    const unitCost = supplyByProductId.get(line.productId)?.buying_price;
    if (unitCost == null) priced = false;
    else cost += unitCost * line.quantity;
  }
  return { cost, priced };
}

export async function saveComboComponents(
  comboProductId: string,
  components: { product_id: string; quantity: number }[],
): Promise<ComboComponent[]> {
  const res = await apiFetch<{ data: ComboComponent[] }>(
    apiRoutes.productComboComponents(comboProductId),
    { method: "PUT", body: JSON.stringify({ components }) },
  );
  return res.data;
}

export function isMenuAddonItem(item: InventoryItem): boolean {
  return item.product?.product_type === "addon";
}

export type MenuSectionDef = { id: string; label: string };

export const DEFAULT_MENU_SECTIONS: MenuSectionDef[] = [
  { id: "mains", label: "Mains" },
  { id: "bites", label: "Bites & snacks" },
  { id: "hot_drinks", label: "Hot drinks" },
  { id: "cold_drinks", label: "Cold drinks" },
];

/** The dish's section id, falling back to the first section when it was removed in Settings. */
export function menuSection(item: InventoryItem, sections: MenuSectionDef[]): string {
  const raw = item.product?.attributes?.menu_section;
  if (typeof raw === "string" && sections.some((s) => s.id === raw)) return raw;
  return sections[0]?.id ?? "mains";
}

export async function fetchMenuSections(): Promise<MenuSectionDef[]> {
  const res = await apiFetch<{ sections: MenuSectionDef[] }>(apiRoutes.settingsMenuSections);
  return res.sections.length ? res.sections : DEFAULT_MENU_SECTIONS;
}

export async function saveMenuSections(
  sections: { id?: string; label: string }[],
): Promise<MenuSectionDef[]> {
  const res = await apiFetch<{ sections: MenuSectionDef[] }>(apiRoutes.settingsMenuSections, {
    method: "PUT",
    body: JSON.stringify({ sections }),
  });
  return res.sections;
}

export type MenuProductType = "meal" | "combo" | "addon";

/** Save a hotel dish, meal or add-on to the catalogue and price it for this shop. */
export async function createMenuItem(input: {
  name: string;
  price: number;
  productType: MenuProductType;
  section?: string;
}): Promise<InventoryItem> {
  const created = await apiFetch<CatalogProductMutationResponse>(apiRoutes.products, {
    method: "POST",
    body: JSON.stringify({
      name: input.name.trim(),
      product_type: input.productType,
      category: "food_beverage",
      ...(input.section ? { attributes: { menu_section: input.section } } : {}),
    }),
  });
  return addInventoryFromCatalogProduct(created.data.id, {
    selling_price: input.price,
    stock_quantity: null,
    inventory_role: "for_sale",
  });
}

export async function updateMenuItem(
  item: InventoryItem,
  input: { name: string; price: number; productType: MenuProductType; section?: string },
): Promise<InventoryItem> {
  const product = item.product;
  if (product) {
    const attributes = input.section
      ? { ...(product.attributes ?? {}), menu_section: input.section }
      : product.attributes;
    const nameChanged = product.name.trim() !== input.name.trim();
    const typeChanged = product.product_type !== input.productType;
    const sectionChanged = input.section != null && product.attributes?.menu_section !== input.section;
    if (nameChanged || typeChanged || sectionChanged) {
      await apiFetch<CatalogProductMutationResponse>(apiRoutes.product(product.id), {
        method: "PATCH",
        body: JSON.stringify({
          name: input.name.trim(),
          product_type: input.productType,
          attributes,
        }),
      });
    }
  }
  return updateInventoryItem(item.id, {
    selling_price: input.price,
    stock_quantity: null,
    inventory_role: "for_sale",
  });
}

export type MealAddonLine = {
  addon_id: string;
  additional_price: number | null;
  is_required?: boolean;
  max_quantity?: number;
};

export async function saveMealAddons(
  mealProductId: string,
  addons: MealAddonLine[],
): Promise<MealAddon[]> {
  const res = await apiFetch<{ data: MealAddon[] }>(apiRoutes.productAddons(mealProductId), {
    method: "PUT",
    body: JSON.stringify({ addons }),
  });
  return res.data;
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
  if (item.stock_quantity != null && item.stock_quantity <= 0) return false;
  return allSellUnits(item).some((unit) => unitHasSellPrice(unit));
}

/** Active shop inventory except hotel menu — available on Purchases select/scan. */
export function canPurchaseInventoryItem(item: InventoryItem): boolean {
  if (!item.is_active) return false;
  if (isHotelMenuItem(item)) return false;
  return true;
}

export function canPurchaseCatalogProduct(product: CatalogProduct): boolean {
  if (product.is_active === false) return false;
  if (product.product_type === "service" || product.product_type === "addon") return false;
  if (isMenuCatalogCategory(product.category)) return false;
  return true;
}

export function canPurchaseCatalogProductForStore(
  product: CatalogProduct,
  retailOnly: boolean,
): boolean {
  if (!canPurchaseCatalogProduct(product)) return false;
  if (!retailOnly) return true;
  return product.product_type === "retail" || product.product_type === "product";
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
  options?: { retailOnly?: boolean },
): Promise<CatalogProduct[]> {
  const items: CatalogProduct[] = [];
  let page = 1;
  let lastPage = 1;
  const q = query?.trim();
  do {
    const params = new URLSearchParams({
      per_page: "100",
      page: String(page),
    });
    if (q) params.set("q", q);
    const res = await apiFetch<CatalogProductsResponse>(
      `${apiRoutes.products}?${params.toString()}`,
    );
    items.push(
      ...res.data.filter((product) =>
        canPurchaseCatalogProductForStore(product, options?.retailOnly === true),
      ),
    );
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
    attributes?: Record<string, unknown> | null;
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
    unit?: string | null;
    inventory_role?: InventoryRole;
  },
): Promise<InventoryItem> {
  const sku = extras?.sku?.trim() || undefined;
  const productCode = extras?.product_code?.trim() || undefined;
  const category = extras?.category?.trim() || undefined;
  const unit = extras?.unit?.trim() || undefined;
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
        ...(unit ? { unit } : {}),
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
