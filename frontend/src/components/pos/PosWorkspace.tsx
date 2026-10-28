"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { usePlatformRuntime } from "@/lib/platform-runtime";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  showInternalError,
  showSuccess,
  toastSuccess,
} from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import {
  staggerContainer,
  staggerItem,
  springSoft,
  duration as motionDuration,
  easeOutExpressive,
} from "@/lib/motion";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";
import { suppressMerchantOrderNotification } from "@/lib/merchant-notifications";
import {
  ALL_FULFILLMENT_TYPES,
  ALL_PAYMENT_METHODS,
  POS_SOURCES,
  FULFILLMENT_ICONS,
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  SOURCE_ICONS,
  SOURCE_LABELS,
  STATUS_LABELS,
  formatMoney,
  orderHasSuccessfulMpesa,
  orderPaymentLabel,
} from "@/lib/orders";
import {
  paymentStatusFromOrder,
  receiptFromOrder,
  receiptHeaderLines,
  saveTransChapReceipt,
  transChapReceiptHref,
} from "@/lib/trans-chap-receipt";
import { TransChapReceiptPrint } from "@/components/trans-chap/TransChapReceiptSlip";
import { TransChapCustomerQuickAdd } from "@/components/trans-chap/TransChapCustomerQuickAdd";
import { findInventoryByBarcode } from "@/lib/barcode";
import { normalizeUnitName, packUnits } from "@/lib/sell-units";
import { formatCategoryLabel } from "@/lib/product-categories";
import {
  hasKitchenRecipe,
  inventoryCoverUrl,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  itemModifierGroups,
  DEFAULT_RESTAURANT_TABLES,
  fetchOptionAvailability,
  fetchRestaurantTables,
  mealBlockedBy,
  type OptionAvailabilityMap,
} from "@/lib/trans-chap-product";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { getCachedInventory, setCachedInventory } from "@/lib/inventory-cache";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { isRestaurantStore } from "@/lib/onboarding";
import {
  TransChapModifierModal,
  type ModifierPickResult,
} from "@/components/pos/TransChapModifierModal";
import type {
  InventoryItem,
  InventoryResponse,
  Order,
  OrderCreatePayload,
  OrderFulfillmentType,
  OrderDetailResponse,
  OrderItemModifier,
  OrderMpesaPushResult,
  OrderMutationResponse,
  OrderPaymentMethod,
  OrderPaymentSplit,
  OrderSource,
  ShopCustomer,
  ShopCustomersListResponse,
  SettingsOperationsResponse,
  RestaurantTableDef,
} from "@/lib/types";

const MPESA_POLL_MS = 4_000;

type PendingMpesaSale = {
  order: Order;
  push: OrderMpesaPushResult | null;
};

export type PosWorkspaceProps = {
  /**
   * Station terminal mode: stay on this screen after sale and complete
   * paid pickup orders (cash / card / credit) through handoff.
   */
  completeInPlace?: boolean;
  /**
   * Trans Chap counter sales: walk-in + pickup only, cash / M-Pesa / credit.
   * Matches `/trans-chap/sales` payment rules.
   */
  salesProfile?: "full" | "transchap";
};

const IMMEDIATE_COMPLETE_PAYMENTS: ReadonlySet<OrderPaymentMethod> = new Set([
  "cash",
  "card",
  "credit",
]);
const POS_PREFERRED_SELL_UNITS_KEY = "pos:preferred_sell_units:v1";

const TRANSCHAP_PAYMENT_METHODS: OrderPaymentMethod[] = [
  "cash",
  "mpesa",
  "credit",
  "split",
];

type CartLine = {
  lineId?: string;
  inventoryItemId: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  unit_price: number;
  base_price?: number;
  buying_price?: number | null;
  quantity: number;
  image_url: string | null;
  modifiers?: OrderItemModifier[] | null;
  /** Option-group picks; when set the server prices the line from these. */
  optionIds?: string[] | null;
  notes?: string | null;
  sellUnit?: string | null;
  unitFactor?: number;
  bulkFactor?: number;
  autoPackFactor?: number;
};

/** A cart key is a line id, or an inventory id for lines that have none (product-card buttons). */
function lineKeyMatches(lines: CartLine[], line: CartLine, key: string): boolean {
  const exact = lines.some((c) => (c.lineId || c.inventoryItemId) === key);
  return exact ? (line.lineId || line.inventoryItemId) === key : line.inventoryItemId === key;
}

type PreferredSellUnit = {
  sellUnit: string | null;
  unitFactor: number;
};

function readPreferredSellUnit(item: InventoryItem): PreferredSellUnit | null {
  try {
    const raw = window.localStorage.getItem(POS_PREFERRED_SELL_UNITS_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const value = saved[item.id];
    if (!value || typeof value !== "object") return null;
    const preference = value as Record<string, unknown>;
    const sellUnit =
      typeof preference.sellUnit === "string" ? preference.sellUnit : null;
    const unitFactor = Number(preference.unitFactor);
    if (!Number.isFinite(unitFactor) || unitFactor <= 0 || unitFactor > 1_000_000) {
      return null;
    }

    const fractionalUnit = fractionalSellUnits(item).find(
      (unit) => unit.name === sellUnit && unit.factor === unitFactor,
    );
    if (fractionalUnit) return { sellUnit, unitFactor };

    if (
      fractionalSellUnits(item).length === 0 &&
      sellUnit === "Bulk" &&
      unitFactor >= 2
    ) {
      return { sellUnit, unitFactor };
    }
    return null;
  } catch {
    return null;
  }
}

function rememberPreferredSellUnit(
  itemId: string,
  preference: PreferredSellUnit,
) {
  try {
    const raw = window.localStorage.getItem(POS_PREFERRED_SELL_UNITS_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    saved[itemId] = preference;
    window.localStorage.setItem(
      POS_PREFERRED_SELL_UNITS_KEY,
      JSON.stringify(saved),
    );
  } catch {
    // The selection still applies to the current cart if storage is unavailable.
  }
}

/**
 * Try to detect pack size from product names like "Unga (pack of 24)" or "Water (12pcs)".
 */
function detectPackSize(name: string): number | null {
  const normalized = name.toLowerCase();
  // Matches "pack of 24", "bundle of 12", "box of 6", etc.
  const packMatch = normalized.match(/(?:pack|bundle|box|carton|case|crate)\s+(?:of\s+)?(\d+)/);
  if (packMatch) return parseInt(packMatch[1], 10);

  // Matches "24pcs", "12 pcs", "24 packets", etc.
  const pcsMatch = normalized.match(/(\d+)\s*(?:pcs|packets|pieces|pkts)/);
  if (pcsMatch) return parseInt(pcsMatch[1], 10);

  return null;
}

function fractionalSellUnits(item: InventoryItem | null | undefined) {
  const unit = item?.product?.unit?.trim().toLowerCase();
  const normalized = unit?.replace(/\.$/, "");
  const kilogramUnits = [
    "kg",
    "kgs",
    "kg(s)",
    "kilogram",
    "kilograms",
    "kilogram(s)",
  ];
  const litreUnits = [
    "l",
    "ls",
    "l(s)",
    "liter",
    "liters",
    "litre",
    "litres",
    "liter(s)",
    "litre(s)",
  ];
  if (!normalized || (!kilogramUnits.includes(normalized) && !litreUnits.includes(normalized))) {
    return [];
  }
  const baseUnit = litreUnits.includes(normalized) ? "L" : "KG";
  return [
    { name: `1/4 ${baseUnit}`, factor: 0.25 },
    { name: `1/2 ${baseUnit}`, factor: 0.5 },
    { name: `3/4 ${baseUnit}`, factor: 0.75 },
    { name: baseUnit, factor: 1 },
  ];
}

type SplitMethod = OrderPaymentSplit["method"];

/** One editable row of a split payment; amount stays a string while typing. */
type SplitDraft = { method: SplitMethod; amount: string };

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getLineBuyingPrice(
  line: CartLine,
  stockItem?: InventoryItem | null,
): number | null {
  const item = stockItem;
  if (item && line.sellUnit) {
    const packs = packUnits(item);
    const matchedPack = packs.find(
      (p) => normalizeUnitName(p.name) === normalizeUnitName(line.sellUnit),
    );
    if (
      matchedPack?.buying_price != null &&
      Number.isFinite(matchedPack.buying_price) &&
      matchedPack.buying_price > 0
    ) {
      return matchedPack.buying_price;
    }
  }

  const baseBuyingPrice =
    item?.buying_price ??
    (line.buying_price != null && Number.isFinite(line.buying_price)
      ? line.buying_price
      : null);

  if (
    baseBuyingPrice == null ||
    !Number.isFinite(baseBuyingPrice) ||
    baseBuyingPrice <= 0
  ) {
    return null;
  }

  const factor = line.unitFactor || 1;
  return roundMoney(baseBuyingPrice * factor);
}

function isLinePriceBelowBuying(
  line: CartLine,
  stockItem?: InventoryItem | null,
  draftPrice?: string,
): boolean {
  const buyingPrice = getLineBuyingPrice(line, stockItem);
  if (buyingPrice == null) return false;

  let currentPrice = line.unit_price;
  if (draftPrice !== undefined) {
    if (draftPrice === "" || draftPrice === ".") {
      currentPrice = 0;
    } else {
      const parsed = Number(draftPrice);
      if (Number.isFinite(parsed)) {
        currentPrice = parsed;
      }
    }
  }
  return roundMoney(currentPrice) < roundMoney(buyingPrice);
}

function parseSplitDrafts(value: unknown): SplitDraft[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((row) =>
    row &&
    typeof row === "object" &&
    typeof (row as SplitDraft).method === "string" &&
    typeof (row as SplitDraft).amount === "string"
      ? [{ method: (row as SplitDraft).method, amount: (row as SplitDraft).amount }]
      : [],
  );
  return rows.length ? rows : undefined;
}

type PosHeldSession = {
  id: string;
  label: string;
  cart: CartLine[];
  source: OrderSource;
  fulfillment: OrderFulfillmentType;
  tableNumber?: string;
  paymentMethod: OrderPaymentMethod | "";
  paymentSplits?: SplitDraft[];
  customerName: string;
  customerPhone: string;
  selectedCustomerId: string;
  deliveryAddress: string;
  deliveryCoords: { lat: number; lng: number } | null;
  deliveryNotes: string;
  deliveryFee: string;
  discount: string;
  notes: string;
  updatedAt: number;
};

const MAX_HELD_SESSIONS = 8;

function newHeldSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `held-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cartItemCount(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

function cartSubtotal(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
}

function labelForHeldSession(input: {
  tableNumber?: string;
  customerName: string;
  customerPhone: string;
  cart: CartLine[];
}): string {
  if (input.tableNumber?.trim()) return input.tableNumber.trim();
  const name = input.customerName.trim();
  if (name) return name;
  const phone = input.customerPhone.trim();
  if (phone) return phone;
  const count = cartItemCount(input.cart);
  return count === 1 ? "1 item" : `${count} items`;
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.inventoryItemId === "string" &&
    typeof row.name === "string" &&
    typeof row.unit_price === "number" &&
    typeof row.quantity === "number"
  );
}

function parseHeldSessions(raw: string | null): PosHeldSession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const sessions: PosHeldSession[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string" || !Array.isArray(row.cart)) continue;
      const cart = row.cart.filter(isCartLine);
      if (cart.length === 0) continue;
      const customerName =
        typeof row.customerName === "string" ? row.customerName : "";
      const customerPhone =
        typeof row.customerPhone === "string" ? row.customerPhone : "";
      sessions.push({
        id: row.id,
        label:
          typeof row.label === "string" && row.label.trim()
            ? row.label
            : labelForHeldSession({ customerName, customerPhone, cart }),
        cart,
        source: typeof row.source === "string" ? (row.source as OrderSource) : "walkin",
        fulfillment:
          typeof row.fulfillment === "string"
            ? (row.fulfillment as OrderFulfillmentType)
            : "pickup",
        paymentMethod:
          typeof row.paymentMethod === "string"
            ? (row.paymentMethod as OrderPaymentMethod | "")
            : "",
        paymentSplits: parseSplitDrafts(row.paymentSplits),
        customerName,
        customerPhone,
        selectedCustomerId:
          typeof row.selectedCustomerId === "string" ? row.selectedCustomerId : "",
        deliveryAddress:
          typeof row.deliveryAddress === "string" ? row.deliveryAddress : "",
        deliveryCoords:
          row.deliveryCoords &&
            typeof row.deliveryCoords === "object" &&
            typeof (row.deliveryCoords as { lat?: unknown }).lat === "number" &&
            typeof (row.deliveryCoords as { lng?: unknown }).lng === "number"
            ? {
              lat: (row.deliveryCoords as { lat: number }).lat,
              lng: (row.deliveryCoords as { lng: number }).lng,
            }
            : null,
        deliveryNotes:
          typeof row.deliveryNotes === "string" ? row.deliveryNotes : "",
        deliveryFee: typeof row.deliveryFee === "string" ? row.deliveryFee : "",
        discount: typeof row.discount === "string" ? row.discount : "",
        notes: typeof row.notes === "string" ? row.notes : "",
        updatedAt:
          typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
      });
      if (sessions.length >= MAX_HELD_SESSIONS) break;
    }
    return sessions;
  } catch {
    return [];
  }
}

function nameInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function isServiceItem(item: InventoryItem): boolean {
  return item.product?.product_type === "service";
}

/** Physical products need tracked stock; services and fresh hotel dishes are always available. */
function isOutOfStock(item: InventoryItem): boolean {
  if (isServiceItem(item) || isHotelMenuItem(item)) {
    if (item.stock_quantity != null) {
      return item.stock_quantity <= 0;
    }
    return false;
  }
  const stock = item.stock_quantity;
  return stock == null || stock <= 0;
}

function maxCartQty(item: InventoryItem): number | null {
  if (isServiceItem(item) || isHotelMenuItem(item)) {
    if (item.stock_quantity != null && item.stock_quantity > 0) {
      return item.stock_quantity;
    }
    return null;
  }
  const stock = item.stock_quantity;
  if (stock == null || stock <= 0) return 0;
  return stock;
}

function stockUnitsForCartLine(line: CartLine): number {
  return line.quantity * Math.max(0.0001, line.unitFactor ?? 1);
}

/** On-hand units still free to sell (stock minus what's already in the cart). */
function availableToSell(item: InventoryItem, inCartQty: number): number | null {
  if (isServiceItem(item)) return null;
  if (isHotelMenuItem(item) && item.stock_quantity == null) return null;
  const stock = item.stock_quantity;
  if (stock == null) return null;
  return Math.max(0, stock - Math.max(0, inCartQty));
}

export function PosWorkspace({
  completeInPlace = false,
  salesProfile = "full",
}: PosWorkspaceProps) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { priceEditEnabled } = usePlatformRuntime();
  const { mapEnabled } = useGoogleMapsPublicConfig();
  const isTransChapSale = salesProfile === "transchap";
  const initialCached = getCachedInventory();
  const [items, setItems] = useState<InventoryItem[]>(() => initialCached ?? []);
  const [catalogById, setCatalogById] = useState<Map<string, InventoryItem>>(() => {
    const map = new Map<string, InventoryItem>();
    if (initialCached) {
      for (const item of initialCached) map.set(item.id, item);
    }
    return map;
  });
  const inventoryLoadedOnce = useRef(Boolean(initialCached && initialCached.length > 0));
  const [loading, setLoading] = useState(() => !inventoryLoadedOnce.current);
  const [searching, setSearching] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [pendingMpesa, setPendingMpesa] = useState<PendingMpesaSale | null>(null);
  const [mpesaBusy, setMpesaBusy] = useState(false);
  const printAfterSaleRef = useRef(false);
  const paidPrintIdRef = useRef<string | null>(null);
  const inventoryRequestId = useRef(0);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [bulkFactorDrafts, setBulkFactorDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [mobileScreen, setMobileScreen] = useState<"catalog" | "order">("catalog");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  // Visual "just-added" pulse: holds the inventoryItem id that should flash.
  // Cleared on a short timer so the animation can replay if the same item is
  // tapped again in quick succession.
  const [pulseId, setPulseId] = useState<string | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const scannerBuffer = useRef("");
  const scannerLastKeyAt = useRef(0);
  const scannerResetTimer = useRef<number | null>(null);
  const scanToastTimer = useRef<number | null>(null);

  const authUser = useOptionalAuthUser();
  const receiptShopName =
    authUser?.active_account?.business_name || authUser?.account?.business_name || "DukAI";
  const isRestaurant = Boolean(
    authUser && isRestaurantStore(authUser.active_account ?? authUser.account),
  );

  const [source, setSource] = useState<OrderSource>("walkin");
  const [fulfillment, setFulfillment] = useState<OrderFulfillmentType>("pickup");
  const [tableNumber, setTableNumber] = useState<string>("Table 1");
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTableDef[]>(
    DEFAULT_RESTAURANT_TABLES,
  );

  useEffect(() => {
    if (!isRestaurant) return;
    let alive = true;
    fetchRestaurantTables()
      .then((tables) => {
        if (alive && tables?.length) {
          setRestaurantTables(tables);
          setTableNumber((curr) => {
            if (curr && tables.some((t) => t.label === curr)) return curr;
            return tables[0]?.label || "Table 1";
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isRestaurant]);
  const [modifyingItem, setModifyingItem] = useState<{
    item: InventoryItem;
    cartLineId?: string;
    initialOptionIds?: string[] | null;
    initialModifiers?: OrderItemModifier[] | null;
    initialNotes?: string | null;
  } | null>(null);

  useEffect(() => {
    if (isRestaurant && fulfillment === "pickup") {
      setFulfillment("dine_in");
    }
  }, [isRestaurant]);

  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod | "">(
    isTransChapSale && !isRestaurant ? "mpesa" : "",
  );
  const [splitRows, setSplitRows] = useState<SplitDraft[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [mpesaReceiptCode, setMpesaReceiptCode] = useState("");
  const [creditDueDate, setCreditDueDate] = useState("");
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [includeTax, setIncludeTax] = useState(true);
  const [quickAddQty, setQuickAddQty] = useState(1);
  const [heldSessions, setHeldSessions] = useState<PosHeldSession[]>([]);
  const [heldHydrated, setHeldHydrated] = useState(false);
  const [allowPriceUpdate, setAllowPriceUpdate] = useState(false);
  const [forceMpesaPrompt, setForceMpesaPrompt] = useState(true);
  const [mpesaAction, setMpesaAction] = useState<"record" | "stk">("record");
  const [operationsSettingsLoaded, setOperationsSettingsLoaded] = useState(false);
  const [operationsSettingsError, setOperationsSettingsError] = useState<string | null>(
    null,
  );
  const canEditPrice = priceEditEnabled || allowPriceUpdate;

  const loadOperationsSettings = useCallback(async () => {
    setOperationsSettingsError(null);
    try {
      const res = await apiFetch<SettingsOperationsResponse>(
        apiRoutes.settingsOperations,
      );
      setAllowPriceUpdate(res.allow_price_adjustment);
      setForceMpesaPrompt(res.force_mpesa_prompt);
      setOperationsSettingsLoaded(true);
    } catch (err) {
      setOperationsSettingsLoaded(false);
      setOperationsSettingsError(
        extractErrorMessage(err, "Could not load payment settings."),
      );
    }
  }, []);

  useEffect(() => {
    void loadOperationsSettings();
  }, [loadOperationsSettings]);

  const AUTO_PRINT_STORAGE_KEY = "pos:auto_print_receipt";
  const INCLUDE_TAX_STORAGE_KEY = "pos:include_tax_price";
  const HELD_SESSIONS_STORAGE_KEY = `pos:held_sessions:${salesProfile}`;
  const CART_COLLAPSED_STORAGE_KEY = "pos:cart_collapsed";

  const [isCartCollapsed, setIsCartCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_COLLAPSED_STORAGE_KEY);
      if (saved === "1") setIsCartCollapsed(true);
    } catch {}
  }, []);

  const toggleCartCollapsed = useCallback(() => {
    setIsCartCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(CART_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  const heldQtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of heldSessions) {
      for (const line of session.cart) {
        map.set(
          line.inventoryItemId,
          (map.get(line.inventoryItemId) ?? 0) + stockUnitsForCartLine(line),
        );
      }
    }
    return map;
  }, [heldSessions]);

  const [optionAvailability, setOptionAvailability] = useState<OptionAvailabilityMap | null>(null);

  const reload = useCallback(async (opts?: { silent?: boolean; q?: string }) => {
    const requestId = ++inventoryRequestId.current;
    if (isRestaurant) {
      fetchOptionAvailability()
        .then(setOptionAvailability)
        .catch(() => {
          /* the server still rejects sold-out picks */
        });
    }
    const hasData = items.length > 0 || inventoryLoadedOnce.current;
    const silent = opts?.silent ?? hasData;
    if (!silent && !hasData) setLoading(true);
    else if (!hasData) setSearching(true);
    try {
      // In POS, only active items should appear in the catalog
      const params = new URLSearchParams({ active: "true" });
      const term = (opts?.q ?? "").trim();
      if (term) params.set("q", term);
      const data = await apiFetch<InventoryResponse>(
        `${apiRoutes.inventory}?${params.toString()}`,
      );
      if (requestId !== inventoryRequestId.current) return;
      setItems(data.data);
      setCachedInventory(data.data);
      inventoryLoadedOnce.current = true;
      setLoadedQuery(term);
      setCatalogById((prev) => {
        const next = new Map(prev);
        for (const item of data.data) next.set(item.id, item);
        return next;
      });
      setError(null);
    } catch (err) {
      if (requestId !== inventoryRequestId.current) return;
      if (!hasData) setError(extractErrorMessage(err, "Failed to load inventory."));
    } finally {
      if (requestId !== inventoryRequestId.current) return;
      setLoading(false);
      setSearching(false);
    }
  }, [isRestaurant, items.length]);

  useEffect(() => {
    const firstLoad = !inventoryLoadedOnce.current;
    void reload({ silent: !firstLoad });
  }, [reload]);

  useEffect(() => {
    void apiFetch<ShopCustomersListResponse>(apiRoutes.customers)
      .then((res) => setCustomers(res.data))
      .catch(() => {
        /* POS still works with typed name and phone. */
      });
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimer.current !== null) {
        window.clearTimeout(pulseTimer.current);
      }
      if (scannerResetTimer.current !== null) {
        window.clearTimeout(scannerResetTimer.current);
      }
      if (scanToastTimer.current !== null) {
        window.clearTimeout(scanToastTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTO_PRINT_STORAGE_KEY);
      if (raw === null) return;
      setAutoPrintReceipt(raw === "1");
    } catch {
      // Ignore storage access failures and keep sensible default.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(INCLUDE_TAX_STORAGE_KEY);
      if (raw === null) return;
      setIncludeTax(raw === "1");
    } catch {
      // Ignore storage access failures and keep sensible default.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(HELD_SESSIONS_STORAGE_KEY);
      setHeldSessions(parseHeldSessions(raw));
    } catch {
      setHeldSessions([]);
    } finally {
      setHeldHydrated(true);
    }
  }, [HELD_SESSIONS_STORAGE_KEY]);

  useEffect(() => {
    if (!heldHydrated) return;
    try {
      window.sessionStorage.setItem(
        HELD_SESSIONS_STORAGE_KEY,
        JSON.stringify(heldSessions),
      );
    } catch {
      // Ignore storage access failures; held sales still work this session.
    }
  }, [HELD_SESSIONS_STORAGE_KEY, heldHydrated, heldSessions]);

  function handleAutoPrintChange(next: boolean) {
    setAutoPrintReceipt(next);
    try {
      window.localStorage.setItem(AUTO_PRINT_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access failures; setting still applies this session.
    }
  }

  function handleIncludeTaxChange(next: boolean) {
    setIncludeTax(next);
    try {
      window.localStorage.setItem(INCLUDE_TAX_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access failures; setting still applies this session.
    }
  }

  function handleQuickAddQtyChange(value: string) {
    setQuickAddQty(Math.max(1, Math.floor(Number(value) || 1)));
  }

  function clearScannerBuffer() {
    scannerBuffer.current = "";
    scannerLastKeyAt.current = 0;
    if (scannerResetTimer.current !== null) {
      window.clearTimeout(scannerResetTimer.current);
      scannerResetTimer.current = null;
    }
  }

  function flashPulse(id: string) {
    setPulseId(id);
    if (pulseTimer.current !== null) {
      window.clearTimeout(pulseTimer.current);
    }
    pulseTimer.current = window.setTimeout(() => {
      setPulseId(null);
      pulseTimer.current = null;
    }, 350);
  }

  const addToCart = useCallback((item: InventoryItem, qty = quickAddQty) => {
    const addAmount = Math.max(1, Math.floor(qty || 1));
    if (!item.is_active) {
      void showError(
        "Paused",
        `"${item.product?.name ?? "This item"}" is paused. Turn it on in the Kitchen or Menu before selling it.`,
      );
      return;
    }
    if (!isSaleableRole(inventoryRole(item))) {
      void showError(
        "Raw material",
        `"${item.product?.name ?? "This item"}" is marked as a raw material and can’t be sold.`,
      );
      return;
    }
    if (item.selling_price === null && !canEditPrice) {
      void showError(
        "No price set",
        `"${item.product?.name ?? "This item"}" doesn't have a selling price yet. Set one in Inventory first.`,
      );
      return;
    }
    if (isOutOfStock(item)) {
      void showError(
        "Out of stock",
        `"${item.product?.name ?? "This item"}" has no stock available. Update quantity in Inventory first.`,
      );
      return;
    }

    const heldQty = heldQtyByItemId.get(item.id) ?? 0;
    const stockCap = maxCartQty(item);
    const availableStock = stockCap === null ? null : Math.max(0, stockCap - heldQty);
    const savedPreference = readPreferredSellUnit(item);
    const preferredSellUnit =
      savedPreference &&
      (availableStock === null || savedPreference.unitFactor <= availableStock)
        ? savedPreference
        : null;
    const initialUnitFactor = preferredSellUnit?.unitFactor ?? 1;
    let blocked = false;
    setCart((prev) => {
      // Customised dish lines stay separate from plain taps of the same dish.
      const existing = prev.find(
        (c) =>
          c.inventoryItemId === item.id &&
          !c.modifiers?.length &&
          !c.optionIds?.length &&
          !c.notes,
      );
      const hasOtherLine = prev.some((c) => c.inventoryItemId === item.id);
      const nextQty = (existing?.quantity ?? 0) + addAmount;
      const unitFactor = Math.max(
        0.0001,
        existing?.unitFactor ?? initialUnitFactor,
      );
      const maxLineQty =
        availableStock === null ? null : Math.floor(availableStock / unitFactor);
      if (maxLineQty !== null && nextQty > maxLineQty) {
        blocked = true;
        return prev;
      }
      if (existing) {
        return prev.map((c) =>
          c === existing ? { ...c, quantity: nextQty } : c,
        );
      }
      const autoPackFactor =
        packUnits(item)[0]?.factor ??
        detectPackSize(item.product?.name ?? "") ??
        2;
      return [
        ...prev,
        {
          ...(hasOtherLine
            ? { lineId: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
            : {}),
          inventoryItemId: item.id,
          product_id: item.product_id,
          name: item.product?.name ?? `#${item.product_id}`,
          sku: item.product?.sku ?? null,
          unit_price: (item.selling_price ?? 0) * initialUnitFactor,
          base_price: item.selling_price ?? 0,
          buying_price: item.buying_price ?? null,
          quantity: addAmount,
          image_url: item.product?.image_url ?? null,
          autoPackFactor,
          unitFactor: initialUnitFactor,
          bulkFactor:
            preferredSellUnit?.sellUnit === "Bulk"
              ? initialUnitFactor
              : autoPackFactor,
          sellUnit: preferredSellUnit?.sellUnit ?? null,
        },
      ];
    });
    if (blocked) {
      void showError(
        "Not enough stock",
        `Only ${availableStock ?? 0} stock units of "${item.product?.name ?? "this item"}" are available${heldQty > 0 ? " after held sales" : ""}.`,
      );
      return;
    }
    flashPulse(item.id);
  }, [heldQtyByItemId, canEditPrice, quickAddQty]);

  useEffect(() => {
    function isEditableElement(el: Element | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    async function handleUnknownBarcode(code: string) {
      await showError(
        "Barcode not found",
        `No product matched "${code}". Use Product code or SKU from Inventory.`,
      );
    }

    async function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableElement(document.activeElement)) return;

      if (event.key === "Enter") {
        const scanned = scannerBuffer.current.trim();
        clearScannerBuffer();
        if (scanned.length < 3) return;
        event.preventDefault();

        let matched =
          findInventoryByBarcode(items, scanned) ??
          findInventoryByBarcode([...catalogById.values()], scanned);
        if (!matched) {
          try {
            const params = new URLSearchParams({ active: "true", q: scanned });
            const data = await apiFetch<InventoryResponse>(
              `${apiRoutes.inventory}?${params.toString()}`,
            );
            setCatalogById((prev) => {
              const next = new Map(prev);
              for (const item of data.data) next.set(item.id, item);
              return next;
            });
            matched = findInventoryByBarcode(data.data, scanned);
          } catch {
            matched = undefined;
          }
        }
        if (!matched) {
          void handleUnknownBarcode(scanned);
          return;
        }

        addToCart(matched);
        setSearch("");
        if (scanToastTimer.current !== null) {
          window.clearTimeout(scanToastTimer.current);
        }
        scanToastTimer.current = window.setTimeout(() => {
          scanToastTimer.current = null;
        }, 1000);
        void toastSuccess(`Scanned: ${matched.product?.name ?? "item"} added`);
        return;
      }

      if (event.key.length !== 1) return;

      const now = Date.now();
      if (now - scannerLastKeyAt.current > 140) {
        scannerBuffer.current = "";
      }
      scannerLastKeyAt.current = now;
      scannerBuffer.current += event.key;

      if (scannerResetTimer.current !== null) {
        window.clearTimeout(scannerResetTimer.current);
      }
      scannerResetTimer.current = window.setTimeout(() => {
        clearScannerBuffer();
      }, 280);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [addToCart, catalogById, clearScannerBuffer, items]);

  const itemsById = catalogById;

  const inCatalog = useCallback(
    (item: InventoryItem) => {
      if (!item.is_active) return false;
      if (isRestaurant) {
        return isHotelMenuItem(item) && hasKitchenRecipe(item);
      }
      return isSaleableRole(inventoryRole(item));
    },
    [isRestaurant],
  );

  const catalogItems = useMemo(() => items.filter(inCatalog), [items, inCatalog]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const item of catalogItems) {
      const cat = item.product?.category?.trim();
      if (cat) set.add(cat);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogItems]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalogItems
      .filter((item) => {
        if (
          selectedCategory !== "all" &&
          (item.product?.category || "").trim().toLowerCase() !== selectedCategory.toLowerCase()
        ) {
          return false;
        }
        if (!term) return true;
        const name = (item.product?.name || "").toLowerCase();
        const sku = (item.product?.sku || item.product?.product_code || "").toLowerCase();
        const brand = (item.product?.brand || "").toLowerCase();
        const cat = (item.product?.category || "").toLowerCase();
        const supplier = (item.supplier || "").toLowerCase();
        return (
          name.includes(term) ||
          sku.includes(term) ||
          brand.includes(term) ||
          cat.includes(term) ||
          supplier.includes(term)
        );
      })
      .sort((a, b) => Number(b.is_active) - Number(a.is_active));
  }, [catalogItems, search, selectedCategory]);

  const POS_PAGE_SIZE = 24;
  const [posVisibleCount, setPosVisibleCount] = useState(POS_PAGE_SIZE);

  useEffect(() => {
    setPosVisibleCount(POS_PAGE_SIZE);
  }, [loadedQuery, selectedCategory, search]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, posVisibleCount);
  }, [filteredItems, posVisibleCount]);

  const posHasMore = visibleItems.length < filteredItems.length;
  const posSentinelRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!posHasMore) return;
    const target = posSentinelRef.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPosVisibleCount((prev) => Math.min(prev + POS_PAGE_SIZE, filteredItems.length));
        }
      },
      { rootMargin: "400px" },
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [posHasMore, filteredItems.length]);

  useEffect(() => {
    if (!posHasMore) return;
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 500
      ) {
        setPosVisibleCount((prev) => Math.min(prev + POS_PAGE_SIZE, filteredItems.length));
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [posHasMore, filteredItems.length]);

  // Once initial data is loaded, disable ANY loading effect for the page!
  const hasData = items.length > 0 || inventoryLoadedOnce.current;
  const catalogPending = !hasData && loading;

  const handleConfirmModifiers = ({
    optionIds,
    modifiers,
    notes,
    unitPrice,
    name,
  }: ModifierPickResult) => {
    if (!modifyingItem) return;
    const { item, cartLineId } = modifyingItem;
    const lineId = cartLineId || `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const hasGroups = itemModifierGroups(item).length > 0;
    const picked = {
      name,
      unit_price: unitPrice,
      modifiers: modifiers.length > 0 ? modifiers : null,
      optionIds: hasGroups ? optionIds : null,
      notes: notes || null,
    };

    setCart((prev) => {
      if (cartLineId) {
        return prev.map((c) =>
          (c.lineId || c.inventoryItemId) === cartLineId ? { ...c, lineId: c.lineId || lineId, ...picked } : c,
        );
      }
      return [
        ...prev,
        {
          lineId,
          inventoryItemId: item.id,
          product_id: item.product_id,
          sku: item.product?.sku ?? null,
          base_price: item.selling_price ?? 0,
          buying_price: item.buying_price ?? null,
          quantity: quickAddQty || 1,
          image_url: item.product?.image_url ?? null,
          ...picked,
        },
      ];
    });
    flashPulse(item.id);
    setModifyingItem(null);
  };

  /** Menu items with option groups open the picker; the rest go straight to the order. */
  function tapMenuItem(item: InventoryItem) {
    if (itemModifierGroups(item).length > 0) setModifyingItem({ item });
    else addToCart(item);
  }

  function changeQuantity(key: string, delta: number) {
    const target = cart.find((c) => lineKeyMatches(cart, c, key));
    const item = target ? itemsById.get(target.inventoryItemId) : null;
    const stockCap = item ? maxCartQty(item) : null;
    const heldQty = target ? (heldQtyByItemId.get(target.inventoryItemId) ?? 0) : 0;
    const availableStock =
      stockCap === null ? null : Math.max(0, stockCap - heldQty);
    const maxLineQty =
      availableStock === null || !target
        ? null
        : Math.floor(
            availableStock / Math.max(0.0001, target.unitFactor ?? 1),
          );
    setCart((prev) =>
      prev
        .map((c) => {
          if (!lineKeyMatches(prev, c, key)) return c;
          let next = c.quantity + delta;
          if (maxLineQty !== null) next = Math.min(next, maxLineQty);
          return { ...c, quantity: next };
        })
        .filter((c) => c.quantity > 0),
    );
  }

  function setQuantity(key: string, value: string) {
    const target = cart.find((c) => lineKeyMatches(cart, c, key));
    const item = target ? itemsById.get(target.inventoryItemId) : null;
    const stockCap = item ? maxCartQty(item) : null;
    const heldQty = target ? (heldQtyByItemId.get(target.inventoryItemId) ?? 0) : 0;
    const availableStock =
      stockCap === null ? null : Math.max(0, stockCap - heldQty);
    const maxLineQty =
      availableStock === null || !target
        ? null
        : Math.floor(
            availableStock / Math.max(0.0001, target.unitFactor ?? 1),
          );
    let next = Math.max(0, Math.floor(Number(value) || 0));
    if (maxLineQty !== null) next = Math.min(next, maxLineQty);
    setCart((prev) =>
      prev
        .map((c) =>
          lineKeyMatches(prev, c, key)
            ? { ...c, quantity: next }
            : c,
        )
        .filter((c) => c.quantity > 0),
    );
  }

  function setUnitPrice(key: string, value: string) {
    const next = Math.max(0, Number(value) || 0);
    setCart((prev) =>
      prev.map((c) =>
        lineKeyMatches(prev, c, key)
          ? { ...c, unit_price: next, base_price: next / (c.unitFactor || 1) }
          : c,
      ),
    );
  }

  function updateLineUnit(key: string, sellUnit: string | null, unitFactor: number) {
    const target = cart.find(
      (line) =>
        lineKeyMatches(cart, line, key),
    );
    if (!target) return;
    clearLinePriceDraft(key);
    clearLinePriceDraft(target.inventoryItemId);
    const item = itemsById.get(target.inventoryItemId);
    const stockCap = item ? maxCartQty(item) : null;
    const heldQty = heldQtyByItemId.get(target.inventoryItemId) ?? 0;
    const maxLineQty =
      stockCap === null
        ? null
        : Math.floor(
            Math.max(0, stockCap - heldQty) / Math.max(0.0001, unitFactor),
          );
    if (maxLineQty === 0) {
      void showError(
        "Not enough stock",
        `There isn't enough stock for one ${sellUnit || "unit"} of "${target.name}".`,
      );
      return;
    }
    rememberPreferredSellUnit(target.inventoryItemId, { sellUnit, unitFactor });
    setCart((prev) =>
      prev.map((line) => {
        if (
          !lineKeyMatches(prev, line, key)
        ) {
          return line;
        }
        const basePrice =
          line.base_price ?? line.unit_price / (line.unitFactor || 1);
        return {
          ...line,
          sellUnit,
          unitFactor,
          bulkFactor: sellUnit === "Bulk" ? unitFactor : line.bulkFactor,
          quantity:
            maxLineQty === null
              ? line.quantity
              : Math.min(line.quantity, maxLineQty),
          unit_price: basePrice * unitFactor,
        };
      }),
    );
  }

  function updateLineBulkFactor(key: string, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const factor = Math.min(1_000_000, Math.max(2, Math.floor(parsed)));
    const target = cart.find(
      (line) =>
        lineKeyMatches(cart, line, key),
    );
    if (!target) return;
    const item = itemsById.get(target.inventoryItemId);
    const stockCap = item ? maxCartQty(item) : null;
    const heldQty = heldQtyByItemId.get(target.inventoryItemId) ?? 0;
    const maxLineQty =
      stockCap === null
        ? null
        : Math.floor(Math.max(0, stockCap - heldQty) / factor);
    if (maxLineQty === 0) {
      void showError(
        "Not enough stock",
        `There isn't enough stock for one bulk of ${factor} units of "${target.name}".`,
      );
      return;
    }
    rememberPreferredSellUnit(target.inventoryItemId, {
      sellUnit: "Bulk",
      unitFactor: factor,
    });
    setCart((prev) =>
      prev.map((line) => {
        if (!lineKeyMatches(prev, line, key)) {
          return line;
        }
        return {
          ...line,
          autoPackFactor: line.autoPackFactor ?? factor,
          base_price: line.base_price ?? line.unit_price / (line.unitFactor || 1),
          unitFactor: factor,
          bulkFactor: factor,
          sellUnit: "Bulk",
          quantity:
            maxLineQty === null
              ? line.quantity
              : Math.min(line.quantity, maxLineQty),
          unit_price:
            (line.base_price ?? line.unit_price / (line.unitFactor || 1)) * factor,
        };
      }),
    );
  }

  function handleBulkFactorInput(key: string, value: string) {
    const draft = value.replace(/\D/g, "");
    setBulkFactorDrafts((prev) => ({ ...prev, [key]: draft }));
    if (draft && Number(draft) >= 2 && Number(draft) <= 1_000_000) {
      updateLineBulkFactor(key, draft);
    }
  }

  function finishBulkFactorInput(key: string) {
    setBulkFactorDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function updateLinePrice(key: string, price: number) {
    setCart((prev) =>
      prev.map((line) => {
        if (
          !lineKeyMatches(prev, line, key)
        ) {
          return line;
        }
        return {
          ...line,
          unit_price: price,
          ...(line.unitFactor === 1 || !line.unitFactor ? { base_price: price } : {}),
        };
      }),
    );
  }

  function handleLinePriceInput(key: string, value: string) {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned;
    setPriceDrafts((prev) => ({ ...prev, [key]: normalized }));
    if (normalized !== "" && normalized !== ".") {
      const parsed = Number(normalized);
      if (Number.isFinite(parsed) && parsed >= 0) {
        updateLinePrice(key, parsed);
      }
    }
  }

  function finishLinePriceInput(key: string) {
    setPriceDrafts((prev) => {
      const draft = prev[key];
      if (draft !== undefined) {
        if (draft === "" || draft === ".") {
          updateLinePrice(key, 0);
        }
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  }

  function clearLinePriceDraft(key: string) {
    setPriceDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function updateLineBulkPrice(key: string, value: string) {
    const price = Math.max(0, Number(value) || 0);
    updateLinePrice(key, price);
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((c) => !lineKeyMatches(prev, c, key)));
    setBulkFactorDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    clearLinePriceDraft(key);
  }

  function clearCart() {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setMpesaReceiptCode("");
    setBulkFactorDrafts({});
    setPriceDrafts({});
    setDeliveryAddress("");
    setDeliveryCoords(null);
    setDeliveryNotes("");
    setDeliveryFee("");
    setDiscount("");
    setNotes("");
    setPaymentMethod(isTransChapSale ? "mpesa" : "");
    setSplitRows([]);
    setCreditDueDate("");
    setSelectedCustomerId("");
    if (!isTransChapSale) {
      setSource("walkin");
      setFulfillment(isRestaurant ? "dine_in" : "pickup");
    }
    setTableNumber("Table 1");
    setMobileScreen("catalog");
  }

  function snapshotCurrentSale(): PosHeldSession {
    return {
      id: newHeldSessionId(),
      label: labelForHeldSession({ tableNumber, customerName, customerPhone, cart }),
      cart: cart.map((line) => ({ ...line })),
      source,
      fulfillment,
      tableNumber,
      paymentMethod,
      paymentSplits:
        paymentMethod === "split" ? splitRows.map((row) => ({ ...row })) : undefined,
      customerName,
      customerPhone,
      selectedCustomerId,
      deliveryAddress,
      deliveryCoords,
      deliveryNotes,
      deliveryFee,
      discount,
      notes,
      updatedAt: Date.now(),
    };
  }

  function applyHeldSession(session: PosHeldSession) {
    setCart(session.cart.map((line) => ({ ...line })));
    setBulkFactorDrafts({});
    setPriceDrafts({});
    setSource(isTransChapSale ? "walkin" : session.source);
    setFulfillment(isTransChapSale ? (isRestaurant ? session.fulfillment : "pickup") : session.fulfillment);
    setTableNumber(session.tableNumber || "Table 1");
    const restoredSplits =
      session.paymentMethod === "split" && session.paymentSplits?.length
        ? session.paymentSplits.map((row) => ({ ...row }))
        : null;
    setPaymentMethod(
      restoredSplits
        ? "split"
        : isTransChapSale
          ? session.paymentMethod &&
            session.paymentMethod !== "split" &&
            TRANSCHAP_PAYMENT_METHODS.includes(session.paymentMethod)
            ? session.paymentMethod
            : "mpesa"
          : session.paymentMethod === "split"
            ? ""
            : session.paymentMethod,
    );
    setSplitRows(restoredSplits ?? []);
    setCustomerName(session.customerName);
    setCustomerPhone(session.customerPhone);
    setSelectedCustomerId(session.selectedCustomerId);
    setDeliveryAddress(session.deliveryAddress);
    setDeliveryCoords(session.deliveryCoords);
    setDeliveryFee(session.deliveryFee);
    setDiscount(session.discount);
    setNotes(session.notes);
  }

  async function holdCurrentSale() {
    if (cart.length === 0) {
      await showError(
        "Nothing to hold",
        "Add items to the current sale before holding it.",
      );
      return;
    }
    if (heldSessions.length >= MAX_HELD_SESSIONS) {
      await showError(
        "Too many held sales",
        `Resume or discard one of the ${MAX_HELD_SESSIONS} held sales first.`,
      );
      return;
    }
    const snapshot = snapshotCurrentSale();
    setHeldSessions((prev) => [...prev, snapshot]);
    clearCart();
    void toastSuccess(`Held “${snapshot.label}”`);
  }

  async function resumeHeldSale(sessionId: string) {
    const session = heldSessions.find((row) => row.id === sessionId);
    if (!session) return;

    if (cart.length > 0) {
      const snapshot = snapshotCurrentSale();
      setHeldSessions((prev) => [
        ...prev.filter((row) => row.id !== sessionId),
        snapshot,
      ]);
      applyHeldSession(session);
      setMobileScreen("order");
      void toastSuccess(`Resumed “${session.label}” · held “${snapshot.label}”`);
      return;
    }

    setHeldSessions((prev) => prev.filter((row) => row.id !== sessionId));
    applyHeldSession(session);
    setMobileScreen("order");
    void toastSuccess(`Resumed “${session.label}”`);
  }

  async function discardHeldSale(sessionId: string) {
    const session = heldSessions.find((row) => row.id === sessionId);
    if (!session) return;
    const confirmed = await confirmAction(
      "Discard held sale?",
      `Remove “${session.label}” from held sales? This cannot be undone.`,
      "Discard",
    );
    if (!confirmed) return;
    setHeldSessions((prev) => prev.filter((row) => row.id !== sessionId));
  }

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  function applyCustomer(customerId: string) {
    if (!customerId) {
      setSelectedCustomerId("");
      setCustomerName("");
      setCustomerPhone("");
      return;
    }
    const customer = customers.find((row) => row.id === customerId);
    if (!customer) return;
    setSelectedCustomerId(customerId);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone || "");
    if (customer.address) {
      setDeliveryAddress(customer.address);
    }
  }

  /** Called by the quick-add modal; the new row isn't in `customers` yet, so select it directly. */
  function handleCustomerCreated(customer: ShopCustomer) {
    setCustomers((prev) =>
      [customer, ...prev.filter((row) => row.id !== customer.id)].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setSelectedCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone || "");
    if (customer.address) {
      setDeliveryAddress(customer.address);
    }
    setAddCustomerOpen(false);
  }

  const itemCount = useMemo(
    () => cart.reduce((sum, c) => sum + c.quantity, 0),
    [cart],
  );
  const subtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.unit_price * c.quantity, 0),
    [cart],
  );
  const deliveryFeeNum =
    fulfillment === "delivery" && (!isTransChapSale || isRestaurant) ? Number(deliveryFee) || 0 : 0;
  const discountNum = Number(discount) || 0;
  const baseTotal = Math.max(0, subtotal + deliveryFeeNum - discountNum);
  const taxAmount = includeTax ? roundMoney(baseTotal * 0.16) : 0;
  const total = roundMoney(baseTotal + taxAmount);

  const isSplit = paymentMethod === "split";
  const splitMethodOptions: SplitMethod[] = isTransChapSale
    ? ["cash", "mpesa", "credit"]
    : ["cash", "mpesa", "card", "credit", "other"];
  const splitParts: OrderPaymentSplit[] = isSplit
    ? splitRows
        .map((row) => ({ method: row.method, amount: roundMoney(Number(row.amount) || 0) }))
        .filter((row) => row.amount > 0)
    : [];
  const splitAllocated = roundMoney(splitParts.reduce((sum, row) => sum + row.amount, 0));
  const splitRemaining = roundMoney(total - splitAllocated);
  const splitPortion = (method: SplitMethod) =>
    splitParts.filter((row) => row.method === method).reduce((sum, row) => sum + row.amount, 0);
  const usesMpesa = paymentMethod === "mpesa" || (isSplit && splitPortion("mpesa") > 0);
  const usesCredit = paymentMethod === "credit" || (isSplit && splitPortion("credit") > 0);
  const mpesaDue = isSplit ? splitPortion("mpesa") : total;
  const creditDue = isSplit ? splitPortion("credit") : total;
  const completesImmediately =
    paymentMethod !== "" &&
    (isSplit ? !usesMpesa : IMMEDIATE_COMPLETE_PAYMENTS.has(paymentMethod));

  function choosePaymentMethod(method: OrderPaymentMethod | "") {
    setPaymentMethod(method);
    if (method !== "mpesa" && method !== "split") setMpesaReceiptCode("");
    if (method === "split" && splitRows.length === 0) {
      setSplitRows([
        { method: "cash", amount: "" },
        { method: "mpesa", amount: "" },
      ]);
    }
  }

  function updateSplitRow(index: number, patch: Partial<SplitDraft>) {
    setSplitRows((rows) => {
      const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
      // With two parts, typing one amount fills the other with what's left.
      if (patch.amount !== undefined && next.length === 2) {
        const typed = roundMoney(Number(patch.amount) || 0);
        const rest = roundMoney(Math.max(0, total - typed));
        next[1 - index] = { ...next[1 - index], amount: rest > 0 ? String(rest) : "" };
      }
      return next;
    });
  }

  function addSplitRow() {
    const used = new Set(splitRows.map((row) => row.method));
    const method = splitMethodOptions.find((m) => !used.has(m));
    if (!method) return;
    setSplitRows((rows) => [
      ...rows,
      { method, amount: splitRemaining > 0 ? String(splitRemaining) : "" },
    ]);
  }

  function removeSplitRow(index: number) {
    setSplitRows((rows) => rows.filter((_, i) => i !== index));
  }

  function fillSplitRemainder(index: number) {
    const current = roundMoney(Number(splitRows[index]?.amount) || 0);
    const amount = roundMoney(current + splitRemaining);
    setSplitRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, amount: amount > 0 ? String(amount) : "" } : row)),
    );
  }

  useEffect(() => {
    if (typeof window === "undefined" || selectedCustomerId || customers.length === 0) return;
    const targetId = new URLSearchParams(window.location.search).get("customer");
    if (targetId && customers.some((c) => c.id === targetId)) {
      applyCustomer(targetId);
    }
  }, [customers, selectedCustomerId]);

  const creditNeedsCustomer = usesCredit;
  const showWalkInPhone =
    !selectedCustomerId &&
    (usesMpesa || (!isTransChapSale && !usesCredit));

  const customerInitials = useMemo(() => {
    if (!selectedCustomer?.name) return "C";
    return selectedCustomer.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }, [selectedCustomer]);

  const creditUtilization = useMemo(() => {
    if (!selectedCustomer || selectedCustomer.credit_limit <= 0) return null;
    const limit = selectedCustomer.credit_limit;
    const avail = Math.max(0, selectedCustomer.available_credit);
    const pct = Math.max(0, Math.min(100, (avail / limit) * 100));
    return {
      limit,
      avail,
      pct,
      isLow: pct <= 25,
      isExceeded: selectedCustomer.available_credit <= 0,
      debt: selectedCustomer.outstanding_balance || 0,
    };
  }, [selectedCustomer]);

  const customerFields = (
    <div className="pos-fields pos-fields--customer pos-fields--customer-solo">
      {selectedCustomer ? (
        <div className="pos-customer-card">
          <div className="pos-customer-card__top">
            <div className="pos-customer-card__profile">
              <div className="pos-customer-card__avatar" aria-hidden>
                {customerInitials}
              </div>
              <div className="pos-customer-card__info">
                <strong className="pos-customer-card__name">
                  {selectedCustomer.name}
                </strong>
                {selectedCustomer.phone ? (
                  <span className="pos-customer-card__phone">
                    <i className="fa-solid fa-phone" aria-hidden />{" "}
                    {selectedCustomer.phone}
                  </span>
                ) : (
                  <span className="pos-customer-card__phone">
                    No phone on file
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="pos-customer-card__change-btn"
              onClick={() => applyCustomer("")}
              title="Change or remove selected customer"
            >
              <i className="fa-solid fa-arrows-rotate" aria-hidden />
              <span>Change</span>
            </button>
          </div>

          {usesMpesa ? (
            <div className="pos-customer-card__mpesa-box">
              {!forceMpesaPrompt ? (
                <div
                  className="pos-mpesa-mode-selector"
                  role="radiogroup"
                  aria-label="M-PESA checkout option"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mpesaAction === "record"}
                    className={`pos-mpesa-mode-btn ${mpesaAction === "record" ? "is-active" : ""}`}
                    onClick={() => setMpesaAction("record")}
                  >
                    <i className="fa-solid fa-receipt" aria-hidden="true" />
                    <span>Record payment</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mpesaAction === "stk"}
                    className={`pos-mpesa-mode-btn ${mpesaAction === "stk" ? "is-active" : ""}`}
                    onClick={() => setMpesaAction("stk")}
                  >
                    <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
                    <span>Send STK push</span>
                  </button>
                </div>
              ) : null}

              {forceMpesaPrompt || mpesaAction === "stk" ? (
                <>
                  <label
                    className="pos-customer-card__mpesa-label"
                    htmlFor="pos-customer-stk-phone"
                  >
                    <i className="fa-solid fa-mobile-screen-button" aria-hidden />
                    <span>Send M-PESA prompt to:</span>
                  </label>
                  <div className="pos-customer-card__mpesa-input-wrap">
                    <input
                      id="pos-customer-stk-phone"
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="2547…"
                      aria-label="M-PESA prompt phone"
                      className={
                        !customerPhone.trim() ? "pos-input--required" : undefined
                      }
                    />
                  </div>
                  {!forceMpesaPrompt ? (
                    <small>
                      Prompt of {formatMoney(mpesaDue)} will be sent to the customer&apos;s phone.
                    </small>
                  ) : null}
                </>
              ) : (
                <>
                  <label
                    className="pos-customer-card__mpesa-label"
                    htmlFor="pos-mpesa-receipt-code"
                  >
                    <i className="fa-solid fa-receipt" aria-hidden />
                    <span>M-PESA receipt code (optional)</span>
                  </label>
                  <div className="pos-customer-card__mpesa-input-wrap">
                    <input
                      id="pos-mpesa-receipt-code"
                      type="text"
                      autoComplete="off"
                      value={mpesaReceiptCode}
                      onChange={(e) => setMpesaReceiptCode(e.target.value)}
                      placeholder="Enter code from customer's SMS"
                      aria-label="M-PESA receipt code"
                    />
                  </div>
                  <small>
                    Confirm receipt of {formatMoney(mpesaDue)}. Add the SMS code if
                    available.
                  </small>
                </>
              )}
            </div>
          ) : null}

          {creditUtilization ? (
            <div className="pos-customer-card__credit">
              <div className="pos-customer-card__credit-header">
                <span className="pos-customer-card__credit-title">
                  <i className="fa-solid fa-wallet" aria-hidden /> Credit Tab
                </span>
                <span className="pos-customer-card__credit-ratio">
                  {creditUtilization.pct.toFixed(0)}% available
                </span>
              </div>
              <div className="pos-customer-card__credit-bar">
                <div
                  className={`pos-customer-card__credit-bar-fill${creditUtilization.isExceeded
                      ? " is-exceeded"
                      : creditUtilization.isLow
                        ? " is-low"
                        : ""
                    }`}
                  style={{ width: `${creditUtilization.pct}%` }}
                />
              </div>
              <dl className="pos-customer-card__credit-facts">
                <div>
                  <dt>Available</dt>
                  <dd className="pos-customer-card__credit-avail">
                    {formatMoney(creditUtilization.avail)}
                  </dd>
                </div>
                <div>
                  <dt>Limit</dt>
                  <dd>{formatMoney(creditUtilization.limit)}</dd>
                </div>
                {creditUtilization.debt > 0 ? (
                  <div>
                    <dt>Owes</dt>
                    <dd className="pos-customer-card__credit-debt">
                      {formatMoney(creditUtilization.debt)}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {usesCredit ? (
                <div
                  className={`pos-customer-card__validation ${creditDue > selectedCustomer.available_credit
                      ? "is-fail"
                      : "is-ok"
                    }`}
                >
                  <i
                    className={`fa-solid ${creditDue > selectedCustomer.available_credit
                        ? "fa-triangle-exclamation"
                        : "fa-circle-check"
                      }`}
                    aria-hidden
                  />
                  <span>
                    {creditDue > selectedCustomer.available_credit
                      ? `Exceeds available credit by ${formatMoney(
                        creditDue - selectedCustomer.available_credit,
                      )}`
                      : `Credit approved for this sale (${formatMoney(creditDue)})`}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="pos-customer-pick">
            <label className="pos-label" htmlFor="pos-customer-select">
              Customer
              {creditNeedsCustomer ? " (required)" : ""}
            </label>
            <div className="pos-customer-pick__row">
              <select
                id="pos-customer-select"
                value={selectedCustomerId}
                onChange={(event) => applyCustomer(event.target.value)}
                aria-label="Customer"
                aria-required={creditNeedsCustomer}
                className={
                  creditNeedsCustomer && !selectedCustomerId
                    ? "pos-input--required"
                    : undefined
                }
              >
                <option value="">
                  {creditNeedsCustomer
                    ? customers.length > 0
                      ? "Select a customer…"
                      : "No customers saved yet"
                    : "Walk-in (optional)"}
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                id="pos-customer-add"
                className="pos-customer-pick__add"
                aria-label="Add new customer"
                aria-haspopup="dialog"
                aria-expanded={addCustomerOpen}
                title="Add new customer"
                onClick={() => setAddCustomerOpen(true)}
              >
                <i className="fa-solid fa-user-plus" aria-hidden />
              </button>
            </div>
          </div>
          {creditNeedsCustomer && customers.length === 0 ? (
            <p className="pos-customer-credit">
              Tap <i className="fa-solid fa-user-plus" aria-hidden /> to add a customer before
              selling on credit.
            </p>
          ) : null}
          {usesMpesa && !forceMpesaPrompt ? (
            <div
              className="pos-mpesa-mode-selector"
              role="radiogroup"
              aria-label="M-PESA checkout option"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mpesaAction === "record"}
                className={`pos-mpesa-mode-btn ${mpesaAction === "record" ? "is-active" : ""}`}
                onClick={() => setMpesaAction("record")}
              >
                <i className="fa-solid fa-receipt" aria-hidden="true" />
                <span>Record payment</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mpesaAction === "stk"}
                className={`pos-mpesa-mode-btn ${mpesaAction === "stk" ? "is-active" : ""}`}
                onClick={() => setMpesaAction("stk")}
              >
                <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
                <span>Send STK push</span>
              </button>
            </div>
          ) : null}

          {showWalkInPhone ? (
            <div className="pos-walkin-phone">
              <label className="pos-label" htmlFor="pos-walkin-phone-input">
                <i className="fa-solid fa-mobile-screen-button" aria-hidden />{" "}
                {usesMpesa
                  ? (forceMpesaPrompt || mpesaAction === "stk")
                    ? "M-PESA Phone (prompt recipient)"
                    : "Customer Phone (optional)"
                  : "Customer Phone"}
              </label>
              <input
                id="pos-walkin-phone-input"
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder={
                  usesMpesa
                    ? (forceMpesaPrompt || mpesaAction === "stk")
                      ? "2547… (required for M-PESA)"
                      : "2547… (optional)"
                    : "Phone (optional)"
                }
                aria-label={
                  usesMpesa ? "M-PESA phone" : "Customer phone"
                }
                aria-required={usesMpesa && (forceMpesaPrompt || mpesaAction === "stk")}
                className={
                  usesMpesa &&
                  (forceMpesaPrompt || mpesaAction === "stk") &&
                  !customerPhone.trim()
                    ? "pos-input--required"
                    : undefined
                }
              />
              {usesMpesa && !forceMpesaPrompt && mpesaAction === "stk" ? (
                <small className="pos-mpesa-stk-hint">
                  <i className="fa-solid fa-circle-info" aria-hidden="true" /> An STK push prompt of {formatMoney(mpesaDue)} will be sent to this phone.
                </small>
              ) : null}
            </div>
          ) : null}
          {usesMpesa && !forceMpesaPrompt && mpesaAction === "record" ? (
            <div className="pos-walkin-phone">
              <label className="pos-label" htmlFor="pos-mpesa-receipt-code">
                <i className="fa-solid fa-receipt" aria-hidden /> M-PESA receipt code (optional)
              </label>
              <input
                id="pos-mpesa-receipt-code"
                type="text"
                autoComplete="off"
                value={mpesaReceiptCode}
                onChange={(e) => setMpesaReceiptCode(e.target.value)}
                placeholder="Enter code from customer's SMS"
                aria-label="M-PESA receipt code"
              />
              <small>
                Confirm receipt of {formatMoney(mpesaDue)}. Add the SMS code if
                available.
              </small>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  async function completePaidPickup(orderId: string): Promise<Order> {
    const ready = await apiFetch<OrderMutationResponse>(
      apiRoutes.orderTransition(orderId),
      {
        method: "POST",
        body: JSON.stringify({
          to_status: "ready",
          note: "Counter sale completed at station.",
        }),
      },
    );
    const handedOff = await apiFetch<OrderMutationResponse>(
      apiRoutes.orderConfirmHandoff(orderId),
      { method: "POST" },
    );
    return handedOff.data.items?.length
      ? handedOff.data
      : { ...ready.data, ...handedOff.data, items: ready.data.items };
  }

  useEffect(() => {
    if (!completeInPlace || !receiptOrder || !printAfterSaleRef.current) return;
    printAfterSaleRef.current = false;
    const timer = window.setTimeout(() => {
      window.print();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [completeInPlace, receiptOrder]);

  const pendingMpesaId = pendingMpesa?.order.id ?? null;
  const pendingMpesaPaid = pendingMpesa
    ? orderHasSuccessfulMpesa(pendingMpesa.order)
    : false;

  useEffect(() => {
    if (!isTransChapSale || !pendingMpesaId || pendingMpesaPaid) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(pendingMpesaId));
        if (cancelled) return;
        const paid = orderHasSuccessfulMpesa(data.data);
        setPendingMpesa((current) => {
          if (!current || current.order.id !== pendingMpesaId) return current;
          return { ...current, order: data.data };
        });
        if (paid && paidPrintIdRef.current !== data.data.id) {
          paidPrintIdRef.current = data.data.id;
          setReceiptOrder(data.data);
          printAfterSaleRef.current = autoPrintReceipt;
          void toastSuccess("M-PESA payment received");
        }
      } catch {
        /* keep the waiting prompt so the cashier can resend */
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), MPESA_POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [autoPrintReceipt, isTransChapSale, pendingMpesaId, pendingMpesaPaid]);

  const canCompleteSaleNow =
    completeInPlace &&
    (isTransChapSale || fulfillment === "pickup" || fulfillment === "dine_in") &&
    completesImmediately;

  const paymentOptions = isTransChapSale
    ? TRANSCHAP_PAYMENT_METHODS
    : ALL_PAYMENT_METHODS;

  const splitIncomplete =
    isSplit && (new Set(splitParts.map((p) => p.method)).size < 2 || splitRemaining !== 0);

  const hasPriceBelowBuyingPrice = cart.some((line) => {
    const lineKey = line.lineId || line.inventoryItemId;
    const stockItem = itemsById.get(line.inventoryItemId);
    return isLinePriceBelowBuying(line, stockItem, priceDrafts[lineKey]);
  });

  const belowBuyingItem = hasPriceBelowBuyingPrice
    ? cart.find((line) => {
        const lineKey = line.lineId || line.inventoryItemId;
        const stockItem = itemsById.get(line.inventoryItemId);
        return isLinePriceBelowBuying(line, stockItem, priceDrafts[lineKey]);
      })
    : null;

  const placeDisabled =
    cart.length === 0 ||
    submitting ||
    splitIncomplete ||
    hasPriceBelowBuyingPrice ||
    (isTransChapSale &&
      usesMpesa &&
      !operationsSettingsLoaded) ||
    (isTransChapSale &&
      !isRestaurant &&
      (paymentMethod === "" ||
        !TRANSCHAP_PAYMENT_METHODS.includes(paymentMethod)));

  const isStkActive = forceMpesaPrompt || (usesMpesa && mpesaAction === "stk");

  const placeLabel = (() => {
    if (
      isTransChapSale &&
      usesMpesa &&
      !operationsSettingsLoaded &&
      !operationsSettingsError
    ) {
      return "Loading payment settings…";
    }
    if (submitting) {
      if (isTransChapSale) {
        if (isRestaurant && paymentMethod === "") return "Sending to kitchen…";
        if (usesMpesa) {
          return isStkActive ? "Sending M-Pesa…" : "Recording M-Pesa…";
        }
        if (isSplit) return "Completing split sale…";
        if (paymentMethod === "credit") return "Saving on credit…";
        return "Completing cash sale…";
      }
      return canCompleteSaleNow ? "Completing…" : "Placing order…";
    }
    if (splitIncomplete) {
      return splitRemaining > 0
        ? `Allocate ${formatMoney(splitRemaining)} more`
        : splitRemaining < 0
          ? `Over by ${formatMoney(-splitRemaining)}`
          : "Use at least two methods";
    }
    if (hasPriceBelowBuyingPrice) {
      return belowBuyingItem
        ? `Price below buying (${belowBuyingItem.name})`
        : "Price below buying price";
    }
    if (isTransChapSale) {
      if (isRestaurant && paymentMethod === "") {
        return tableNumber.trim()
          ? `Send to kitchen (${tableNumber.trim()})`
          : "Send to kitchen (Table order)";
      }
      if (usesMpesa) {
        const amount = isSplit ? ` (${formatMoney(mpesaDue)})` : "";
        return isStkActive
          ? `Send M-Pesa prompt${amount}`
          : `Record M-Pesa payment${amount}`;
      }
      if (isSplit) return "Complete split sale";
      if (paymentMethod === "credit") return "Save on credit";
      return "Complete cash sale";
    }
    return canCompleteSaleNow ? "Complete order" : "Place order";
  })();

  async function handleActionPlace(action: "record" | "stk") {
    if (action === "stk") {
      setMpesaAction("stk");
      if (!customerPhone.trim()) {
        const phoneInput = (document.getElementById("pos-walkin-phone-input") ||
          document.getElementById("pos-customer-stk-phone")) as HTMLInputElement | null;
        if (phoneInput) {
          phoneInput.focus();
        }
        await showError(
          "Customer phone required",
          "Enter the customer's M-PESA phone number so we can send them the payment prompt.",
        );
        return;
      }
      await placeOrder({ sendStkPush: true });
    } else {
      setMpesaAction("record");
      await placeOrder({ sendStkPush: false });
    }
  }

  async function placeOrder(opts?: { sendStkPush?: boolean }) {
    if (cart.length === 0) return;
    const isStk =
      opts?.sendStkPush !== undefined
        ? opts.sendStkPush
        : (forceMpesaPrompt || (usesMpesa && mpesaAction === "stk"));

    if (hasPriceBelowBuyingPrice) {
      const stockItem = belowBuyingItem
        ? itemsById.get(belowBuyingItem.inventoryItemId)
        : null;
      const buyingPrice = belowBuyingItem
        ? getLineBuyingPrice(belowBuyingItem, stockItem)
        : null;
      await showError(
        "Selling price below buying price",
        belowBuyingItem && buyingPrice !== null
          ? `The selling price for "${belowBuyingItem.name}" (${formatMoney(belowBuyingItem.unit_price)}) cannot be less than its buying price (${formatMoney(buyingPrice)}). Adjust the selling price to proceed.`
          : "One or more items have a selling price lower than the buying price. Adjust the price before completing this sale.",
      );
      return;
    }
    const orderSource = isTransChapSale ? "walkin" : source;
    const orderFulfillment = isTransChapSale
      ? isRestaurant
        ? fulfillment
        : "pickup"
      : fulfillment;
    if (
      isTransChapSale &&
      !isRestaurant &&
      (paymentMethod === "" ||
        !TRANSCHAP_PAYMENT_METHODS.includes(paymentMethod))
    ) {
      await showError(
        "Choose how they pay",
        "Pick cash sale, M-Pesa, credit, or split before completing this sale.",
      );
      return;
    }
    if (splitIncomplete) {
      await showError(
        "Finish the split payment",
        new Set(splitParts.map((p) => p.method)).size < 2
          ? "Enter amounts for at least two different payment methods."
          : `The split adds up to ${formatMoney(splitAllocated)} but the total is ${formatMoney(total)}.`,
      );
      return;
    }
    if (orderFulfillment === "delivery" && !deliveryAddress.trim()) {
      await showError(
        "Delivery address required",
        "Add a delivery address before placing this order.",
      );
      return;
    }
    if (orderFulfillment === "delivery" && mapEnabled && !deliveryCoords) {
      await showError(
        "Pin the delivery address",
        "Pick a suggestion from the search results or use Pin on map so the address is resolved accurately.",
      );
      return;
    }
    if (usesMpesa && isStk && !customerPhone.trim()) {
      await showError(
        "Customer phone required",
        "Enter the customer's M-PESA phone number so we can send them the payment prompt.",
      );
      return;
    }
    if (usesCredit && !selectedCustomerId) {
      await showError(
        "Customer required",
        customers.length > 0
          ? "Pick a saved customer so we can put this sale on their tab."
          : "Add a customer under Customers before selling on credit.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const payload: OrderCreatePayload = {
        source: orderSource,
        fulfillment_type: orderFulfillment,
        table_number:
          orderFulfillment === "dine_in"
            ? (tableNumber.trim() || "Table 1")
            : (tableNumber.trim() || null),
        customer_id: selectedCustomerId || null,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        delivery_address: orderFulfillment === "delivery" ? deliveryAddress.trim() || null : null,
        delivery_notes: orderFulfillment === "delivery" ? deliveryNotes.trim() || null : null,
        payment_method: paymentMethod || null,
        payments: isSplit ? splitParts : undefined,
        send_mpesa_stk_push: usesMpesa ? isStk : undefined,
        mpesa_receipt_number:
          usesMpesa && !isStk
            ? mpesaReceiptCode.trim() || undefined
            : undefined,
        date_to_pay: usesCredit ? creditDueDate.trim() || null : null,
        delivery_fee: orderFulfillment === "delivery" ? deliveryFeeNum : 0,
        tax: taxAmount,
        discount: discountNum,
        notes: notes.trim() || null,
        items: cart.map((c) => ({
          inventory_item_id: c.inventoryItemId,
          quantity: c.quantity,
          unit_price: c.unit_price,
          sell_unit: c.sellUnit,
          unit_factor:
            c.sellUnit ? c.unitFactor : undefined,
          ...(c.optionIds
            ? {
                modifier_option_ids: c.optionIds,
                modifiers: (c.modifiers ?? []).filter((m) => !m.option_id),
              }
            : { modifiers: c.modifiers && c.modifiers.length ? c.modifiers : null }),
          notes: c.notes?.trim() || null,
        })),
      };
      const data = await apiFetch<OrderMutationResponse>(apiRoutes.orders, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      let order = data.data;
      const willCompleteNow =
        completeInPlace &&
        (orderFulfillment === "pickup" || orderFulfillment === "dine_in") &&
        completesImmediately;

      if (willCompleteNow) {
        try {
          order = await completePaidPickup(order.id);
        } catch (completeErr) {
          await showError(
            `Order ${data.data.order_number} placed, but could not mark it complete`,
            extractErrorMessage(completeErr),
          );
        }
      }

      // M-PESA: surface the STK push outcome separately so the cashier
      // knows whether the customer received the prompt. The order itself
      // is always saved, even if the push failed. Trans Chap POS keeps a
      // waiting panel so they can send the prompt again without leaving.
      const push = data.mpesa_push ?? null;
      if (isTransChapSale && usesMpesa) {
        suppressMerchantOrderNotification(order.id);
        clearCart();
        void reload({ silent: true, q: search });
        if (push?.status === "confirmed" || !isStk) {
          setReceiptOrder(order);
          printAfterSaleRef.current = autoPrintReceipt;
          paidPrintIdRef.current = order.id;
          setPendingMpesa(null);
          await toastSuccess("M-PESA payment recorded");
          return;
        }
        setPendingMpesa({ order, push });
        setReceiptOrder(order);
        printAfterSaleRef.current = false;
        paidPrintIdRef.current = null;
        if (push?.status === "sent") {
          await toastSuccess("M-PESA prompt sent");
        }
        return;
      }
      if (push && push.status === "sent") {
        await showSuccess(
          `Order ${order.order_number} · STK push sent`,
          push.message,
        );
      } else if (push && push.status !== "sent") {
        await showError(
          `Order ${order.order_number} placed, but M-PESA push didn't go through`,
          push.message,
        );
      } else if (willCompleteNow && order.status === "picked_up") {
        await toastSuccess(`Order ${order.order_number} completed`);
      } else if (isTransChapSale && isRestaurant && !paymentMethod) {
        await toastSuccess(
          `Order #${order.order_number} (${order.table_number || "Table"}) sent to kitchen (Unpaid)`,
        );
      } else {
        await toastSuccess(`Order ${order.order_number} placed`);
      }
      suppressMerchantOrderNotification(order.id);
      clearCart();
      void reload({ silent: true, q: search });

      if (completeInPlace) {
        setReceiptOrder(order);
        printAfterSaleRef.current = autoPrintReceipt;
        return;
      }

      router.push(
        autoPrintReceipt
          ? `/orders/${order.id}?print=1`
          : `/orders/${order.id}`,
      );
    } catch (err) {
      await showError("Could not place order", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function resendPendingMpesaPrompt() {
    if (!pendingMpesa) return;
    setMpesaBusy(true);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderMpesaStkPush(pendingMpesa.order.id),
        { method: "POST", body: "{}" },
      );
      setPendingMpesa({
        order: data.data,
        push: data.mpesa_push ?? null,
      });
      if (data.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent");
      } else {
        await showInternalError();
      }
    } catch {
      await showInternalError();
    } finally {
      setMpesaBusy(false);
    }
  }

  function dismissPendingMpesa() {
    setPendingMpesa(null);
    setMpesaBusy(false);
    setMobileScreen("catalog");
  }

  const pendingMpesaStatus = pendingMpesa
    ? paymentStatusFromOrder(pendingMpesa.order, pendingMpesa.push)
    : null;
  const pendingMpesaWaiting = pendingMpesaStatus === "pending";
  const pendingMpesaFailed = pendingMpesaStatus === "failed";

  return (
    <section className={`app-panel pos-panel${isTransChapSale && pendingMpesa ? " has-mpesa-wait" : ""}`}>
      {isTransChapSale && pendingMpesa ? (
        <div
          className={`pos-mpesa-wait${pendingMpesaPaid ? " is-paid" : pendingMpesaFailed ? " is-failed" : " is-waiting"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-mpesa-wait-title"
        >
          <div className="pos-mpesa-wait__card">
            <p className="pos-mpesa-wait__kicker">
              Order #{pendingMpesa.order.order_number}
            </p>
            <h2 id="pos-mpesa-wait-title" className="pos-mpesa-wait__title">
              {pendingMpesaPaid
                ? "Payment received"
                : pendingMpesaWaiting
                  ? "Waiting for M-PESA"
                  : "Payment not received"}
            </h2>
            <p className="pos-mpesa-wait__amount">
              {formatMoney(pendingMpesa.order.total, pendingMpesa.order.currency)}
            </p>
            <p className="pos-mpesa-wait__customer">
              {(pendingMpesa.order.customer_name ?? "Customer").trim()}
              {pendingMpesa.order.customer_phone
                ? ` · ${pendingMpesa.order.customer_phone}`
                : ""}
            </p>
            <p className="pos-mpesa-wait__copy">
              {pendingMpesaPaid
                ? "You can print the receipt or start the next sale."
                : pendingMpesaWaiting
                  ? pendingMpesa.push?.message ||
                  "Ask the customer to enter their PIN on the prompt."
                  : pendingMpesa.push && pendingMpesa.push.status !== "sent"
                    ? pendingMpesa.push.message
                    : "Payment was not received. Send the prompt again."}
            </p>
            <div className="pos-mpesa-wait__actions">
              {!pendingMpesaPaid ? (
                <button
                  type="button"
                  className="pos-mpesa-wait__retry"
                  onClick={() => void resendPendingMpesaPrompt()}
                  disabled={mpesaBusy}
                >
                  <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                  {mpesaBusy ? "Sending…" : "Send prompt again"}
                </button>
              ) : null}
              <button
                type="button"
                className="pos-mpesa-wait__next"
                onClick={dismissPendingMpesa}
                disabled={mpesaBusy}
              >
                Next sale
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={`pos-grid pos-grid--mobile-${mobileScreen}${
          isCartCollapsed ? " is-cart-collapsed" : ""
        }`}
      >
        {/* Mobile top navigation when viewing current order */}
        {mobileScreen === "order" ? (
          <div className="pos-mobile-order-nav">
            <button
              type="button"
              className="pos-mobile-order-nav__back"
              onClick={() => {
                setMobileScreen("catalog");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <i className="fa-solid fa-arrow-left" aria-hidden="true" />
              <span>Back to products</span>
            </button>
            <div className="pos-mobile-order-nav__meta">
              <span className="pos-mobile-order-nav__count">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
              <span className="pos-mobile-order-nav__total">
                {formatMoney(total)}
              </span>
            </div>
          </div>
        ) : null}

        {/* ── Main: catalog + ticket ─────────────────────────────── */}
        <div className="pos-main">
          <div className="pos-catalog">
            <header className="pos-catalog__head">
              <h1 className="pos-title">
                <i
                  className={
                    isTransChapSale
                      ? "fa-solid fa-utensils pos-title__icon"
                      : "fa-solid fa-cash-register pos-title__icon"
                  }
                  aria-hidden="true"
                />
                {isTransChapSale ? "Select products" : "Point of sale"}
              </h1>
              <div className="pos-catalog__tools">
                <label className="pos-quick-qty" title="Units added per product tap or scan">
                  <span className="pos-quick-qty__label">Qty</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={quickAddQty}
                    onChange={(e) => handleQuickAddQtyChange(e.target.value)}
                    aria-label="Quantity per tap"
                  />
                </label>
                <div className="pos-quick-qty__presets" role="group" aria-label="Quick quantity presets">
                  {[1, 5, 10].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`pos-quick-qty__preset${quickAddQty === preset ? " is-active" : ""}`}
                      onClick={() => handleQuickAddQtyChange(String(preset))}
                      aria-pressed={quickAddQty === preset}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <label className={`pos-search${catalogPending ? " is-searching" : ""}`}>
                  <i
                    className="fa-solid fa-magnifying-glass pos-search__icon"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    placeholder="Search inventory or scan barcode…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                    aria-busy={catalogPending}
                  />
                  {search ? (
                    <button
                      type="button"
                      className="pos-search__clear"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
              </div>
            </header>

            {availableCategories.length > 1 ? (
              <div
                className="pos-category-chips"
                role="tablist"
                aria-label="Filter products by category"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory === "all"}
                  className={`pos-category-chip${selectedCategory === "all" ? " is-active" : ""}`}
                  onClick={() => setSelectedCategory("all")}
                >
                  <i className="fa-solid fa-layer-group" aria-hidden="true" />
                  <span>All ({catalogItems.length})</span>
                </button>
                {availableCategories.map((cat) => {
                  const count = catalogItems.filter(
                    (i) => (i.product?.category || "").trim().toLowerCase() === cat.toLowerCase(),
                  ).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={selectedCategory.toLowerCase() === cat.toLowerCase()}
                      className={`pos-category-chip${selectedCategory.toLowerCase() === cat.toLowerCase() ? " is-active" : ""}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      <span>{formatCategoryLabel(cat)}</span>
                      <span className="pos-category-chip__count">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {error ? <p className="app-error">{error}</p> : null}

            <AnimatePresence mode="wait">
              {catalogPending ? (
                <CatalogSkeleton key="pos-catalog-skeleton" />
              ) : filteredItems.length === 0 ? (
                <motion.div
                  key="pos-catalog-empty"
                  className="pos-empty"
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6 }}
                  transition={{
                    duration: motionDuration.micro,
                    ease: easeOutExpressive,
                  }}
                >
                  <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
                  <h3>
                    {catalogItems.length === 0 && !search.trim()
                      ? isRestaurant
                        ? "No menu dishes yet"
                        : "Inventory is empty"
                      : "No items match your filters"}
                  </h3>
                  <p>
                    {catalogItems.length === 0 && !search.trim()
                      ? isRestaurant
                        ? "Add dishes in the Menu and they'll appear here for one-tap selling."
                        : "Add products in Inventory and they'll appear here for one-tap selling."
                      : "Try a different search."}
                  </p>
                </motion.div>
              ) : (
                <motion.ul
                  key={`pos-catalog-${loadedQuery}`}
                  className="pos-cards"
                  variants={reduce ? undefined : staggerContainer}
                  initial={reduce ? false : "hidden"}
                  animate={reduce ? undefined : "visible"}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={{ duration: motionDuration.micro }}
                >
                  {visibleItems.map((item) => {
                    const coverUrl =
                      inventoryCoverUrl(item) || item.product?.image_url || null;
                    const itemCartLines = cart.filter(
                      (line) => line.inventoryItemId === item.id,
                    );
                    const inCartQty = itemCartLines.reduce(
                      (sum, line) => sum + line.quantity,
                      0,
                    );
                    const inCartStockQty = itemCartLines.reduce(
                      (sum, line) => sum + stockUnitsForCartLine(line),
                      0,
                    );
                    const cartUnitFactor = Math.max(
                      0.0001,
                      itemCartLines[0]?.unitFactor ?? 1,
                    );
                    const heldQty = heldQtyByItemId.get(item.id) ?? 0;
                    const isPulsing = pulseId === item.id;
                    const isHotelDish = isHotelMenuItem(item);
                    const hasOptions = isHotelDish && itemModifierGroups(item).length > 0;
                    const subtitleParts = [
                      item.product?.category ? formatCategoryLabel(item.product.category) : null,
                      item.product?.brand,
                    ].filter(Boolean) as string[];
                    const subtitle = subtitleParts.join(" · ");
                    const hasPrice = item.selling_price !== null;
                    const outOfStock = isOutOfStock(item);
                    const paused = !item.is_active;
                    const blockedBy = isHotelDish && !paused ? mealBlockedBy(item, optionAvailability) : null;
                    const canAdd =
                      (hasPrice || canEditPrice) && !outOfStock && !paused && !blockedBy;
                    const stockCap = maxCartQty(item);
                    const effectiveCap =
                      stockCap === null ? null : Math.max(0, stockCap - heldQty);
                    const effectiveLineCap =
                      effectiveCap === null
                        ? null
                        : Math.floor(effectiveCap / cartUnitFactor);
                    const atStockCap =
                      effectiveCap !== null && inCartStockQty >= effectiveCap;
                    const availableQty = availableToSell(
                      item,
                      inCartStockQty + heldQty,
                    );
                    const stockIsLow =
                      !outOfStock &&
                      (item.is_low_stock ||
                        (availableQty !== null &&
                          item.low_stock_threshold != null &&
                          availableQty <= item.low_stock_threshold));
                    return (
                      <motion.li
                        key={item.id}
                        variants={reduce ? undefined : staggerItem}
                        animate={
                          isPulsing && !reduce
                            ? { scale: [1, 1.025, 1] }
                            : { scale: 1 }
                        }
                        transition={{
                          duration: motionDuration.base,
                          ease: easeOutExpressive,
                        }}
                        className={`pos-card${inCartQty > 0 ? " is-in-cart" : ""}${!canAdd ? " is-disabled" : ""}${paused ? " is-paused" : ""}`}
                      >
                        <div className="pos-card__hit">
                          <button
                            type="button"
                            className="pos-card__main"
                            onClick={() => (isHotelDish ? tapMenuItem(item) : addToCart(item))}
                            aria-label={`Add ${quickAddQty > 1 ? `${quickAddQty} of ` : ""}${item.product?.name ?? "item"} to order`}
                            disabled={!canAdd}
                          >
                            <div className="pos-card__thumb" aria-hidden="true">
                              <span className="pos-card__thumb-fallback">
                                {isHotelDish ? (
                                  <i className="fa-solid fa-utensils" aria-hidden="true" />
                                ) : (
                                  nameInitial(item.product?.name)
                                )}
                              </span>
                              {coverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={resolveAssetUrl(coverUrl)}
                                  alt=""
                                  loading="lazy"
                                  onError={(event) => {
                                    event.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : null}
                              {inCartQty > 0 ? (
                                <span className="pos-card__in-cart-badge">
                                  <i className="fa-solid fa-check" aria-hidden="true" /> {inCartQty}
                                </span>
                              ) : null}
                            </div>

                            <div className="pos-card__info">
                              {isHotelDish ? (
                                <span className="pos-card__dish-tag">
                                  <i className="fa-solid fa-burger" aria-hidden="true" /> Meal
                                  {typeof (item.attributes as Record<string, unknown> | null)?.prep_time_minutes === "number" ? (
                                    <> &middot; ⏱️ {String((item.attributes as Record<string, unknown>).prep_time_minutes)}m</>
                                  ) : null}
                                </span>
                              ) : null}
                              <span className="pos-card__name">
                                {item.product?.name ?? `Item #${item.product_id}`}
                              </span>
                              {subtitle ? (
                                <span className="pos-card__subtitle">
                                  {subtitle}
                                </span>
                              ) : null}
                              <span className="pos-card__price">
                                {outOfStock ? (
                                  <span className="pos-card__price-unset">
                                    Out of stock
                                  </span>
                                ) : hasPrice && item.selling_price !== null ? (
                                  <>
                                    <span className="pos-card__price-amount">
                                      {formatMoney(item.selling_price)}
                                    </span>
                                    {item.product?.unit ? (
                                      <span className="pos-card__price-unit">
                                        /{item.product.unit}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="pos-card__price-unset">
                                    No price set
                                  </span>
                                )}
                              </span>
                              {paused ? (
                                <span className="pos-card__stock is-paused">
                                  <i className="fa-solid fa-pause" aria-hidden="true" /> Paused
                                </span>
                              ) : blockedBy ? (
                                <span className="pos-card__stock is-out">No {blockedBy.name} left</span>
                              ) : isServiceItem(item) ? (
                                <span className="pos-card__stock">Service</span>
                              ) : isHotelDish && item.stock_quantity == null ? (
                                <span className="pos-card__stock is-fresh">
                                  <i className="fa-solid fa-kitchen-set" aria-hidden="true" /> Made to order
                                </span>
                              ) : outOfStock ? (
                                <span className="pos-card__stock is-out">
                                  {item.stock_quantity == null
                                    ? "Stock not set"
                                    : `${item.stock_quantity} on hand`}
                                </span>
                              ) : availableQty !== null ? (
                                <span
                                  className={`pos-card__stock${stockIsLow ? " is-low" : ""}`}
                                >
                                  {`${availableQty} available`}
                                  {inCartQty > 0
                                    ? ` · ${inCartStockQty} in order`
                                    : ""}
                                </span>
                              ) : null}
                            </div>
                          </button>

                          <div className="pos-card__action">
                            {inCartQty > 0 ? (
                              <div
                                className="pos-card__qty"
                                role="group"
                                aria-label={`Quantity of ${item.product?.name ?? "item"} in order`}
                              >
                                <button
                                  type="button"
                                  aria-label="Decrease quantity"
                                  onClick={() =>
                                    changeQuantity(item.id, -1)
                                  }
                                >
                                  <i
                                    className="fa-solid fa-minus"
                                    aria-hidden="true"
                                  />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={effectiveLineCap ?? undefined}
                                  value={inCartQty}
                                  onChange={(e) =>
                                    setQuantity(item.id, e.target.value)
                                  }
                                  aria-label={`Quantity of ${item.product?.name ?? "item"}`}
                                />
                                <button
                                  type="button"
                                  aria-label="Increase quantity"
                                  disabled={atStockCap}
                                  onClick={() =>
                                    isHotelDish
                                      ? tapMenuItem(item)
                                      : changeQuantity(item.id, 1)
                                  }
                                >
                                  <i
                                    className="fa-solid fa-plus"
                                    aria-hidden="true"
                                  />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="pos-card__add"
                                onClick={() => (isHotelDish ? tapMenuItem(item) : addToCart(item))}
                                disabled={!canAdd}
                                aria-label={`Add ${quickAddQty > 1 ? `${quickAddQty} of ` : ""}${item.product?.name ?? "item"} to order`}
                              >
                                <i className={hasOptions ? "fa-solid fa-sliders" : "fa-solid fa-plus"} aria-hidden="true" />
                                <span className="pos-card__add-label">{hasOptions ? "Options" : "Add"}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                  {posHasMore && (
                    <li
                      ref={posSentinelRef}
                      style={{
                        gridColumn: "1 / -1",
                        listStyle: "none",
                        padding: "1rem 0.5rem",
                        textAlign: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setPosVisibleCount((prev) =>
                            Math.min(prev + POS_PAGE_SIZE, filteredItems.length),
                          )
                        }
                        style={{
                          background: "var(--app-surface)",
                          border: "1px solid var(--app-border-light)",
                          borderRadius: "999px",
                          padding: "0.5rem 1.25rem",
                          fontSize: "0.85rem",
                          fontWeight: 650,
                          color: "var(--app-text-secondary)",
                          cursor: "pointer",
                        }}
                      >
                        Showing {visibleItems.length} of {filteredItems.length} · Scroll for more
                      </button>
                    </li>
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>

          <section
            className={`pos-ticket${cart.length ? " has-lines" : ""}`}
            aria-label="Order items"
          >
            {cart.length > 0 ? (
              <div className="pos-cart__lines pos-ticket__lines">
                <ul>
                  <AnimatePresence initial={false}>
                    {cart.map((line) => {
                      const lineKey = line.lineId || line.inventoryItemId;
                      const lineTotal = line.unit_price * line.quantity;
                      const stockItem = itemsById.get(line.inventoryItemId);
                      const lineBuyingPrice = getLineBuyingPrice(line, stockItem);
                      const isBelowBuying = isLinePriceBelowBuying(
                        line,
                        stockItem,
                        priceDrafts[lineKey],
                      );
                      const fractionalUnits = fractionalSellUnits(stockItem);
                      const isHotelDish = stockItem ? isHotelMenuItem(stockItem) : false;
                      const stockCap = stockItem ? maxCartQty(stockItem) : null;
                      const heldQty = heldQtyByItemId.get(line.inventoryItemId) ?? 0;
                      const effectiveCap =
                        stockCap === null ? null : Math.max(0, stockCap - heldQty);
                      const effectiveLineCap =
                        effectiveCap === null
                          ? null
                          : Math.floor(
                              effectiveCap /
                                Math.max(0.0001, line.unitFactor ?? 1),
                            );
                      const atStockCap =
                        effectiveLineCap !== null &&
                        line.quantity >= effectiveLineCap;
                      const optionPriced = line.optionIds != null;
                      const showLinePriceEdit =
                        canEditPrice && !isTransChapSale && !optionPriced;
                      return (
                        <motion.li
                          key={lineKey}
                          layout={!reduce}
                          initial={
                            reduce ? false : { opacity: 0, y: 6, scale: 0.98 }
                          }
                          animate={
                            reduce
                              ? undefined
                              : { opacity: 1, y: 0, scale: 1 }
                          }
                          exit={
                            reduce
                              ? undefined
                              : { opacity: 0, scale: 0.96, x: 8 }
                          }
                          transition={springSoft}
                          className={`pos-line${showLinePriceEdit ? " pos-line--priced" : ""
                            }${isTransChapSale ? " pos-line--simple" : ""}`}
                        >
                          {!isTransChapSale ? (
                            <div className="pos-line__thumb" aria-hidden="true">
                              {line.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={resolveAssetUrl(line.image_url)}
                                  alt=""
                                />
                              ) : (
                                <span>{nameInitial(line.name)}</span>
                              )}
                            </div>
                          ) : null}
                          <div className="pos-line__main">
                            <div className="pos-line__title-row">
                              <strong title={line.name}>{line.name}</strong>
                              {isTransChapSale &&
                              line.sellUnit === "Bulk" &&
                              line.bulkFactor &&
                              line.bulkFactor > 1 ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="pos-line__bulk-factor"
                                  value={bulkFactorDrafts[lineKey] ?? String(line.bulkFactor)}
                                  onChange={(event) =>
                                    handleBulkFactorInput(lineKey, event.target.value)
                                  }
                                  onBlur={() => finishBulkFactorInput(lineKey)}
                                  aria-label={`Units per bulk for ${line.name}`}
                                  title="Units per bulk"
                                />
                              ) : null}
                            </div>
                            {isTransChapSale && isBelowBuying && lineBuyingPrice !== null ? (
                              <div className="pos-line__price-alert" role="alert">
                                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                                <span>Selling price cannot be less than buying price ({formatMoney(lineBuyingPrice)})</span>
                              </div>
                            ) : null}
                            {line.modifiers && line.modifiers.length > 0 ? (
                              <div className="pos-cart__line-mods">
                                {line.modifiers.map((m, mIdx) => (
                                  <span key={mIdx} className="pos-cart__mod-chip">
                                    + {m.name} {m.price > 0 ? `(+${formatMoney(m.price)})` : ""}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {line.notes ? (
                              <div className="pos-cart__mod-note">Note: {line.notes}</div>
                            ) : null}
                            {isHotelDish || (stockItem && isHotelMenuItem(stockItem)) ? (
                              <button
                                type="button"
                                className="pos-cart__customize-btn"
                                onClick={() => {
                                  if (stockItem) {
                                    setModifyingItem({
                                      item: stockItem,
                                      cartLineId: lineKey,
                                      initialOptionIds: line.optionIds,
                                      initialModifiers: line.modifiers,
                                      initialNotes: line.notes,
                                    });
                                  }
                                }}
                              >
                                <i className="fa-solid fa-sliders" aria-hidden="true" />
                                {line.modifiers?.length || line.notes ? "Edit choices" : "Customize"}
                              </button>
                            ) : null}
                            {!showLinePriceEdit && !isTransChapSale ? (
                              <span>
                                {formatMoney(line.unit_price)} ea
                                {optionPriced && canEditPrice ? " · Set by options" : ""}
                              </span>
                            ) : null}
                            {isTransChapSale && optionPriced ? (
                              <div className="pos-cart__mod-note">Price set by options</div>
                            ) : null}
                            {stockItem &&
                              !isServiceItem(stockItem) &&
                              !isTransChapSale ? (
                              <span className="pos-line__stock">
                                {stockItem.stock_quantity == null
                                  ? "Stock not set"
                                  : effectiveCap !== null
                                    ? `${Math.max(0, effectiveCap - line.quantity)} of ${effectiveCap} left`
                                    : null}
                              </span>
                            ) : null}
                          </div>
                          {showLinePriceEdit ? (
                            <div className="pos-line__price-block">
                              <label className={`pos-line__price-edit${isBelowBuying ? " has-error" : ""}`}>
                                <span className="pos-line__price-label">Price</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={line.unit_price}
                                  onChange={(e) =>
                                    setUnitPrice(
                                      lineKey,
                                      e.target.value,
                                    )
                                  }
                                  aria-label={`Unit price for ${line.name}`}
                                />
                              </label>
                              {isBelowBuying && lineBuyingPrice !== null ? (
                                <div className="pos-line__price-alert" role="alert">
                                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                                  <span>Price cannot be less than buying price ({formatMoney(lineBuyingPrice)})</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="pos-line__qty-wrap">
                            {fractionalUnits.length > 0 ? (
                              <div className="pos-line__unit-toggle">
                                {fractionalUnits.map((unit) => (
                                  <button
                                    key={unit.name}
                                    type="button"
                                    className={
                                      line.sellUnit === unit.name ||
                                      (unit.factor === 1 &&
                                        !line.sellUnit &&
                                        line.unitFactor === 1)
                                        ? "is-active"
                                        : ""
                                    }
                                    onClick={() =>
                                      updateLineUnit(
                                        lineKey,
                                        unit.name,
                                        unit.factor,
                                      )
                                    }
                                    title={`${unit.name} · ${formatMoney(
                                      (line.base_price ?? line.unit_price) *
                                        unit.factor,
                                    )}`}
                                  >
                                    {unit.factor === 1
                                      ? "Full"
                                      : unit.name.split(" ")[0]}
                                  </button>
                                ))}
                              </div>
                            ) : isTransChapSale || line.autoPackFactor !== undefined ? (
                              <div className="pos-line__unit-toggle">
                                <button
                                  type="button"
                                  className={!line.sellUnit || line.unitFactor === 1 ? "is-active" : ""}
                                  onClick={() => {
                                    finishBulkFactorInput(lineKey);
                                    updateLineUnit(lineKey, null, 1);
                                  }}
                                >
                                  Single
                                </button>
                                <button
                                  type="button"
                                  className={line.sellUnit === "Bulk" ? "is-active" : ""}
                                  onClick={() =>
                                    updateLineUnit(
                                      lineKey,
                                      "Bulk",
                                      line.bulkFactor ?? line.autoPackFactor ?? 2,
                                    )
                                  }
                                  title={`Units per bulk: ${line.bulkFactor ?? line.autoPackFactor ?? 2}`}
                                >
                                  Bulk
                                </button>
                              </div>
                            ) : null}
                            <div className="pos-line__qty">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                onClick={() =>
                                  changeQuantity(lineKey, -1)
                                }
                              >
                                <i
                                  className="fa-solid fa-minus"
                                  aria-hidden="true"
                                />
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={effectiveLineCap ?? undefined}
                                value={line.quantity}
                                onChange={(e) =>
                                  setQuantity(
                                    lineKey,
                                    e.target.value,
                                  )
                                }
                                aria-label={`Quantity of ${line.name}`}
                              />
                              <button
                                type="button"
                                aria-label="Increase quantity"
                                disabled={atStockCap}
                                onClick={() =>
                                  changeQuantity(lineKey, 1)
                                }
                              >
                                <i
                                  className="fa-solid fa-plus"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </div>
                          <div className="pos-line__total">
                            {isTransChapSale && optionPriced ? (
                              <input
                                type="text"
                                className="pos-line__bulk-price"
                                value={Number.isFinite(line.unit_price) ? String(line.unit_price) : ""}
                                readOnly
                                aria-label={`Price for ${line.name}, set by options`}
                                title="Set by options"
                              />
                            ) : isTransChapSale ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                className={`pos-line__bulk-price${isBelowBuying ? " has-error" : ""}`}
                                value={
                                  priceDrafts[lineKey] ??
                                  (Number.isFinite(line.unit_price)
                                    ? String(line.unit_price)
                                    : "")
                                }
                                onChange={(event) =>
                                  handleLinePriceInput(lineKey, event.target.value)
                                }
                                onBlur={() => finishLinePriceInput(lineKey)}
                                aria-label={
                                  line.sellUnit === "Bulk"
                                    ? `Bulk price for ${line.name}`
                                    : `Selling price for ${line.name}`
                                }
                                title={
                                  line.sellUnit === "Bulk"
                                    ? "Bulk price"
                                    : "Selling price"
                                }
                              />
                            ) : null}
                            {!isTransChapSale &&
                            line.sellUnit === "Bulk" &&
                            line.bulkFactor &&
                            line.bulkFactor > 1 ? (
                              <input
                                type="number"
                                min={2}
                                max={1_000_000}
                                step={1}
                                className="pos-line__bulk-factor"
                                value={line.bulkFactor}
                                onChange={(event) =>
                                  updateLineBulkFactor(lineKey, event.target.value)
                                }
                                aria-label={`Units per bulk for ${line.name}`}
                                title="Units per bulk"
                              />
                            ) : null}
                            <strong>{formatMoney(lineTotal)}</strong>
                            <button
                              type="button"
                              className="pos-line__remove"
                              aria-label={`Remove ${line.name}`}
                              onClick={() =>
                                removeLine(lineKey)
                              }
                            >
                              <i
                                className="fa-solid fa-trash"
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </div>
            ) : (
              <div className="pos-ticket__empty">
                <div className="pos-ticket__empty-icon">
                  <i className="fa-solid fa-receipt" aria-hidden="true" />
                </div>
                <h3>No items in order</h3>
                <p>Tap products from the catalog to add them to this order.</p>
                <button
                  type="button"
                  className="pos-ticket__empty-btn"
                  onClick={() => {
                    setMobileScreen("catalog");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                  <span>Select products</span>
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ── Cart (right) — order meta only ─────────────────────── */}
        <aside
          className={`pos-cart pos-cart--meta${
            isCartCollapsed ? " pos-cart--collapsed" : ""
          }`}
          aria-label="Current order"
        >
          {isCartCollapsed ? (
            <div
              className="pos-cart__collapsed-bar"
              onClick={toggleCartCollapsed}
              title="Expand order details (Click to open)"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCartCollapsed();
                }
              }}
            >
              <button
                type="button"
                className="pos-cart__expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCartCollapsed();
                }}
                aria-label="Expand order details"
                title="Expand order details"
              >
                <i
                  className="fa-solid fa-angles-left pos-cart__expand-icon-desktop"
                  aria-hidden="true"
                />
                <i
                  className="fa-solid fa-angles-down pos-cart__expand-icon-mobile"
                  aria-hidden="true"
                />
              </button>

              <div className="pos-cart__collapsed-meta">
                <div className="pos-cart__collapsed-icon">
                  <i className="fa-solid fa-receipt" aria-hidden="true" />
                </div>
                <span className="pos-cart__count">
                  {itemCount === 0 ? "0" : `${itemCount}`}
                </span>
              </div>

              <div className="pos-cart__collapsed-label">
                <span>Current order</span>
              </div>

              {total > 0 ? (
                <div
                  className="pos-cart__collapsed-amount"
                  title={formatMoney(total)}
                >
                  <span>{formatMoney(total)}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <header className="pos-cart__head">
                <h2>
                  <i className="fa-solid fa-receipt" aria-hidden="true" />
                  Current order
                  <span className="pos-cart__count">
                    {itemCount === 0 ? "empty" : `${itemCount}`}
                  </span>
                </h2>
                <div className="pos-cart__actions">
                  {cart.length > 0 ? (
                    <button
                      type="button"
                      className="pos-cart__hold"
                      onClick={() => void holdCurrentSale()}
                      title="Hold this sale and start a new one"
                      disabled={submitting || Boolean(pendingMpesa)}
                    >
                      <i className="fa-solid fa-pause" aria-hidden="true" />
                      Hold
                    </button>
                  ) : null}
                  {cart.length > 0 ? (
                    <button
                      type="button"
                      className="pos-cart__reset"
                      onClick={clearCart}
                      title="Reset order"
                      disabled={submitting}
                    >
                      <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pos-cart__collapse-btn"
                    onClick={toggleCartCollapsed}
                    title="Collapse order details"
                    aria-label="Collapse order details"
                    aria-expanded={!isCartCollapsed}
                  >
                    <i
                      className="fa-solid fa-angles-right pos-cart__collapse-icon-desktop"
                      aria-hidden="true"
                    />
                    <i
                      className="fa-solid fa-angles-up pos-cart__collapse-icon-mobile"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </header>

          {heldSessions.length > 0 ? (
            <div className="pos-held" aria-label="Held sales">
              <div className="pos-held__label">
                Held
                <span>{heldSessions.length}</span>
              </div>
              <ul className="pos-held__list">
                {heldSessions.map((session) => {
                  const sessionCount = cartItemCount(session.cart);
                  const sessionTotal = Math.max(
                    0,
                    cartSubtotal(session.cart) +
                    (Number(session.deliveryFee) || 0) -
                    (Number(session.discount) || 0),
                  );
                  return (
                    <li key={session.id} className="pos-held__item">
                      <button
                        type="button"
                        className="pos-held__resume"
                        onClick={() => void resumeHeldSale(session.id)}
                        disabled={submitting || Boolean(pendingMpesa)}
                        title={`Resume “${session.label}”`}
                      >
                        <strong>{session.label}</strong>
                        <span>
                          {sessionCount} · {formatMoney(sessionTotal)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="pos-held__discard"
                        onClick={() => void discardHeldSale(session.id)}
                        disabled={submitting || Boolean(pendingMpesa)}
                        aria-label={`Discard held sale “${session.label}”`}
                        title="Discard held sale"
                      >
                        <i className="fa-solid fa-xmark" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="pos-cart__body">
            {isTransChapSale && !isRestaurant ? (
              <div className="pos-cart__row">
                <span className="pos-label">Channel</span>
                <p className="pos-cart__fixed-meta">
                  <i className={SOURCE_ICONS.walkin} aria-hidden="true" />
                  Walk-in · Pickup
                </p>
              </div>
            ) : (
              <>
                {!isTransChapSale ? (
                  <div className="pos-cart__row">
                    <span className="pos-label">Channel</span>
                    <div className="pos-pickers pos-pickers--two" role="radiogroup">
                      {POS_SOURCES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={source === s}
                          className={`pos-picker pos-picker--wide${source === s ? " is-active" : ""}`}
                          onClick={() => setSource(s)}
                        >
                          <i className={SOURCE_ICONS[s]} aria-hidden="true" />
                          <span>{SOURCE_LABELS[s]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="pos-cart__row">
                  <span className="pos-label">{isRestaurant ? "Dining Option" : "Type"}</span>
                  <div className="pos-pickers pos-pickers--two" role="radiogroup">
                    {ALL_FULFILLMENT_TYPES.map((f) => (
                      <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={fulfillment === f}
                        className={`pos-picker pos-picker--wide${fulfillment === f ? " is-active" : ""}`}
                        onClick={() => setFulfillment(f)}
                      >
                        <i className={FULFILLMENT_ICONS[f]} aria-hidden="true" />
                        <span>{FULFILLMENT_LABELS[f]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {fulfillment === "dine_in" || (isRestaurant && fulfillment !== "delivery") ? (
                  <div className="pos-cart__row">
                    <span className="pos-label">Table / Seating</span>
                    <div className="pos-table-selector">
                      <div className="pos-table-chips">
                        {restaurantTables.map((tbl) => (
                          <button
                            key={tbl.id || tbl.label}
                            type="button"
                            className={`pos-table-chip${tableNumber === tbl.label ? " is-active" : ""}`}
                            onClick={() => setTableNumber(tbl.label)}
                          >
                            {tbl.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        className="pos-table-input"
                        placeholder="Table / Seat # (e.g. Table 12, Bar 1)"
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {!isTransChapSale ? customerFields : null}

            <AnimatePresence initial={false}>
              {!isTransChapSale && fulfillment === "delivery" ? (
                <motion.div
                  key="delivery-fields"
                  className="pos-fields pos-fields--delivery"
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={reduce ? undefined : { opacity: 1, height: "auto" }}
                  exit={reduce ? undefined : { opacity: 0, height: 0 }}
                  transition={springSoft}
                  style={{ overflow: "hidden" }}
                >
                  <AddressLocationField
                    value={deliveryAddress}
                    onChange={(text) => {
                      setDeliveryAddress(text);
                    }}
                    onCoordsChange={setDeliveryCoords}
                    label="Delivery address"
                    placeholder="Search for a delivery address"
                    fallback="textarea"
                    allowMapPin
                  />
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Notes (gate code, landmark…)"
                    aria-label="Delivery notes"
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <footer className="pos-cart__footer">
            {isTransChapSale && operationsSettingsError ? (
              <div
                role="alert"
                style={{
                  color: "#b42318",
                  fontSize: "0.875rem",
                  marginBottom: "0.75rem",
                }}
              >
                {operationsSettingsError}{" "}
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: 0,
                    color: "inherit",
                    cursor: "pointer",
                    fontWeight: 700,
                    textDecoration: "underline",
                  }}
                  onClick={() => void loadOperationsSettings()}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {isTransChapSale ? (
              <div className="pos-cart__row pos-cart__row--pay pos-cart__row--pay-full">
                {isRestaurant ? (
                  <div className="pos-restaurant-timing" role="radiogroup" aria-label="Payment timing">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === ""}
                      className={`pos-restaurant-timing__btn is-unpaid${paymentMethod === "" ? " is-active" : ""}`}
                      onClick={() => setPaymentMethod("")}
                    >
                      <i className="fa-solid fa-utensils" aria-hidden="true" />
                      <span>Pay after meal (Unpaid)</span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod !== ""}
                      className={`pos-restaurant-timing__btn${paymentMethod !== "" ? " is-active" : ""}`}
                      onClick={() => {
                        if (paymentMethod === "") choosePaymentMethod("cash");
                      }}
                    >
                      <i className="fa-solid fa-credit-card" aria-hidden="true" />
                      <span>Pay upfront now</span>
                    </button>
                  </div>
                ) : null}

                {!isRestaurant || paymentMethod !== "" ? (
                  <div
                    className={`pos-pickers pos-pickers--${paymentOptions.length === 4 ? "four" : "three"}`}
                    role="radiogroup"
                    aria-label="Payment method"
                  >
                    {paymentOptions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={paymentMethod === p}
                        className={`pos-picker pos-picker--wide${paymentMethod === p ? " is-active" : ""}${p === "credit" ? " pos-picker--credit" : ""}${p === "cash" ? " pos-picker--cash" : ""}`}
                        onClick={() => {
                          if (isRestaurant && paymentMethod === p) {
                            setPaymentMethod("");
                          } else {
                            choosePaymentMethod(p);
                          }
                        }}
                      >
                        <span>
                          {p === "cash" ? "Cash sale" : PAYMENT_LABELS[p]}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pos-unpaid-banner" role="status">
                    <i className="fa-solid fa-circle-check" aria-hidden="true" />
                    <div>
                      <strong>No payment recorded at this point</strong>
                      <p>
                        Order will be sent to the kitchen. You can settle payment (Cash, M-PESA, or Credit) after the meal under <strong>Sales</strong>.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {usesCredit ? (
              <div className="pos-field" style={{ marginTop: "0.5rem" }}>
                <label className="pos-label" htmlFor="pos-credit-due-date">
                  Date to pay (optional)
                </label>
                <input
                  id="pos-credit-due-date"
                  type="date"
                  className="pos-input"
                  value={creditDueDate}
                  onChange={(e) => setCreditDueDate(e.target.value)}
                />
              </div>
            ) : null}
            <div
              className={`pos-money-row${isTransChapSale ? " pos-money-row--transchap" : ""}`}
            >
              {!isTransChapSale ? (
                <label className="pos-money-input">
                  <span className="pos-money-input__prefix">Delivery</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    placeholder="0"
                    disabled={fulfillment !== "delivery"}
                  />
                </label>
              ) : null}
              <label className="pos-money-input">
                <span className="pos-money-input__prefix">Discount</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                />
              </label>
              {!isTransChapSale ? (
                <select
                  className="pos-payment-select"
                  value={paymentMethod}
                  onChange={(e) =>
                    choosePaymentMethod(e.target.value as OrderPaymentMethod | "")
                  }
                  aria-label="Payment method"
                >
                  <option value="">Pay later</option>
                  {paymentOptions.map((p) => (
                    <option key={p} value={p}>
                      {PAYMENT_LABELS[p]}
                    </option>
                  ))}
                  <option value="split">Split payment</option>
                </select>
              ) : null}
            </div>

            {isSplit ? (
              <div className="pos-split" role="group" aria-label="Split payment">
                <div className="pos-split__head">
                  <span className="pos-label">Split payment</span>
                  <span
                    className={`pos-split__status${
                      splitRemaining === 0 ? " is-ok" : splitRemaining < 0 ? " is-over" : ""
                    }`}
                  >
                    {splitRemaining === 0
                      ? "Fully allocated"
                      : splitRemaining > 0
                        ? `${formatMoney(splitRemaining)} left`
                        : `Over by ${formatMoney(-splitRemaining)}`}
                  </span>
                </div>
                {splitRows.map((row, index) => {
                  const taken = new Set(
                    splitRows.filter((_, i) => i !== index).map((r) => r.method),
                  );
                  return (
                    <div className="pos-split__row" key={index}>
                      <select
                        className="pos-payment-select"
                        value={row.method}
                        onChange={(e) =>
                          updateSplitRow(index, { method: e.target.value as SplitMethod })
                        }
                        aria-label={`Payment ${index + 1} method`}
                      >
                        {splitMethodOptions
                          .filter((m) => m === row.method || !taken.has(m))
                          .map((m) => (
                            <option key={m} value={m}>
                              {PAYMENT_LABELS[m]}
                            </option>
                          ))}
                      </select>
                      <label className="pos-money-input">
                        <span className="pos-money-input__prefix">KES</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={row.amount}
                          onChange={(e) => updateSplitRow(index, { amount: e.target.value })}
                          placeholder="0"
                          aria-label={`${PAYMENT_LABELS[row.method]} amount`}
                        />
                      </label>
                      <div className="pos-split__actions">
                        {splitRemaining > 0 ? (
                          <button
                            type="button"
                            className="pos-split__fill"
                            onClick={() => fillSplitRemainder(index)}
                            title="Put the remaining balance on this method"
                          >
                            Rest
                          </button>
                        ) : null}
                        {splitRows.length > 2 ? (
                          <button
                            type="button"
                            className="pos-split__remove"
                            onClick={() => removeSplitRow(index)}
                            aria-label={`Remove ${PAYMENT_LABELS[row.method]}`}
                          >
                            <i className="fa-solid fa-xmark" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {splitRows.length < splitMethodOptions.length ? (
                  <button type="button" className="pos-split__add" onClick={addSplitRow}>
                    <i className="fa-solid fa-plus" aria-hidden /> Add method
                  </button>
                ) : null}
              </div>
            ) : null}

            {isTransChapSale ? customerFields : null}

            <dl className="pos-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(subtotal)}</dd>
              </div>
              {deliveryFeeNum > 0 ? (
                <div>
                  <dt>Delivery</dt>
                  <dd>+ {formatMoney(deliveryFeeNum)}</dd>
                </div>
              ) : null}
              {discountNum > 0 ? (
                <div className="pos-totals__discount">
                  <dt>Discount</dt>
                  <dd>− {formatMoney(discountNum)}</dd>
                </div>
              ) : null}
              {includeTax && taxAmount > 0 ? (
                <div>
                  <dt>Tax (16%)</dt>
                  <dd>+ {formatMoney(taxAmount)}</dd>
                </div>
              ) : null}
              <div className="pos-totals__grand">
                <dt>Total</dt>
                <dd>{formatMoney(total)}</dd>
              </div>
            </dl>

            {hasPriceBelowBuyingPrice ? (
              <div className="pos-totals__price-warning" role="alert">
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                <span>Selling price cannot be less than buying price. Adjust price to enable sale.</span>
              </div>
            ) : null}

            {usesMpesa && !forceMpesaPrompt ? (
              <div className="pos-place-dual-group">
                <button
                  type="button"
                  className={`pos-place pos-place--record ${
                    mpesaAction === "record" ? "pos-place--active" : "pos-place--subtle"
                  }`}
                  onClick={() => void handleActionPlace("record")}
                  disabled={placeDisabled}
                >
                  {submitting && mpesaAction === "record" ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                      <span>Recording M-Pesa…</span>
                    </>
                  ) : (
                    <>
                      <span className="pos-place__label">
                        <i className="fa-solid fa-receipt" aria-hidden="true" />
                        <span>Record payment</span>
                      </span>
                      <span className="pos-place__total">{formatMoney(total)}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className={`pos-place pos-place--stk ${
                    mpesaAction === "stk" ? "pos-place--active" : "pos-place--subtle"
                  }`}
                  onClick={() => void handleActionPlace("stk")}
                  disabled={placeDisabled}
                >
                  {submitting && mpesaAction === "stk" ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                      <span>Sending M-Pesa…</span>
                    </>
                  ) : (
                    <>
                      <span className="pos-place__label">
                        <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
                        <span>Send STK push</span>
                      </span>
                      <span className="pos-place__total">{formatMoney(total)}</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="pos-place"
                onClick={() => void placeOrder()}
                disabled={placeDisabled}
              >
                {submitting ? (
                  <>
                    <i
                      className="fa-solid fa-spinner fa-spin"
                      aria-hidden="true"
                    />
                    {placeLabel}
                  </>
                ) : (
                  <>
                    <span className="pos-place__label">
                      <i className="fa-solid fa-check" aria-hidden="true" />
                      {placeLabel}
                    </span>
                    <span className="pos-place__total">{formatMoney(total)}</span>
                  </>
                )}
              </button>
            )}
            <label className="pos-autoprint-toggle">
              <input
                type="checkbox"
                checked={includeTax}
                onChange={(e) => handleIncludeTaxChange(e.target.checked)}
              />
              <span>Include tax price</span>
            </label>
            <label className="pos-autoprint-toggle">
              <input
                type="checkbox"
                checked={autoPrintReceipt}
                onChange={(e) => handleAutoPrintChange(e.target.checked)}
              />
              <span>
                {isRestaurant && !paymentMethod
                  ? "Auto-print kitchen order ticket"
                  : "Auto-print receipt after sale"}
              </span>
            </label>
          </footer>
            </>
          )}
        </aside>

        {/* Mobile floating bottom bar when in catalog mode */}
        {mobileScreen === "catalog" && cart.length > 0 ? (
          <div className="pos-mobile-cart-bar">
            <div className="pos-mobile-cart-bar__content">
              <div className="pos-mobile-cart-bar__info">
                <span className="pos-mobile-cart-bar__badge">
                  <i className="fa-solid fa-cart-shopping" aria-hidden="true" />
                  <span>{itemCount}</span>
                </span>
                <div className="pos-mobile-cart-bar__meta">
                  <span className="pos-mobile-cart-bar__title">Current order</span>
                  <span className="pos-mobile-cart-bar__total">
                    {formatMoney(total)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="pos-mobile-cart-bar__action"
                onClick={() => {
                  setMobileScreen("order");
                  setIsCartCollapsed(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <span>Review Order</span>
                <i className="fa-solid fa-arrow-right" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {completeInPlace && receiptOrder && isTransChapSale ? (
        <TransChapReceiptPrint
          receipt={{
            ...receiptFromOrder(receiptOrder, receiptShopName),
            headerLines: receiptHeaderLines(authUser?.active_account ?? authUser?.account),
          }}
        />
      ) : completeInPlace && receiptOrder ? (
        <section className="orders-receipt-print" aria-hidden="true">
          <header className="orders-receipt-print__head">
            <h2>Sales Receipt</h2>
            <p>Order #{receiptOrder.order_number}</p>
          </header>
          <dl className="orders-receipt-print__meta">
            <div>
              <dt>Date</dt>
              <dd>
                {formatNairobiDateTime(
                  receiptOrder.placed_at ?? receiptOrder.created_at,
                ) || "—"}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{STATUS_LABELS[receiptOrder.status]}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{receiptOrder.customer_name ?? "Walk-in customer"}</dd>
            </div>
            {receiptOrder.table_number ? (
              <div>
                <dt>Table</dt>
                <dd className="receipt-table-highlight">{receiptOrder.table_number}</dd>
              </div>
            ) : null}
            {receiptOrder.server_name ? (
              <div>
                <dt>Server</dt>
                <dd>{receiptOrder.server_name}</dd>
              </div>
            ) : null}
            <div>
              <dt>Payment</dt>
              <dd>
                {receiptOrder.payment_method
                  ? orderPaymentLabel(receiptOrder)
                  : "Pay later"}
              </dd>
            </div>
          </dl>
          <table className="orders-receipt-print__items">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(receiptOrder.items ?? []).map((line) => (
                <tr key={line.id}>
                  <td>
                    <div className="receipt-item-title">{line.product_name}</div>
                    {line.modifiers && line.modifiers.length > 0 ? (
                      <div className="receipt-item-mods">
                        {line.modifiers.map((m, mIdx) => (
                          <div key={mIdx} className="receipt-mod-line">
                            {m.kind === "component"
                              ? `${(m.quantity ?? 1) > 1 ? `${m.quantity}× ` : ""}${m.name}`
                              : `+ ${m.name}`}{" "}
                            {m.price > 0 ? `(${formatMoney(m.price, receiptOrder.currency)})` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {line.notes ? (
                      <div className="receipt-mod-note">Note: {line.notes}</div>
                    ) : null}
                  </td>
                  <td>{line.quantity}</td>
                  <td>{formatMoney(line.unit_price, receiptOrder.currency)}</td>
                  <td>{formatMoney(line.line_total, receiptOrder.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Subtotal</td>
                <td>{formatMoney(receiptOrder.subtotal, receiptOrder.currency)}</td>
              </tr>
              {receiptOrder.delivery_fee > 0 ? (
                <tr>
                  <td colSpan={3}>Delivery</td>
                  <td>
                    {formatMoney(receiptOrder.delivery_fee, receiptOrder.currency)}
                  </td>
                </tr>
              ) : null}
              {receiptOrder.discount > 0 ? (
                <tr>
                  <td colSpan={3}>Discount</td>
                  <td>
                    -{formatMoney(receiptOrder.discount, receiptOrder.currency)}
                  </td>
                </tr>
              ) : null}
              {receiptOrder.tax && receiptOrder.tax > 0 ? (
                <tr>
                  <td colSpan={3}>Tax (16%)</td>
                  <td>
                    +{formatMoney(receiptOrder.tax, receiptOrder.currency)}
                  </td>
                </tr>
              ) : null}
              <tr className="orders-receipt-print__grand">
                <td colSpan={3}>Total</td>
                <td>{formatMoney(receiptOrder.total, receiptOrder.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : null}

      {modifyingItem ? (
        <TransChapModifierModal
          key={`${modifyingItem.item.id}-${modifyingItem.cartLineId ?? "new"}`}
          onClose={() => setModifyingItem(null)}
          item={modifyingItem.item}
          initialOptionIds={modifyingItem.initialOptionIds}
          initialModifiers={modifyingItem.initialModifiers}
          initialNotes={modifyingItem.initialNotes}
          currency="KES"
          availability={optionAvailability}
          onConfirm={handleConfirmModifiers}
        />
      ) : null}

      <TransChapCustomerQuickAdd
        open={addCustomerOpen}
        customers={customers}
        initialPhone={customerPhone}
        onClose={() => setAddCustomerOpen(false)}
        onCreated={handleCustomerCreated}
      />
    </section>
  );
}

function CatalogSkeleton() {
  const reduce = useReducedMotion();
  const cards = Array.from({ length: 8 });
  return (
    <motion.ul
      className="pos-cards"
      aria-busy="true"
      aria-live="polite"
      variants={reduce ? undefined : staggerContainer}
      initial={reduce ? false : "hidden"}
      animate={reduce ? undefined : "visible"}
      exit={reduce ? undefined : { opacity: 0, y: -6 }}
      transition={{ duration: motionDuration.base, ease: easeOutExpressive }}
    >
      {cards.map((_, i) => (
        <motion.li
          key={i}
          className="pos-card pos-card--skeleton"
          variants={reduce ? undefined : staggerItem}
        >
          <div className="pos-card__hit">
            <div className="pos-card__thumb">
              <Skeleton variant="rect" width="100%" height="100%" />
            </div>
            <div className="pos-card__info">
              <Skeleton variant="text" width="70%" height={13} />
              <Skeleton variant="text" width="45%" height={10} />
              <Skeleton variant="text" width="35%" height={13} />
            </div>
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}
