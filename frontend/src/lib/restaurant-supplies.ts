/** Restaurant supplies: purchase orders, stock card, stock takes and reports. */

import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";

export type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export type PaymentStatus = "unpaid" | "partial" | "paid";

export type BuyUnit = { name: string; factor: number; buying_price?: number | null };

export type SupplyItem = {
  id: string;
  name: string;
  image_url?: string | null;
  base_unit: string;
  inventory_role: "for_sale" | "raw_material" | "both";
  stock_quantity: number | null;
  /** Kitchen balance; null unless the restaurant uses store and kitchen. */
  kitchen_quantity: number | null;
  low_stock_threshold: number | null;
  is_low_stock: boolean;
  average_cost: number | null;
  preferred_supplier_id: string | null;
  buy_units: BuyUnit[];
};

export type PurchaseOrderLine = {
  id: string;
  inventory_item_id: string;
  item_name: string;
  base_unit: string;
  purchase_unit: string;
  unit_factor: number;
  quantity_ordered: number;
  quantity_received: number;
  quantity_outstanding: number;
  unit_cost: number;
  line_total: number;
  stock_quantity: number | null;
};

export type PurchaseOrderReceipt = {
  id: string;
  line_id: string | null;
  item_name: string | null;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  created_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export type PurchaseOrder = {
  id: string;
  reference: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_invoice_no: string | null;
  status: PurchaseOrderStatus;
  order_date: string | null;
  expected_date: string | null;
  received_at: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  balance: number;
  payment_status: PaymentStatus;
  notes: string | null;
  cancelled_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  lines: PurchaseOrderLine[];
  receipts?: PurchaseOrderReceipt[];
};

export type SupplierSummary = {
  purchase_orders: number;
  total: number;
  paid: number;
  unpaid: number;
};

export type PurchaseOrderLineInput = {
  inventory_item_id: string;
  quantity: number;
  unit_cost: number;
  purchase_unit: string | null;
  unit_factor?: number | null;
};

export type PurchaseOrderCreateInput = {
  supplier_id: string | null;
  status: "draft" | "ordered";
  order_date?: string | null;
  expected_date?: string | null;
  supplier_invoice_no?: string | null;
  discount?: number | null;
  notes?: string | null;
  lines: PurchaseOrderLineInput[];
  receive_now?: boolean;
  amount_paid?: number | null;
};

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Part received",
  received: "Received",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

type One<T> = { data: T; message?: string };

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export async function fetchPurchaseOrders(params: {
  status?: PurchaseOrderStatus | null;
  supplierId?: string | null;
  q?: string | null;
} = {}): Promise<{ data: PurchaseOrder[]; supplier_summary?: SupplierSummary }> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.supplierId) search.set("supplier_id", params.supplierId);
  if (params.q?.trim()) search.set("q", params.q.trim());
  const qs = search.toString();
  return apiFetch(`${apiRoutes.purchaseOrders}${qs ? `?${qs}` : ""}`);
}

export async function fetchSupplyItems(): Promise<SupplyItem[]> {
  const res = await apiFetch<{ data: SupplyItem[] }>(apiRoutes.purchaseOrderSupplyItems);
  return res.data;
}

export async function fetchPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return (await apiFetch<One<PurchaseOrder>>(apiRoutes.purchaseOrder(id))).data;
}

export async function createPurchaseOrder(input: PurchaseOrderCreateInput): Promise<PurchaseOrder> {
  return (await apiFetch<One<PurchaseOrder>>(apiRoutes.purchaseOrders, json(input))).data;
}

export async function markPurchaseOrderOrdered(id: string): Promise<PurchaseOrder> {
  return (await apiFetch<One<PurchaseOrder>>(apiRoutes.purchaseOrderAction(id, "order"), json({}))).data;
}

export async function receivePurchaseOrder(
  id: string,
  lines: { line_id: string; quantity: number; unit_cost?: number | null }[],
  note?: string | null,
): Promise<PurchaseOrder> {
  return (
    await apiFetch<One<PurchaseOrder>>(
      apiRoutes.purchaseOrderAction(id, "receive"),
      json({ lines, note: note || null }),
    )
  ).data;
}

export async function recordPurchaseOrderPayment(id: string, amount: number): Promise<PurchaseOrder> {
  return (await apiFetch<One<PurchaseOrder>>(apiRoutes.purchaseOrderAction(id, "payments"), json({ amount }))).data;
}

export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  return (await apiFetch<One<PurchaseOrder>>(apiRoutes.purchaseOrderAction(id, "cancel"), json({ reason }))).data;
}

export async function voidPurchaseOrderReceipt(movementId: string, reason: string): Promise<PurchaseOrder> {
  return (await apiFetch<One<PurchaseOrder>>(apiRoutes.purchaseOrderReceiptVoid(movementId), json({ reason }))).data;
}

// --- Menu costing --------------------------------------------------------------

export type MenuCostingIngredient = {
  inventory_item_id: string;
  name: string;
  unit: string;
  quantity: number;
  average_cost: number | null;
  cost: number | null;
  stock_quantity: number | null;
  kitchen_quantity: number | null;
  location: StockLocation;
  recipe: boolean;
};

export type MenuCosting = {
  inventory_item_id: string;
  product_id: string;
  name: string;
  product_type: string | null;
  selling_price: number | null;
  has_recipe: boolean;
  cost_per_portion: number | null;
  food_cost_percent: number | null;
  gross_margin: number | null;
  missing_cost: string[];
  portions_available: number | null;
  limiting_ingredient: string | null;
  /** With store and kitchen: portions if the store issued everything it has. */
  portions_with_store: number | null;
  ingredients: MenuCostingIngredient[];
};

export async function fetchMenuCosting(): Promise<MenuCosting[]> {
  return (await apiFetch<{ data: MenuCosting[] }>(apiRoutes.restaurantMenuCosting)).data;
}

// --- Stock card ------------------------------------------------------------------

export type StockLocation = "store" | "kitchen";

export type StockMovementRow = {
  id: string;
  direction: "in" | "out";
  reason: string;
  location: StockLocation;
  kitchen_issue_id: string | null;
  quantity: number;
  signed_quantity: number;
  quantity_before: number | null;
  quantity_after: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  note: string | null;
  order_id: string | null;
  order_number: string | null;
  purchase_order_id: string | null;
  purchase_order_reference: string | null;
  stock_take_id: string | null;
  created_at: string | null;
  voided_at: string | null;
};

export type StockCard = {
  item: {
    id: string;
    name: string;
    unit: string;
    stock_quantity: number | null;
    kitchen_quantity: number | null;
    total_quantity: number | null;
    average_cost: number | null;
    stock_value: number | null;
  };
  movements: StockMovementRow[];
};

export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  receive: "Delivery",
  sale: "Sold",
  sale_reversal: "Order cancelled",
  wastage: "Wastage",
  damage: "Damaged",
  count_variance: "Stock count",
  adjustment: "Adjustment",
  issue: "Issued to kitchen",
  kitchen_return: "Returned to store",
  other: "Other",
};

export const LOCATION_LABELS: Record<StockLocation, string> = {
  store: "Store",
  kitchen: "Kitchen",
};

export async function fetchStockCard(itemId: string): Promise<StockCard> {
  return (await apiFetch<{ data: StockCard }>(apiRoutes.restaurantStockCard(itemId))).data;
}

// --- Stock takes -----------------------------------------------------------------

export type StockTakeLine = {
  id: string;
  inventory_item_id: string;
  item_name: string;
  unit: string;
  expected_qty: number | null;
  current_qty: number | null;
  counted_qty: number | null;
  variance_qty: number | null;
  unit_cost: number | null;
  variance_value: number | null;
};

export type StockTake = {
  id: string;
  status: "draft" | "completed" | "cancelled";
  location: StockLocation;
  notes: string | null;
  counted_at: string | null;
  created_at: string | null;
  line_count: number;
  counted_count: number;
  variance_value: number;
  lines?: StockTakeLine[];
};

export async function fetchStockTakes(location?: StockLocation): Promise<StockTake[]> {
  const qs = location ? `?location=${location}` : "";
  return (await apiFetch<{ data: StockTake[] }>(`${apiRoutes.restaurantStockTakes}${qs}`)).data;
}

export async function startStockTake(location: StockLocation = "store"): Promise<StockTake> {
  return (await apiFetch<One<StockTake>>(apiRoutes.restaurantStockTakes, json({ location }))).data;
}

export async function fetchStockTake(id: string): Promise<StockTake> {
  return (await apiFetch<One<StockTake>>(apiRoutes.restaurantStockTake(id))).data;
}

export async function saveStockTakeCounts(
  id: string,
  counts: { line_id: string; counted_qty: number | null }[],
): Promise<StockTake> {
  return (await apiFetch<One<StockTake>>(apiRoutes.restaurantStockTakeAction(id, "counts"), json({ counts }))).data;
}

export async function completeStockTake(id: string): Promise<StockTake> {
  return (await apiFetch<One<StockTake>>(apiRoutes.restaurantStockTakeAction(id, "complete"), json({}))).data;
}

export async function cancelStockTake(id: string): Promise<StockTake> {
  return (await apiFetch<One<StockTake>>(apiRoutes.restaurantStockTakeAction(id, "cancel"), json({}))).data;
}

// --- Reports -----------------------------------------------------------------------

export type UsageRow = {
  inventory_item_id: string;
  name: string;
  unit: string;
  average_cost: number | null;
  opening: number;
  purchased: number;
  /** Signed as stock coming into the location (negative for the store). */
  issued: number;
  returned: number;
  used_in_sales: number;
  wasted: number;
  adjusted: number;
  count_variance: number;
  closing: number;
  used_in_sales_value: number;
  wasted_value: number;
  purchased_value: number;
  count_variance_value: number;
};

export type UsageReport = {
  items: UsageRow[];
  totals: Partial<Record<
    "purchased_value" | "used_in_sales_value" | "wasted_value" | "adjusted_value" | "count_variance_value",
    number
  >>;
};

export type ProfitReport = {
  totals: {
    revenue: number;
    cost: number;
    gross_profit: number;
    margin_percent: number | null;
    uncosted_lines: number;
  };
  items: {
    name: string;
    quantity: number;
    revenue: number;
    cost: number;
    gross_profit: number;
    margin_percent: number | null;
    uncosted_lines: number;
  }[];
  days: { date: string; revenue: number; cost: number; gross_profit: number }[];
};

function rangeQuery(start: string, end: string): string {
  return new URLSearchParams({ start, end }).toString();
}

export async function fetchUsageReport(start: string, end: string, location?: StockLocation): Promise<UsageReport> {
  const qs = location ? `&location=${location}` : "";
  return (
    await apiFetch<{ data: UsageReport }>(`${apiRoutes.restaurantUsageReport}?${rangeQuery(start, end)}${qs}`)
  ).data;
}

export async function fetchProfitReport(start: string, end: string): Promise<ProfitReport> {
  return (await apiFetch<{ data: ProfitReport }>(`${apiRoutes.restaurantProfitReport}?${rangeQuery(start, end)}`)).data;
}

// --- Store and kitchen -----------------------------------------------------------

export type KitchenItem = {
  inventory_item_id: string;
  name: string;
  unit: string;
  inventory_role: "for_sale" | "raw_material" | "both";
  store_quantity: number;
  kitchen_quantity: number;
  average_cost: number | null;
  kitchen_value: number | null;
  store_value: number | null;
};

export type KitchenSuggestion = KitchenItem & {
  daily_usage: number;
  suggested_qty: number;
};

export type KitchenStock = { enabled: boolean; items: KitchenItem[] };

export type KitchenIssueStatus = "requested" | "issued" | "cancelled";

export type KitchenIssueLine = {
  id: string;
  inventory_item_id: string;
  item_name: string;
  unit: string;
  requested_qty: number | null;
  issued_qty: number | null;
  unit_cost: number | null;
  store_quantity: number | null;
  kitchen_quantity: number | null;
};

export type KitchenIssue = {
  id: string;
  status: KitchenIssueStatus;
  issue_date: string | null;
  notes: string | null;
  requested_by: string | null;
  issued_by: string | null;
  issued_at: string | null;
  created_at: string | null;
  line_count: number;
  issued_value: number;
  lines?: KitchenIssueLine[];
};

/** Must match ISSUABLE_ROLES in the backend kitchen issue service. */
export function isKitchenIssuableRole(role: string | null | undefined): boolean {
  return role === "raw_material" || role === "both";
}

export const KITCHEN_ISSUE_STATUS_LABELS: Record<KitchenIssueStatus, string> = {
  requested: "Waiting for store",
  issued: "Issued",
  cancelled: "Cancelled",
};

export type KitchenDayRow = UsageRow & {
  expected_closing: number;
  counted: number | null;
};

export type KitchenDayReport = {
  location: "kitchen";
  items: KitchenDayRow[];
  totals: UsageReport["totals"] & Partial<Record<"issued_value" | "returned_value", number>>;
  close_out_counts: StockTake[];
};

type ItemQty = { inventory_item_id: string; quantity: number };

export async function fetchKitchenStock(): Promise<KitchenStock> {
  return (await apiFetch<{ data: KitchenStock }>(apiRoutes.kitchenStock)).data;
}

export async function fetchKitchenSuggestion(): Promise<KitchenSuggestion[]> {
  return (await apiFetch<{ data: KitchenSuggestion[] }>(apiRoutes.kitchenSuggest)).data;
}

export async function fetchKitchenIssues(status?: KitchenIssueStatus): Promise<KitchenIssue[]> {
  const qs = status ? `?status=${status}` : "";
  return (await apiFetch<{ data: KitchenIssue[] }>(`${apiRoutes.kitchenIssues}${qs}`)).data;
}

export async function fetchKitchenIssue(id: string): Promise<KitchenIssue> {
  return (await apiFetch<One<KitchenIssue>>(apiRoutes.kitchenIssue(id))).data;
}

export async function createKitchenIssue(input: {
  lines: ItemQty[];
  issue_now: boolean;
  notes?: string | null;
}): Promise<KitchenIssue> {
  return (await apiFetch<One<KitchenIssue>>(apiRoutes.kitchenIssues, json(input))).data;
}

export async function releaseKitchenIssue(
  id: string,
  lines: { line_id: string; quantity: number }[] | null,
): Promise<KitchenIssue> {
  return (await apiFetch<One<KitchenIssue>>(apiRoutes.kitchenIssueAction(id, "issue"), json({ lines }))).data;
}

export async function cancelKitchenIssue(id: string): Promise<KitchenIssue> {
  return (await apiFetch<One<KitchenIssue>>(apiRoutes.kitchenIssueAction(id, "cancel"), json({}))).data;
}

export async function returnToStore(lines: ItemQty[], note?: string | null): Promise<KitchenStock> {
  return (await apiFetch<One<KitchenStock>>(apiRoutes.kitchenReturn, json({ lines, note: note || null }))).data;
}

export async function recordKitchenUsed(
  lines: ItemQty[],
  note?: string | null,
  reason: "adjustment" | "wastage" = "adjustment",
): Promise<KitchenStock> {
  return (
    await apiFetch<One<KitchenStock>>(
      apiRoutes.kitchenUsed,
      json({ lines, note: note || null, reason }),
    )
  ).data;
}

export async function enableKitchenIssuing(openingCounts: ItemQty[]): Promise<KitchenStock> {
  return (await apiFetch<One<KitchenStock>>(apiRoutes.kitchenEnable, json({ opening_counts: openingCounts }))).data;
}

export async function disableKitchenIssuing(): Promise<KitchenStock> {
  return (await apiFetch<One<KitchenStock>>(apiRoutes.kitchenDisable, json({}))).data;
}

export async function fetchKitchenDayReport(date: string): Promise<KitchenDayReport> {
  return (
    await apiFetch<{ data: KitchenDayReport }>(
      `${apiRoutes.restaurantKitchenDayReport}?${new URLSearchParams({ date }).toString()}`,
    )
  ).data;
}

/** Round to what the API accepts for quantities (3 decimals). */
export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// --- Helpers -------------------------------------------------------------------------

export function formatQty(value: number | null | undefined, unit?: string | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  const text = rounded.toLocaleString("en-KE", { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}
