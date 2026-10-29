"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { Skeleton } from "@/components/app/Skeleton";
import {
  TransChapBuyProductModal,
  type BuyProductDraft,
} from "@/components/trans-chap/TransChapBuyProductModal";
import {
  buildPurchaseNote,
  emptyPurchaseMeta,
  type PurchaseMeta,
  type PurchaseStatus,
} from "@/components/trans-chap/TransChapPurchaseFields";
import { TransChapSupplierField } from "@/components/trans-chap/TransChapSupplierField";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch, apiFetchCached } from "@/lib/api";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import {
  staggerContainer,
  staggerItem,
  springSoft,
  duration as motionDuration,
  easeOutExpressive,
} from "@/lib/motion";
import { isRestaurantStore } from "@/lib/onboarding";
import { formatMoney } from "@/lib/orders";
import {
  addInventoryFromCatalogProduct,
  addLiteInventoryProduct,
  canPurchaseCatalogProduct,
  canPurchaseInventoryItem,
  fetchPurchasableCatalogProducts,
  findInventoryByName,
  inventoryCoverUrl,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  receiveStock,
  updateInventoryItem,
} from "@/lib/trans-chap-product";
import {
  allSellUnits,
  baseUnitName,
  hasPackUnits,
  normalizeUnitName,
  resolveSellUnit,
  packUnits,
  sellUnitCost,
  type SellUnit,
} from "@/lib/sell-units";
import {
  clearPurchaseDraft,
  loadPurchaseDraft,
  savePurchaseDraft,
} from "@/lib/trans-chap-purchase-draft";
import type {
  CatalogProduct,
  InventoryItem,
  InventoryResponse,
  InventoryRole,
  SettingsResponse,
  StockMovementsListResponse,
} from "@/lib/types";

type BasketLine = {
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
  sellUnit: string | null;
  unitFactor: number;
  autoPackFactor?: number;
  availablePacks?: { name: string; factor: number }[];
};

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

const ALL_ROLE_OPTIONS: { id: InventoryRole; label: string }[] = [
  { id: "both", label: "Buy & sell" },
  { id: "raw_material", label: "Raw material" },
];

const STATUS_OPTIONS: { id: PurchaseStatus; label: string; icon: string }[] = [
  { id: "received", label: "Received", icon: "fa-solid fa-box-open" },
  { id: "pending", label: "Pending", icon: "fa-solid fa-clock" },
  { id: "ordered", label: "Ordered", icon: "fa-solid fa-clipboard-list" },
];

const QUICK_ADD_QTY_STORAGE_KEY = "purchase:quick_add_qty";
const RECENT_LIMIT = 15;
const CATALOG_SEARCH_DELAY_MS = 300;

function nameInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function basketKey(
  name: string,
  itemId: string | null,
  catalogProductId: string | null = null,
  sellUnit: string | null = null,
): string {
  const unitPart = sellUnit ? `::${normalizeUnitName(sellUnit)}` : "";
  if (itemId) return `${itemId}${unitPart}`;
  if (catalogProductId) return `catalog:${catalogProductId}${unitPart}`;
  return `${name.trim().toLowerCase()}${unitPart}`;
}

function lineFromItem(
  item: InventoryItem,
  qty = 1,
  unit?: SellUnit,
): BasketLine {
  const name = inventoryProductName(item);
  const resolved = unit ?? resolveSellUnit(item, null);
  const unitCost =
    sellUnitCost(resolved) ??
    (item.buying_price != null && item.buying_price >= 0
      ? item.buying_price * resolved.factor
      : 0);
  const sellingPrice =
    resolved.selling_price != null && resolved.selling_price >= 0
      ? resolved.selling_price
      : item.selling_price != null && item.selling_price >= 0
        ? item.selling_price
        : 0;
  const role = inventoryRole(item);
  
  // If the item doesn't have explicitly configured packs, try to auto-detect from name
  const explicitPacks = packUnits(item);
  const autoPackFactor = explicitPacks.length === 0 ? detectPackSize(name) : undefined;
  
  const isAlternateUnit = normalizeUnitName(resolved.name) !== normalizeUnitName(baseUnitName(item));
  const sellUnit = isAlternateUnit ? resolved.name : (autoPackFactor ? "Pack" : null);
  const unitFactor = isAlternateUnit ? resolved.factor : (autoPackFactor ?? 1);

  return {
    key: basketKey(name, item.id, null, sellUnit),
    productName: name,
    inventoryItemId: item.id,
    catalogProductId: null,
    quantity: qty,
    unitCost,
    unitCostInput: unitCost > 0 ? String(unitCost) : "",
    sellingPrice,
    sellingPriceInput: sellingPrice > 0 ? String(sellingPrice) : "",
    role: role === "for_sale" ? "both" : role,
    imageUrl: inventoryCoverUrl(item),
    sellUnit,
    unitFactor,
    autoPackFactor: autoPackFactor ?? undefined,
    availablePacks: explicitPacks.map(p => ({ name: p.name, factor: p.factor })),
  };
}

function lineFromCatalog(product: CatalogProduct, role: InventoryRole): BasketLine {
  const name = product.name.trim() || "Product";
  const autoPackFactor = detectPackSize(name);
  return {
    key: basketKey(name, null, product.id),
    productName: name,
    inventoryItemId: null,
    catalogProductId: product.id,
    quantity: 1,
    unitCost: 0,
    unitCostInput: "",
    sellingPrice: 0,
    sellingPriceInput: "",
    role,
    imageUrl: product.image_url ?? null,
    sellUnit: autoPackFactor ? "Pack" : null,
    unitFactor: autoPackFactor ?? 1,
    autoPackFactor: autoPackFactor ?? undefined,
    availablePacks: [],
  };
}

function lineFromNewProduct(
  name: string,
  extras?: {
    role?: InventoryRole;
    sku?: string | null;
    productCode?: string | null;
  },
): BasketLine {
  const productName = name.trim();
  const autoPackFactor = detectPackSize(productName);
  return {
    key: basketKey(productName, null, null),
    productName,
    inventoryItemId: null,
    catalogProductId: null,
    quantity: 1,
    unitCost: 0,
    unitCostInput: "",
    sellingPrice: 0,
    sellingPriceInput: "",
    role: extras?.role ?? "both",
    imageUrl: null,
    sku: extras?.sku?.trim() || null,
    productCode: extras?.productCode?.trim() || null,
    sellUnit: autoPackFactor ? "Pack" : null,
    unitFactor: autoPackFactor ?? 1,
    autoPackFactor: autoPackFactor ?? undefined,
    availablePacks: [],
  };
}

function mergeBasketLine(lines: BasketLine[], next: BasketLine): BasketLine[] {
  const existing = lines.find((line) => line.key === next.key);
  if (existing) {
    return lines.map((line) =>
      line.key === next.key
        ? { ...line, quantity: line.quantity + next.quantity }
        : line,
    );
  }
  return [...lines, next];
}

function businessLocationLabel(
  user: ReturnType<typeof useOptionalAuthUser>,
): string {
  const account = user?.active_account ?? user?.account;
  const name = account?.business_name?.trim() || "";
  const location = account?.business_location?.trim() || "";
  if (name && location) return `${name} · ${location}`;
  return name || location || "";
}

export function TransChapPurchaseForm() {
  const router = useRouter();
  const presetSupplier = useSearchParams().get("supplier")?.trim() || "";
  const reduce = useReducedMotion();
  const user = useOptionalAuthUser();
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const roleOptions = restaurant
    ? ALL_ROLE_OPTIONS
    : ALL_ROLE_OPTIONS.filter((option) => option.id !== "raw_material");

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [recentItemIds, setRecentItemIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [mobileScreen, setMobileScreen] = useState<"catalog" | "supplier">(
    "catalog",
  );
  const [selectedUnitByItemId, setSelectedUnitByItemId] = useState<
    Record<string, string>
  >({});
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [purchaseMeta, setPurchaseMeta] = useState<PurchaseMeta>(() =>
    emptyPurchaseMeta(),
  );
  const [saving, setSaving] = useState(false);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyModalName, setBuyModalName] = useState("");
  const [quickAddQty, setQuickAddQty] = useState(1);
  const [adjustSellingPrice, setAdjustSellingPrice] = useState(true);
  const [draftReady, setDraftReady] = useState(false);

  const PURCHASE_CART_COLLAPSED_KEY = "purchase:cart_collapsed";
  const [isCartCollapsed, setIsCartCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PURCHASE_CART_COLLAPSED_KEY);
      if (saved === "1") setIsCartCollapsed(true);
    } catch {}
  }, []);

  const toggleCartCollapsed = useCallback(() => {
    setIsCartCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PURCHASE_CART_COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  const inventoryRef = useRef<InventoryItem[]>([]);
  const pulseTimer = useRef<number | null>(null);
  const scannerBuffer = useRef("");
  const scannerLastKeyAt = useRef(0);
  const scannerResetTimer = useRef<number | null>(null);
  const draftHydratedRef = useRef(false);

  const accountId = user?.active_account?.id || user?.account?.id || null;
  const shopLocation = useMemo(() => businessLocationLabel(user), [user]);

  const purchaseTotal = useMemo(
    () =>
      basket.reduce((sum, line) => {
        const cost = Number(line.unitCostInput);
        const unit = Number.isFinite(cost) && cost >= 0 ? cost : line.unitCost;
        return sum + line.quantity * unit;
      }, 0),
    [basket],
  );

  const itemCount = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity, 0),
    [basket],
  );

  const lineByInventoryId = useMemo(() => {
    const map = new Map<string, BasketLine>();
    for (const line of basket) {
      if (!line.inventoryItemId) continue;
      const selected = selectedUnitByItemId[line.inventoryItemId];
      const selectedKey = selected ? normalizeUnitName(selected) : "";
      const lineKey = line.sellUnit ? normalizeUnitName(line.sellUnit) : "";
      if (selected && selectedKey === lineKey) {
        map.set(line.inventoryItemId, line);
        continue;
      }
      if (!map.has(line.inventoryItemId)) {
        map.set(line.inventoryItemId, line);
      }
    }
    return map;
  }, [basket, selectedUnitByItemId]);

  const lineByCatalogId = useMemo(() => {
    const map = new Map<string, BasketLine>();
    for (const line of basket) {
      if (line.catalogProductId) map.set(line.catalogProductId, line);
    }
    return map;
  }, [basket]);

  const inventoryByProductId = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of inventory) {
      if (item.product_id) map.set(item.product_id, item);
    }
    return map;
  }, [inventory]);

  const shopItems = useMemo(
    () => inventory.filter(canPurchaseInventoryItem),
    [inventory],
  );

  const searchNeedle = search.trim().toLowerCase();

  const filteredShop = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      const byId = new Map(shopItems.map((item) => [item.id, item]));
      return recentItemIds
        .map((id) => byId.get(id))
        .filter((item): item is InventoryItem => Boolean(item))
        .slice(0, RECENT_LIMIT);
    }
    return shopItems.filter((item) => {
      const name = inventoryProductName(item).toLowerCase();
      const sku = (item.product?.sku ?? "").toLowerCase();
      const code = (item.product?.product_code ?? "").toLowerCase();
      const category = (item.product?.category ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        code.includes(needle) ||
        category.includes(needle)
      );
    });
  }, [shopItems, search, recentItemIds]);

  const filteredCatalog = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return catalog.filter((product) => {
      if (!canPurchaseCatalogProduct(product)) return false;
      if (inventoryByProductId.has(product.id)) return false;
      const name = product.name.toLowerCase();
      const sku = (product.sku ?? "").toLowerCase();
      const code = (product.product_code ?? "").toLowerCase();
      const category = (product.category ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        code.includes(needle) ||
        category.includes(needle)
      );
    });
  }, [catalog, inventoryByProductId, search]);

  // Shop matches show straight away; only wait on the catalog when nothing else matched.
  const catalogPending =
    inventoryLoading ||
    (Boolean(searchNeedle) && catalogLoading && filteredShop.length === 0);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(QUICK_ADD_QTY_STORAGE_KEY);
      const n = raw ? Number(raw) : 1;
      if (Number.isFinite(n) && n >= 1) setQuickAddQty(Math.floor(n));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetchCached<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        if (!cancelled) {
          setAdjustSellingPrice(data.adjust_selling_price_on_purchase ?? true);
        }
      })
      .catch(() => {
        if (!cancelled) setAdjustSellingPrice(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (draftHydratedRef.current) return;
    draftHydratedRef.current = true;
    const draft = loadPurchaseDraft(accountId);
    if (draft?.lines.length) {
      setBasket(
        draft.lines.map((line) => ({
          ...line,
          sellUnit: line.sellUnit ?? null,
          unitFactor: line.unitFactor && line.unitFactor > 0 ? line.unitFactor : 1,
        })),
      );
      setPurchaseMeta(
        presetSupplier ? { ...draft.meta, supplier: presetSupplier } : draft.meta,
      );
      void toastSuccess(
        draft.lines.length === 1
          ? "Purchase draft restored"
          : `Purchase draft restored · ${draft.lines.length} items`,
      );
    } else if (presetSupplier) {
      setPurchaseMeta((meta) => ({ ...meta, supplier: presetSupplier }));
      setMobileScreen("supplier");
    }
    setDraftReady(true);
    // Restore once on mount; accountId is stable for a signed-in session.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot hydrate
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    if (!basket.length) {
      clearPurchaseDraft(accountId);
      return;
    }
    savePurchaseDraft(accountId, { lines: basket, meta: purchaseMeta });
  }, [accountId, basket, draftReady, purchaseMeta]);

  useEffect(() => {
    if (!shopLocation) return;
    setPurchaseMeta((prev) =>
      prev.businessLocation.trim()
        ? prev
        : { ...prev, businessLocation: shopLocation },
    );
  }, [shopLocation]);

  useEffect(() => {
    let alive = true;
    apiFetch<InventoryResponse>(`${apiRoutes.inventory}?active=true`)
      .then((res) => {
        if (!alive) return;
        setInventory(res.data);
      })
      .catch(() => {
        if (!alive) return;
        setInventory([]);
      })
      .finally(() => {
        if (alive) setInventoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch<StockMovementsListResponse>(
      `${apiRoutes.inventoryStockMovements}?direction=in&reason=receive&per_page=100&page=1`,
    )
      .then((res) => {
        if (!alive) return;
        const ids: string[] = [];
        for (const movement of res.data) {
          const id = movement.inventory_item_id;
          if (!id || movement.voided_at || ids.includes(id)) continue;
          ids.push(id);
        }
        setRecentItemIds(ids);
      })
      .catch(() => {
        if (alive) setRecentItemIds([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!searchNeedle) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setCatalogLoading(true);
      fetchPurchasableCatalogProducts(searchNeedle, { retailOnly: !restaurant })
        .then((rows) => {
          if (alive) setCatalog(rows);
        })
        .catch(() => {
          if (alive) setCatalog([]);
        })
        .finally(() => {
          if (alive) setCatalogLoading(false);
        });
    }, CATALOG_SEARCH_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [restaurant, searchNeedle]);

  function patchPurchaseMeta(patch: Partial<PurchaseMeta>) {
    setPurchaseMeta((prev) => {
      let changed = false;
      const next = { ...prev };
      (Object.keys(patch) as (keyof PurchaseMeta)[]).forEach((key) => {
        const value = patch[key];
        if (value === undefined || next[key] === value) return;
        (next[key] as PurchaseMeta[typeof key]) = value;
        changed = true;
      });
      return changed ? next : prev;
    });
  }

  function handleQuickAddQtyChange(value: string) {
    const n = Math.max(1, Math.floor(Number(value) || 1));
    setQuickAddQty(n);
    try {
      window.localStorage.setItem(QUICK_ADD_QTY_STORAGE_KEY, String(n));
    } catch {
      /* ignore */
    }
  }

  function pulse(key: string) {
    setPulseId(key);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => {
      setPulseId(null);
      pulseTimer.current = null;
    }, 420);
  }

  const addItem = useCallback(
    (item: InventoryItem, qty = quickAddQty, unit?: SellUnit) => {
      if (isHotelMenuItem(item)) {
        void showError(
          "Hotel menu",
          "Menu dishes can’t be purchased as stock. Add them from Hotel menu.",
        );
        return;
      }
      if (!item.is_active) return;
      const resolved =
        unit ??
        resolveSellUnit(item, selectedUnitByItemId[item.id] ?? null);
      const line = lineFromItem(item, Math.max(1, qty), resolved);
      setBasket((prev) => mergeBasketLine(prev, line));
      pulse(line.key);
    },
    [quickAddQty, selectedUnitByItemId],
  );

  const addCatalogProduct = useCallback(
    (product: CatalogProduct) => {
      const existing = inventoryRef.current.find(
        (item) =>
          item.product_id === product.id &&
          item.is_active &&
          !isHotelMenuItem(item),
      );
      if (existing) {
        addItem(existing);
        void toastSuccess(inventoryProductName(existing));
        return;
      }
      const line = {
        ...lineFromCatalog(product, "both"),
        quantity: Math.max(1, quickAddQty),
      };
      setBasket((prev) => mergeBasketLine(prev, line));
      pulse(line.key);
      void toastSuccess(`Added ${product.name.trim() || "product"}`);
    },
    [addItem, quickAddQty],
  );

  const addNewProduct = useCallback(
    (name: string, draft?: BuyProductDraft) => {
      let trimmed = (draft?.name ?? name).trim();
      if (!trimmed) return;
      
      if (draft?.isBundle && draft.bundleQuantity) {
        const bq = Math.floor(Number(draft.bundleQuantity));
        if (bq > 1 && !detectPackSize(trimmed)) {
          trimmed = `${trimmed} (pack of ${bq})`;
        }
      }

      const existing =
        findInventoryByName(inventoryRef.current, trimmed) ??
        inventoryRef.current.find(
          (item) =>
            item.is_active &&
            !isHotelMenuItem(item) &&
            inventoryProductName(item).toLowerCase() === trimmed.toLowerCase(),
        );
      if (existing && !isHotelMenuItem(existing)) {
        addItem(existing);
        void toastSuccess(inventoryProductName(existing));
        return;
      }
      const catalogMatch = catalog.find(
        (product) =>
          product.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (catalogMatch) {
        addCatalogProduct(catalogMatch);
        return;
      }
    const line = {
      ...lineFromNewProduct(trimmed, {
        role: draft?.role,
        sku: draft?.sku,
      }),
      quantity: Math.max(1, quickAddQty),
    };
      setBasket((prev) => mergeBasketLine(prev, line));
      pulse(line.key);
      void toastSuccess(`Added “${trimmed}” as new`);
    },
    [addCatalogProduct, addItem, catalog, quickAddQty],
  );

  function openBuyModal(name?: string) {
    setBuyModalName(name?.trim() || "");
    setBuyModalOpen(true);
  }

  function clearBasket() {
    setBasket([]);
    clearPurchaseDraft(accountId);
  }

  function updateLine(key: string, patch: Partial<BasketLine>) {
    setBasket((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function setQty(key: string, quantity: number) {
    if (quantity <= 0) {
      setBasket((prev) => prev.filter((line) => line.key !== key));
      return;
    }
    setBasket((prev) =>
      prev.map((line) => (line.key === key ? { ...line, quantity } : line)),
    );
  }

  function changeQuantity(key: string, delta: number) {
    const line = basket.find((entry) => entry.key === key);
    if (!line) return;
    setQty(key, line.quantity + delta);
  }

  function removeLine(key: string) {
    setBasket((prev) => prev.filter((line) => line.key !== key));
  }

  const clearScannerBuffer = useCallback(() => {
    scannerBuffer.current = "";
    if (scannerResetTimer.current !== null) {
      window.clearTimeout(scannerResetTimer.current);
      scannerResetTimer.current = null;
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Enter") {
        const scanned = scannerBuffer.current.trim();
        clearScannerBuffer();
        if (scanned.length < 3) return;
        event.preventDefault();
        const item =
          findInventoryByBarcode(inventoryRef.current, scanned) ?? null;
        if (!item) {
          void (async () => {
            const ok = await confirmAction(
              "Unknown barcode",
              `Buy “${scanned}” as a new product?`,
              "Buy new item",
            );
            if (!ok) return;
            router.push(
              `/trans-chap/purchases/unavailable?barcode=${encodeURIComponent(scanned)}`,
            );
          })();
          return;
        }
        if (isHotelMenuItem(item)) {
          void showError(
            "Hotel menu",
            "Menu dishes can’t be purchased as stock. Add them from Hotel menu.",
          );
          return;
        }
        addItem(item);
        setSearch("");
        void toastSuccess(`Scanned: ${inventoryProductName(item)} added`);
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
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addItem, clearScannerBuffer, router]);

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!basket.length) return;

    for (const line of basket) {
      const cost = Number(line.unitCostInput);
      if (!Number.isFinite(cost) || cost < 0) {
        await showError(
          "Buying price",
          `Enter a buying price for ${line.productName}.`,
        );
        return;
      }
      const lineShowSell =
        adjustSellingPrice && !restaurant && line.role !== "raw_material";
      if (lineShowSell && line.sellingPriceInput.trim()) {
        const sell = Number(line.sellingPriceInput);
        if (!Number.isFinite(sell) || sell < 0) {
          await showError(
            "Selling price",
            `Enter a valid selling price for ${line.productName}.`,
          );
          return;
        }
      }
    }

    const lossItems = basket.filter(
      (line) =>
        adjustSellingPrice &&
        !restaurant &&
        line.role !== "raw_material" &&
        line.sellingPriceInput.trim() &&
        line.sellingPrice > 0 &&
        line.unitCost > 0 &&
        (line.sellingPrice * (line.unitFactor || 1)) < line.unitCost
    );
    if (lossItems.length > 0) {
      const proceed = await confirmAction(
        "Low selling price",
        `You have set a selling price that results in a loss for ${lossItems.length} item(s) (e.g. ${lossItems[0].productName}). Are you sure you want to continue?`,
        "Yes, save anyway"
      );
      if (!proceed) return;
    }

    if (!purchaseMeta.supplier.trim()) {
      await showError("Supplier", "Select or enter a supplier.");
      return;
    }
    if (!purchaseMeta.purchaseDate.trim()) {
      await showError("Purchase date", "Enter the purchase date.");
      return;
    }
    if (!purchaseMeta.businessLocation.trim()) {
      await showError(
        "Business location",
        "Set your store location in Settings, then try again.",
      );
      return;
    }

    setSaving(true);
    let nextInventory = inventory;
    const savedKeys = new Set<string>();
    try {
      const note = buildPurchaseNote(purchaseMeta);
      // Resolve every line's inventory item before recording any stock, so a
      // failure here leaves nothing half-saved for a retry to duplicate.
      const prepared: {
        line: BasketLine;
        item: InventoryItem;
        cost: number;
        sellingPrice: number | null;
      }[] = [];
      for (const line of basket) {
        const cost = Number(line.unitCostInput);
        const sellRaw = Number(line.sellingPriceInput);
        const lineShowSell =
          adjustSellingPrice && !restaurant && line.role !== "raw_material";
        const sellingPrice =
          lineShowSell &&
          line.sellingPriceInput.trim() &&
          Number.isFinite(sellRaw) &&
          sellRaw >= 0
            ? sellRaw
            : null;
        let item =
          (line.inventoryItemId
            ? nextInventory.find((entry) => entry.id === line.inventoryItemId)
            : undefined) ??
          (line.catalogProductId
            ? nextInventory.find(
                (entry) => entry.product_id === line.catalogProductId,
              )
            : undefined) ??
          findInventoryByName(nextInventory, line.productName) ??
          null;

        if (item && isHotelMenuItem(item)) {
          await showError(
            "Hotel menu",
            `${line.productName} is a menu dish and can’t be purchased as stock.`,
          );
          return;
        }

        if (!item && line.catalogProductId) {
          item = await addInventoryFromCatalogProduct(line.catalogProductId, {
            buying_price: cost,
            selling_price: sellingPrice,
            stock_quantity: 0,
            inventory_role: line.role,
          });
        } else if (!item) {
          item = await addLiteInventoryProduct(
            line.productName,
            sellingPrice != null ? String(sellingPrice) : "",
            {
              buying_price: cost,
              stock_quantity: 0,
              inventory_role: line.role,
              sku: line.sku,
              product_code: line.productCode,
            },
          );
        } else {
          const patch: {
            inventory_role?: InventoryRole;
            selling_price?: number | null;
          } = {};
          if (inventoryRole(item) !== line.role) {
            patch.inventory_role = line.role;
          }
          if (sellingPrice != null && item.selling_price !== sellingPrice) {
            patch.selling_price = sellingPrice;
          }
          if (Object.keys(patch).length) {
            item = await updateInventoryItem(item.id, patch);
          }
        }

        nextInventory = [
          item,
          ...nextInventory.filter((entry) => entry.id !== item.id),
        ];
        prepared.push({ line, item, cost, sellingPrice });
      }

      for (const prep of prepared) {
        const { line, cost, sellingPrice } = prep;
        let item = await receiveStock({
          item: prep.item,
          quantity: line.quantity * Math.max(0.0001, line.unitFactor || 1),
          reason: "receive",
          // Persist buying price per stock (base) unit.
          unitCost:
            Math.max(0.0001, line.unitFactor || 1) !== 1
              ? Math.round((cost / Math.max(0.0001, line.unitFactor || 1)) * 100) / 100
              : cost,
          note:
            line.sellUnit
              ? [note, `${line.quantity} ${line.sellUnit}`].filter(Boolean).join(" · ")
              : note,
        });
        savedKeys.add(line.key);
        // Remember the cost for any configured alternate purchase unit.
        if (line.sellUnit) {
          const baseName = normalizeUnitName(baseUnitName(item));
          const packs = allSellUnits(item).filter((unit) => normalizeUnitName(unit.name) !== baseName);
          const existingIndex = packs.findIndex(
            (u) => normalizeUnitName(u.name) === normalizeUnitName(line.sellUnit)
          );

          if (existingIndex >= 0) {
            packs[existingIndex] = {
              ...packs[existingIndex],
              factor: line.unitFactor,
              buying_price: cost,
            };
          } else {
            packs.push({
              name: line.sellUnit,
              factor: line.unitFactor,
              buying_price: cost,
            });
          }

          const attrs = {
            ...(item.attributes || {}),
            sell_units: packs.map((unit) => ({
              name: unit.name,
              factor: unit.factor,
              ...(unit.reverse ? { reverse: true } : {}),
              ...(unit.reference_unit ? { reference_unit: unit.reference_unit } : {}),
              ...(unit.conversion_amount != null ? { conversion_amount: unit.conversion_amount } : {}),
              ...(unit.selling_price != null
                ? { selling_price: unit.selling_price }
                : {}),
              ...(unit.buying_price != null
                ? { buying_price: unit.buying_price }
                : {}),
            })),
          };
          item = await updateInventoryItem(item.id, { attributes: attrs });
        }
        
        if (
          sellingPrice != null &&
          item.selling_price !== sellingPrice
        ) {
          // Always update base selling price (Single), since the input represents the Single selling price
          item = await updateInventoryItem(item.id, {
            selling_price: sellingPrice,
          });
        }
        nextInventory = [
          item,
          ...nextInventory.filter((entry) => entry.id !== item.id),
        ];
      }
      setInventory(nextInventory);
      clearPurchaseDraft(accountId);
      setBasket([]);
      await toastSuccess(
        basket.length === 1
          ? "Purchase saved"
          : `${basket.length} purchases saved`,
      );
      router.push("/trans-chap/purchases");
    } catch (err) {
      setInventory(nextInventory);
      const message = extractErrorMessage(err, "The purchase could not be saved.");
      if (savedKeys.size > 0) {
        setBasket(basket.filter((line) => !savedKeys.has(line.key)));
        await showError(
          "Purchase partly saved",
          `${savedKeys.size} of ${basket.length} items were saved and removed from the list. ${message} Fix the remaining items, then save again.`,
        );
      } else {
        await showError("Purchase not saved", message);
      }
    } finally {
      setSaving(false);
    }
  }

  const emptyCatalog =
    filteredShop.length === 0 && filteredCatalog.length === 0;

  return (
    <>
      <section className="app-panel pos-panel pos-panel--purchase">
        <div
          className={`pos-grid pos-grid--mobile-${
            mobileScreen === "supplier" ? "order" : "catalog"
          }${isCartCollapsed ? " is-cart-collapsed" : ""}`}
        >
          {mobileScreen === "supplier" ? (
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
                  {formatMoney(purchaseTotal)}
                </span>
              </div>
            </div>
          ) : null}
          <div className="pos-main">
          <div className="pos-catalog">
            <header className="pos-catalog__head">
              <h1 className="pos-title">
                <i
                  className="fa-solid fa-cart-flatbed pos-title__icon"
                  aria-hidden="true"
                />
                New purchase
              </h1>
              <div className="pos-catalog__tools">
                <label
                  className="pos-quick-qty"
                  title="Units added per product tap or scan"
                >
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
                <div
                  className="pos-quick-qty__presets"
                  role="group"
                  aria-label="Quick quantity presets"
                >
                  {[1, 5, 10].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`pos-quick-qty__preset${
                        quickAddQty === preset ? " is-active" : ""
                      }`}
                      onClick={() => handleQuickAddQtyChange(String(preset))}
                      aria-pressed={quickAddQty === preset}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <label className="pos-search">
                  <i
                    className="fa-solid fa-magnifying-glass pos-search__icon"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    placeholder="Search products or scan barcode…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
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
                <button
                  type="button"
                  className="pos-card__add pos-purchase-new-btn"
                  onClick={() => openBuyModal(search)}
                  aria-label="Buy a new product"
                  title="Buy new product"
                >
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                </button>
              </div>
            </header>

            {!searchNeedle && !catalogPending && !emptyCatalog ? (
              <p className="pos-po-hint">Recently purchased · search to find more</p>
            ) : null}
            <AnimatePresence mode="wait">
              {catalogPending ? (
                <CatalogSkeleton key="purchase-catalog-skeleton" />
              ) : emptyCatalog ? (
                <motion.div
                  key="purchase-catalog-empty"
                  className="pos-empty"
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6 }}
                  transition={{
                    duration: motionDuration.micro,
                    ease: easeOutExpressive,
                  }}
                >
                  <i
                    className={`fa-solid ${search.trim() ? "fa-boxes-stacked" : "fa-magnifying-glass"}`}
                    aria-hidden="true"
                  />
                  <h3>
                    {search.trim() ? "No items match your search" : "Search for a product to buy"}
                  </h3>
                  <p>
                    {search.trim()
                      ? "Try a different search, or buy it as a new product."
                      : "Your recent purchases show here. Search, scan a barcode, or tap + to buy something new."}
                  </p>
                  {search.trim() ? (
                    <button
                      type="button"
                      className="pos-place"
                      style={{ marginTop: "0.75rem", width: "auto" }}
                      onClick={() => openBuyModal(search)}
                    >
                      Buy “{search.trim()}” as new
                    </button>
                  ) : null}
                </motion.div>
              ) : (
                <motion.ul
                  key={`purchase-catalog-${search}`}
                  className="pos-cards"
                  variants={reduce ? undefined : staggerContainer}
                  initial={reduce ? false : "hidden"}
                  animate={reduce ? undefined : "visible"}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={{ duration: motionDuration.micro }}
                >
                  {filteredShop.map((item) => {
                    const name = inventoryProductName(item);
                    const coverUrl = inventoryCoverUrl(item);
                    const selected = resolveSellUnit(
                      item,
                      selectedUnitByItemId[item.id] ?? null,
                    );
                    const lineKey = basketKey(
                      name,
                      item.id,
                      null,
                      normalizeUnitName(selected.name) !== normalizeUnitName(baseUnitName(item))
                        ? selected.name
                        : null,
                    );
                    const line =
                      lineByInventoryId.get(item.id)?.key === lineKey
                        ? lineByInventoryId.get(item.id)
                        : basket.find((entry) => entry.key === lineKey);
                    const inCartQty = line?.quantity ?? 0;
                    const isPulsing = pulseId === line?.key;
                    const subtitleParts = [
                      item.product?.category,
                      item.product?.brand,
                    ].filter(Boolean) as string[];
                    const buyPrice =
                      sellUnitCost(selected) ??
                      (item.buying_price != null && item.buying_price >= 0
                        ? Math.round(item.buying_price * selected.factor * 100) /
                          100
                        : null);
                    return (
                      <motion.li
                        key={item.id}
                        initial={false}
                        animate={
                          isPulsing && !reduce
                            ? { opacity: 1, y: 0, scale: [1, 1.025, 1] }
                            : { opacity: 1, y: 0, scale: 1 }
                        }
                        transition={{
                          duration: motionDuration.base,
                          ease: easeOutExpressive,
                        }}
                        className={`pos-card${inCartQty > 0 ? " is-in-cart" : ""}`}
                      >
                        <div className="pos-card__hit">
                          <button
                            type="button"
                            className="pos-card__main"
                            onClick={() => addItem(item)}
                            aria-label={`Add ${quickAddQty > 1 ? `${quickAddQty} of ` : ""}${name} to purchase`}
                          >
                            <div className="pos-card__thumb" aria-hidden="true">
                              {coverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={resolveAssetUrl(coverUrl)}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                <span className="pos-card__thumb-fallback">
                                  {nameInitial(name)}
                                </span>
                              )}
                            </div>
                            <div className="pos-card__info">
                              <span className="pos-card__name">{name}</span>
                              {subtitleParts.length ? (
                                <span className="pos-card__subtitle">
                                  {subtitleParts.join(" · ")}
                                </span>
                              ) : null}
                              <span className="pos-card__price">
                                {buyPrice != null ? (
                                  <>
                                    <span className="pos-card__price-amount">
                                      {formatMoney(buyPrice)}
                                    </span>
                                    <span className="pos-card__price-unit">
                                      /{normalizeUnitName(selected.name) !== normalizeUnitName(baseUnitName(item)) ? selected.name : "buy"}
                                    </span>
                                  </>
                                ) : (
                                  <span className="pos-card__price-unset">
                                    Set buying price in cart
                                  </span>
                                )}
                              </span>
                              <span className="pos-card__stock">
                                {item.stock_quantity == null
                                  ? "Stock not set"
                                  : `${item.stock_quantity} on hand`}
                                {inCartQty > 0
                                  ? ` · ${inCartQty}${
                                      line?.sellUnit
                                        ? ` ${line.sellUnit}`
                                        : ""
                                    } in purchase`
                                  : ""}
                              </span>
                            </div>
                          </button>
                          {hasPackUnits(item) ? (
                            <div
                              className="trans-chap-catalog__units"
                              role="group"
                              aria-label={`${name} units`}
                            >
                              {allSellUnits(item).map((unit) => {
                                const selected = resolveSellUnit(
                                  item,
                                  selectedUnitByItemId[item.id] ?? null,
                                );
                                const activeUnit =
                                  normalizeUnitName(unit.name) ===
                                  normalizeUnitName(selected.name);
                                return (
                                  <button
                                    key={unit.name}
                                    type="button"
                                    className={`trans-chap-catalog__unit${
                                      activeUnit ? " is-active" : ""
                                    }`}
                                    aria-pressed={activeUnit}
                                    onClick={() =>
                                      setSelectedUnitByItemId((prev) => ({
                                        ...prev,
                                        [item.id]: unit.name,
                                      }))
                                    }
                                  >
                                    {unit.name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          <div className="pos-card__action">
                            {inCartQty > 0 && line ? (
                              <div
                                className="pos-card__qty"
                                role="group"
                                aria-label={`Quantity of ${name} in purchase`}
                              >
                                <button
                                  type="button"
                                  aria-label="Decrease quantity"
                                  onClick={() => changeQuantity(line.key, -1)}
                                >
                                  <i
                                    className="fa-solid fa-minus"
                                    aria-hidden="true"
                                  />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={inCartQty}
                                  onChange={(e) =>
                                    setQty(line.key, Number(e.target.value) || 0)
                                  }
                                  aria-label={`Quantity of ${name}`}
                                />
                                <button
                                  type="button"
                                  aria-label="Increase quantity"
                                  onClick={() => changeQuantity(line.key, 1)}
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
                                onClick={() => addItem(item)}
                                aria-label={`Add ${name} to purchase`}
                              >
                                <i
                                  className="fa-solid fa-plus"
                                  aria-hidden="true"
                                />
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}

                  {filteredCatalog.map((product) => {
                    const name = product.name.trim() || "Product";
                    const line = lineByCatalogId.get(product.id);
                    const inCartQty = line?.quantity ?? 0;
                    const isPulsing = pulseId === line?.key;
                    const subtitleParts = [product.category, product.brand].filter(
                      Boolean,
                    ) as string[];
                    return (
                      <motion.li
                        key={`catalog:${product.id}`}
                        initial={false}
                        animate={
                          isPulsing && !reduce
                            ? { opacity: 1, y: 0, scale: [1, 1.025, 1] }
                            : { opacity: 1, y: 0, scale: 1 }
                        }
                        transition={{
                          duration: motionDuration.base,
                          ease: easeOutExpressive,
                        }}
                        className={`pos-card${inCartQty > 0 ? " is-in-cart" : ""}`}
                      >
                        <div className="pos-card__hit">
                          <button
                            type="button"
                            className="pos-card__main"
                            onClick={() => addCatalogProduct(product)}
                            aria-label={`Add ${name} to purchase`}
                          >
                            <div className="pos-card__thumb" aria-hidden="true">
                              {product.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={resolveAssetUrl(product.image_url)}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                <span className="pos-card__thumb-fallback">
                                  {nameInitial(name)}
                                </span>
                              )}
                            </div>
                            <div className="pos-card__info">
                              <span className="pos-card__name">{name}</span>
                              <span className="pos-card__subtitle">
                                {subtitleParts.length
                                  ? `${subtitleParts.join(" · ")} · Catalog`
                                  : "From catalog"}
                              </span>
                              <span className="pos-card__price">
                                <span className="pos-card__price-unset">
                                  Set buying price in cart
                                </span>
                              </span>
                            </div>
                          </button>
                          <div className="pos-card__action">
                            {inCartQty > 0 && line ? (
                              <div
                                className="pos-card__qty"
                                role="group"
                                aria-label={`Quantity of ${name} in purchase`}
                              >
                                <button
                                  type="button"
                                  aria-label="Decrease quantity"
                                  onClick={() => changeQuantity(line.key, -1)}
                                >
                                  <i
                                    className="fa-solid fa-minus"
                                    aria-hidden="true"
                                  />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={inCartQty}
                                  onChange={(e) =>
                                    setQty(line.key, Number(e.target.value) || 0)
                                  }
                                  aria-label={`Quantity of ${name}`}
                                />
                                <button
                                  type="button"
                                  aria-label="Increase quantity"
                                  onClick={() => changeQuantity(line.key, 1)}
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
                                onClick={() => addCatalogProduct(product)}
                                aria-label={`Add ${name} to purchase`}
                              >
                                <i
                                  className="fa-solid fa-plus"
                                  aria-hidden="true"
                                />
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>

          <section
            className={`pos-ticket${basket.length ? " has-lines" : ""}`}
            aria-label="Purchase items"
          >
            {basket.length > 0 ? (
              <div className="pos-cart__lines pos-ticket__lines">
                <ul>
                  <AnimatePresence initial={false}>
                    {basket.map((line) => {
                      const cost = Number(line.unitCostInput);
                      const unit =
                        Number.isFinite(cost) && cost >= 0
                          ? cost
                          : line.unitCost;
                      const lineTotal = unit * line.quantity;
                      return (
                        <motion.li
                          key={line.key}
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
                          className="pos-line pos-line--purchase pos-line--po"
                        >
                          <div className="pos-line__purchase-top">
                            <div className="pos-line__purchase-main">
                              <div className="pos-line__purchase-title-row">
                                <strong
                                  className="pos-line__purchase-title"
                                  title={line.productName}
                                >
                                  {line.productName}
                                </strong>
                                {line.sellUnit ? (
                                  <span className="pos-line__bulk-tag">
                                    {line.sellUnit} ({line.unitFactor})
                                  </span>
                                ) : null}
                              </div>
                              {roleOptions.length > 1 ? (
                                <div
                                  className="pos-purchase-role"
                                  role="group"
                                  aria-label={`Buy as for ${line.productName}`}
                                >
                                  {roleOptions.map((option) => (
                                    <button
                                      key={option.id}
                                      type="button"
                                      className={
                                        line.role === option.id
                                          ? "is-active"
                                          : undefined
                                      }
                                      aria-pressed={line.role === option.id}
                                      onClick={() =>
                                        updateLine(line.key, {
                                          role: option.id,
                                        })
                                      }
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <div className="pos-line__purchase-end">
                              <strong className="pos-line__purchase-total">
                                {lineTotal > 0 ? formatMoney(lineTotal) : "—"}
                              </strong>
                              <button
                                type="button"
                                className="pos-line__remove"
                                aria-label={`Remove ${line.productName}`}
                                onClick={() => removeLine(line.key)}
                              >
                                <i
                                  className="fa-solid fa-trash"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </div>

                          <div className="pos-line__purchase-bottom">
                            <div className="pos-line__prices">
                              <label className="pos-line__price-edit">
                                <span className="pos-line__price-label">Buy</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  required
                                  placeholder="0"
                                  value={line.unitCostInput}
                                  onChange={(e) =>
                                    updateLine(line.key, {
                                      unitCostInput: e.target.value,
                                      unitCost: Number(e.target.value) || 0,
                                    })
                                  }
                                  aria-label={`Buying price for ${line.productName}`}
                                />
                              </label>
                              {adjustSellingPrice &&
                              !restaurant &&
                              line.role !== "raw_material" ? (
                                <label
                                  className={`pos-line__price-edit${
                                    line.sellingPrice > 0 &&
                                    line.unitCost > 0 &&
                                    (line.sellingPrice * (line.unitFactor || 1)) < line.unitCost
                                      ? " has-error"
                                      : ""
                                  }`}
                                >
                                  <span className="pos-line__price-label">
                                    Sell
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={line.sellingPriceInput}
                                    onChange={(e) =>
                                      updateLine(line.key, {
                                        sellingPriceInput: e.target.value,
                                        sellingPrice:
                                          Number(e.target.value) || 0,
                                      })
                                    }
                                    aria-label={`Selling price for ${line.productName}`}
                                  />
                                  {line.sellingPrice > 0 &&
                                  line.unitCost > 0 &&
                                  (line.sellingPrice * (line.unitFactor || 1)) < line.unitCost ? (
                                    <i
                                      className="fa-solid fa-triangle-exclamation pos-line__price-alert"
                                      title="Selling price results in a loss based on bulk quantity"
                                    />
                                  ) : null}
                                </label>
                              ) : null}
                            </div>

                            <div className="pos-line__qty-group">
                              <div
                                className="pos-line__auto-pack"
                                style={{ display: "flex", alignItems: "center" }}
                              >
                                <button
                                  type="button"
                                  className={`pos-line__unit-chip${!line.sellUnit ? " is-active" : ""}`}
                                  onClick={() =>
                                    updateLine(line.key, { unitFactor: 1, sellUnit: null })
                                  }
                                >
                                  Single
                                </button>
                                <button
                                  type="button"
                                  className={`pos-line__unit-chip${line.sellUnit ? " is-active" : ""}`}
                                  onClick={() =>
                                    updateLine(line.key, {
                                      unitFactor: line.sellUnit
                                        ? line.unitFactor
                                        : line.autoPackFactor || 12,
                                      sellUnit: line.sellUnit || "Bulk",
                                    })
                                  }
                                >
                                  Bulk
                                </button>
                                {line.sellUnit === "Bulk" && line.unitFactor > 1 && (
                                  <input
                                    type="number"
                                    min={2}
                                    className="pos-line__pack-input"
                                    value={line.unitFactor}
                                    onChange={(e) =>
                                      updateLine(line.key, {
                                        unitFactor: Number(e.target.value) || 1,
                                      })
                                    }
                                    placeholder="Qty"
                                    title="Units per bulk"
                                  />
                                )}
                              </div>

                              <div className="pos-line__qty">
                                <button
                                  type="button"
                                  aria-label="Decrease quantity"
                                  onClick={() => changeQuantity(line.key, -1)}
                                >
                                  <i
                                    className="fa-solid fa-minus"
                                    aria-hidden="true"
                                  />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={line.quantity}
                                  onChange={(e) =>
                                    setQty(line.key, Number(e.target.value) || 0)
                                  }
                                  aria-label={`Quantity of ${line.productName}`}
                                />
                                <button
                                  type="button"
                                  aria-label="Increase quantity"
                                  onClick={() => changeQuantity(line.key, 1)}
                                >
                                  <i
                                    className="fa-solid fa-plus"
                                    aria-hidden="true"
                                  />
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </div>
            ) : null}
          </section>
          </div>

          <aside
            className={`pos-cart pos-cart--meta${
              isCartCollapsed ? " pos-cart--collapsed" : ""
            }`}
            aria-label="Supplier details"
          >
            {isCartCollapsed ? (
              <div
                className="pos-cart__collapsed-bar"
                onClick={toggleCartCollapsed}
                title="Expand supplier & payment details (Click to open)"
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
                  aria-label="Expand supplier details"
                  title="Expand supplier details"
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
                    <i className="fa-solid fa-truck-field" aria-hidden="true" />
                  </div>
                  <span className="pos-cart__count">
                    {itemCount === 0 ? "0" : `${itemCount}`}
                  </span>
                </div>

                <div className="pos-cart__collapsed-label">
                  <span>Supplier</span>
                </div>

                {purchaseTotal > 0 ? (
                  <div
                    className="pos-cart__collapsed-amount"
                    title={formatMoney(purchaseTotal)}
                  >
                    <span>{formatMoney(purchaseTotal)}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <header className="pos-cart__head">
                  <h2>
                    <i className="fa-solid fa-truck-field" aria-hidden="true" />
                    Supplier
                    <span className="pos-cart__count">
                      {itemCount === 0 ? "empty" : `${itemCount}`}
                    </span>
                  </h2>
                  <div className="pos-cart__actions">
                    {basket.length > 0 ? (
                      <button
                        type="button"
                        className="pos-cart__reset"
                        onClick={clearBasket}
                        title="Clear purchase"
                      >
                        <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pos-cart__collapse-btn"
                      onClick={toggleCartCollapsed}
                      title="Collapse supplier & payment details"
                      aria-label="Collapse supplier & payment details"
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

            <div className="pos-cart__body">
              <div className="pos-cart__row">
                <span className="pos-label">Supplier *</span>
                <div className="pos-purchase-supplier">
                  <TransChapSupplierField
                    id="purchase-supplier"
                    value={purchaseMeta.supplier}
                    disabled={saving}
                    required
                    onChange={(supplier) => patchPurchaseMeta({ supplier })}
                    onAddressChange={(supplierAddress) =>
                      patchPurchaseMeta({ supplierAddress })
                    }
                  />
                </div>
              </div>

              {purchaseMeta.supplierAddress.trim() ? (
                <div className="pos-cart__row">
                  <span className="pos-label">Address</span>
                  <p className="pos-cart__fixed-meta">
                    {purchaseMeta.supplierAddress}
                  </p>
                </div>
              ) : null}
            </div>

            <footer className="pos-cart__footer">
              <div className="pos-cart__row pos-cart__row--pay pos-cart__row--pay-full">
                <div
                  className="pos-pickers pos-pickers--three"
                  role="radiogroup"
                  aria-label="Purchase status"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={purchaseMeta.purchaseStatus === option.id}
                      className={`pos-picker pos-picker--wide${
                        purchaseMeta.purchaseStatus === option.id
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() =>
                        patchPurchaseMeta({ purchaseStatus: option.id })
                      }
                    >
                      <i className={option.icon} aria-hidden="true" />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pos-fields pos-fields--purchase">
                <input
                  type="text"
                  placeholder="Reference no (optional)"
                  value={purchaseMeta.referenceNo}
                  disabled={saving}
                  onChange={(e) =>
                    patchPurchaseMeta({ referenceNo: e.target.value })
                  }
                  aria-label="Reference number"
                />
                <input
                  type="datetime-local"
                  required
                  value={purchaseMeta.purchaseDate}
                  disabled={saving}
                  onChange={(e) =>
                    patchPurchaseMeta({ purchaseDate: e.target.value })
                  }
                  aria-label="Purchase date"
                />
                <input
                  type="text"
                  readOnly
                  value={purchaseMeta.businessLocation || "No location set"}
                  aria-label="Business location"
                />
                <div className="pos-purchase-pay-term">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Pay term"
                    value={purchaseMeta.payTerm}
                    disabled={saving}
                    onChange={(e) =>
                      patchPurchaseMeta({ payTerm: e.target.value })
                    }
                    aria-label="Pay term"
                  />
                  <select
                    value={purchaseMeta.payTermUnit}
                    disabled={saving}
                    onChange={(e) =>
                      patchPurchaseMeta({
                        payTermUnit: e.target.value as PurchaseMeta["payTermUnit"],
                      })
                    }
                    aria-label="Pay term unit"
                  >
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                  </select>
                </div>
              </div>

              <dl className="pos-totals">
                <div>
                  <dt>Lines</dt>
                  <dd>{basket.length}</dd>
                </div>
                <div className="pos-totals__grand">
                  <dt>Total</dt>
                  <dd>
                    {purchaseTotal > 0 ? formatMoney(purchaseTotal) : "—"}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                className="pos-place"
                onClick={() => void handleSubmit()}
                disabled={saving || basket.length === 0}
              >
                {saving ? (
                  <>
                    <i
                      className="fa-solid fa-spinner fa-spin"
                      aria-hidden="true"
                    />
                    Saving purchase…
                  </>
                ) : (
                  <>
                    <span className="pos-place__label">
                      <i className="fa-solid fa-check" aria-hidden="true" />
                      Save purchase
                    </span>
                    <span className="pos-place__total">
                      {purchaseTotal > 0 ? formatMoney(purchaseTotal) : "—"}
                    </span>
                  </>
                )}
              </button>
            </footer>
              </>
            )}
          </aside>

          {mobileScreen === "catalog" && basket.length > 0 ? (
            <div className="pos-mobile-cart-bar">
              <div className="pos-mobile-cart-bar__content">
                <div className="pos-mobile-cart-bar__info">
                  <span className="pos-mobile-cart-bar__badge">
                    <i className="fa-solid fa-cart-flatbed" aria-hidden="true" />
                    <span>{itemCount}</span>
                  </span>
                  <div className="pos-mobile-cart-bar__meta">
                    <span className="pos-mobile-cart-bar__title">
                      Current purchase
                    </span>
                    <span className="pos-mobile-cart-bar__total">
                      {formatMoney(purchaseTotal)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="pos-mobile-cart-bar__action"
                  onClick={() => {
                    setMobileScreen("supplier");
                    setIsCartCollapsed(false);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <span>Review Purchase</span>
                  <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <TransChapBuyProductModal
        open={buyModalOpen}
        initialName={buyModalName}
        onClose={() => setBuyModalOpen(false)}
        onSave={(draft) => {
          addNewProduct(draft.name, draft);
          setBuyModalOpen(false);
        }}
      />
    </>
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
