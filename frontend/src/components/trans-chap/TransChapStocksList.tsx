"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { apiFetch, apiFetchCached, readPageCache, writePageCache } from "@/lib/api";
import {
  getCachedInventory,
  setCachedInventory,
  updateCachedInventoryItem,
} from "@/lib/inventory-cache";
import { confirmAction, showError, showInternalError, toastSuccess, internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKesDigits, formatKsh } from "@/lib/trans-chap-receipt";
import {
  allowsFractionalSelling,
  allSellUnits,
  baseUnitName,
  formatGroupedQty,
  groupedQtyBreakdown,
  mergeFractionalIntoAttributes,
  mergeSellUnitsIntoAttributes,
  packUnits,
  type SellUnit,
} from "@/lib/sell-units";
import { useTransChapIsPhone } from "@/lib/trans-chap-list-view";
import {
  inventoryCoverUrl,
  inventoryProductName,
  inventoryRole,
  inventoryRoleLabel,
  isHotelMenuItem,
  updateInventoryActive,
  updateInventoryItem,
} from "@/lib/trans-chap-product";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapInventoryImportModal } from "@/components/trans-chap/TransChapInventoryImportModal";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { RestaurantKitchenRequests } from "@/components/trans-chap/restaurant/RestaurantKitchenRequests";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { useAuthUser } from "@/components/app/AuthProvider";
import { isRestaurantStore } from "@/lib/onboarding";
import { isKitchenIssuableRole } from "@/lib/restaurant-supplies";
import { isShopOwner } from "@/lib/merchant-permissions";
import type {
  InventoryItem,
  InventoryResponse,
  InventoryRole,
  SettingsResponse,
} from "@/lib/types";

type RoleFilter = "all" | InventoryRole;
type StocksView = "grid" | "list";

const STOCKS_VIEW_KEY = "trans-chap-stocks-view";
const STOCKS_CACHE_KEY = "trans-chap:stocks";

const BASE_ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "both", label: "Buy & sell" },
  { id: "for_sale", label: "Sell only" },
];

const RAW_ROLE_FILTER: { id: RoleFilter; label: string } = {
  id: "raw_material",
  label: "Raw",
};

function readStocksView(): StocksView {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(STOCKS_VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function stockBadge(
  item: InventoryItem,
  restaurant = false,
): { label: string; tone: "ok" | "wait" | "fail" } | undefined {
  if (restaurant) {
    if (inventoryRole(item) === "raw_material") {
      return { label: "RM", tone: "ok" };
    }
    return undefined;
  }
  if (!item.is_active || isHotelMenuItem(item)) return undefined;
  if (inventoryRole(item) === "raw_material") {
    return { label: "RM", tone: "ok" };
  }
  if (isOutOfStock(item)) {
    return { label: "Out", tone: "fail" };
  }
  if (item.is_low_stock) {
    return { label: "Low", tone: "wait" };
  }
  return undefined;
}

function isOutOfStock(item: InventoryItem): boolean {
  if (isHotelMenuItem(item)) return false;
  return item.stock_quantity != null && item.stock_quantity <= 0;
}

function stockQtyLabel(item: InventoryItem): string | undefined {
  if (isHotelMenuItem(item)) return undefined;
  if (item.stock_quantity == null) return "Qty —";
  return `Qty ${formatGroupedQty(item)}`;
}


export function TransChapStocksList() {
  const user = useAuthUser();
  const canEditQty = isShopOwner(user);
  const [allowQuantityAdjustment, setAllowQuantityAdjustment] = useState(true);
  const [allowPriceAdjustment, setAllowPriceAdjustment] = useState(false);
  const canAdjustQty = allowQuantityAdjustment;
  const canAdjustPrice = allowPriceAdjustment;
  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const roleFilters = restaurant
    ? [...BASE_ROLE_FILTERS, RAW_ROLE_FILTER]
    : BASE_ROLE_FILTERS;
  const buyHref = canEditQty
    ? "/trans-chap/purchases/new"
    : "/trans-chap/purchases/unavailable";
  const listId = useId();
  const initialCached = getCachedInventory();
  const [items, setItems] = useState<InventoryItem[]>(
    () => initialCached ?? readPageCache<InventoryItem[]>(STOCKS_CACHE_KEY) ?? [],
  );
  const hasLoadedOnceRef = useRef(Boolean((initialCached && initialCached.length > 0) || readPageCache(STOCKS_CACHE_KEY)));
  const [loading, setLoading] = useState(
    () => !hasLoadedOnceRef.current,
  );
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [outOnly, setOutOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [storedView, setView] = useState<StocksView>("grid");
  const view: StocksView = useTransChapIsPhone() ? "grid" : storedView;
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [qtySavingId, setQtySavingId] = useState<string | null>(null);
  const [bulkFactorDrafts, setBulkFactorDrafts] = useState<Record<string, string>>({});
  const [bulkFactorSavingId, setBulkFactorSavingId] = useState<string | null>(null);
  const [bulkQtyDrafts, setBulkQtyDrafts] = useState<Record<string, string>>({});
  const [bulkQtySavingId, setBulkQtySavingId] = useState<string | null>(null);
  const [bpSingleDrafts, setBpSingleDrafts] = useState<Record<string, string>>({});
  const [spSingleDrafts, setSpSingleDrafts] = useState<Record<string, string>>({});
  const [bpBulkDrafts, setBpBulkDrafts] = useState<Record<string, string>>({});
  const [spBulkDrafts, setSpBulkDrafts] = useState<Record<string, string>>({});
  const [priceSavingKey, setPriceSavingKey] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    setView(readStocksView());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<SettingsResponse>(apiRoutes.settings)
      .then((data) => {
        if (!cancelled) {
          setAllowQuantityAdjustment(data.allow_item_quantity_adjustment ?? true);
          setAllowPriceAdjustment(data.allow_price_adjustment ?? false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllowQuantityAdjustment(true);
          setAllowPriceAdjustment(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void apiFetch<SettingsResponse>(apiRoutes.settings)
        .then((data) => {
          setAllowQuantityAdjustment(data.allow_item_quantity_adjustment ?? true);
          setAllowPriceAdjustment(data.allow_price_adjustment ?? false);
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function setStocksView(next: StocksView) {
    setView(next);
    try {
      window.localStorage.setItem(STOCKS_VIEW_KEY, next);
    } catch {
      /* ignore quota / private mode */
    }
  }

  const reload = useCallback(async () => {
    // Once initial data is loaded, disable ANY loading effect for the page!
    if (!hasLoadedOnceRef.current && items.length === 0) {
      setLoading(true);
    }
    try {
      const data = await apiFetch<InventoryResponse>(
        `${apiRoutes.inventory}?active=true`,
      );
      setItems(data.data);
      setCachedInventory(data.data);
      writePageCache(STOCKS_CACHE_KEY, data.data);
      hasLoadedOnceRef.current = true;
      setError(null);
    } catch {
      if (!hasLoadedOnceRef.current && items.length === 0) {
        setError(internalErrorMessage());
      }
    } finally {
      setLoading(false);
    }
  }, [items.length]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!restaurant) {
      if (roleFilter === "raw_material") setRoleFilter("all");
    }
  }, [restaurant, roleFilter]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!item.is_active) return false;
      // In store inventory, exclude menu dishes entirely — meals belong on the Menu page
      if (restaurant && isHotelMenuItem(item)) return false;

      if (!restaurant) {
        if (outOnly && !isOutOfStock(item)) return false;
        if (roleFilter !== "all" && inventoryRole(item) !== roleFilter) return false;
      }
      if (outOnly && !isOutOfStock(item)) return false;
      if (!needle) return true;
      const name = inventoryProductName(item).toLowerCase();
      const sku = (item.product?.sku || item.product?.product_code || "").toLowerCase();
      const location = (item.location || "").toLowerCase();
      const supplier = (item.supplier || "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        location.includes(needle) ||
        supplier.includes(needle)
      );
    });
  }, [items, outOnly, query, restaurant, roleFilter]);

  const outOfStockFiltered = useMemo(
    () => filtered.filter((item) => (isHotelMenuItem(item) ? false : isOutOfStock(item))),
    [filtered],
  );

  const STOCKS_PAGE_SIZE = 40;
  const [visibleCount, setVisibleCount] = useState(STOCKS_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(STOCKS_PAGE_SIZE);
  }, [query, roleFilter, outOnly, view]);

  const visibleFiltered = useMemo(() => {
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount]);

  const stocksSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    const target = stocksSentinelRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + STOCKS_PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: "400px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  const applyUpdatedItem = useCallback((updated: InventoryItem) => {
    setItems((prev) => {
      const next = prev.map((row) => (row.id === updated.id ? updated : row));
      setCachedInventory(next);
      writePageCache(STOCKS_CACHE_KEY, next);
      return next;
    });
    updateCachedInventoryItem(updated);
  }, []);

  async function toggleActive(item: InventoryItem) {
    if (savingId || selecting) return;
    const next = !item.is_active;
    setSavingId(item.id);
    try {
      const updated = await updateInventoryActive(item.id, next);
      setItems((prev) => {
        const nextItems = next
          ? prev.map((row) => (row.id === updated.id ? updated : row))
          : prev.filter((row) => row.id !== updated.id);
        setCachedInventory(nextItems);
        writePageCache(STOCKS_CACHE_KEY, nextItems);
        return nextItems;
      });
      updateCachedInventoryItem(updated);
      if (openId === item.id) setOpenId(null);
      await toastSuccess(next ? "Item enabled" : "Item disabled");
    } catch {
      await showInternalError();
    } finally {
      setSavingId(null);
    }
  }

  async function toggleFractional(item: InventoryItem) {
    if (savingId || selecting) return;
    const next = !allowsFractionalSelling(item);
    const nextAttrs = mergeFractionalIntoAttributes(item.attributes, next);
    setSavingId(item.id);
    try {
      const updated = await updateInventoryItem(item.id, {
        attributes: nextAttrs,
      });
      applyUpdatedItem(updated);
      await toastSuccess(
        next
          ? "Fractional selling (1/4, 1/2, 3/4, Full) enabled"
          : "Fractional selling disabled",
      );
    } catch {
      await showInternalError();
    } finally {
      setSavingId(null);
    }
  }

  function qtyDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(qtyDrafts, item.id)) {
      return qtyDrafts[item.id] ?? "";
    }
    return item.stock_quantity == null ? "" : String(item.stock_quantity);
  }

  async function saveQty(item: InventoryItem) {
    if (!canAdjustQty || isHotelMenuItem(item) || qtySavingId === item.id || selecting) return;
    const raw = qtyDraftValue(item).trim();
    if (raw === "") {
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      await showError("Invalid quantity", "Enter a whole number 0 or higher.");
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    if (item.stock_quantity === parsed) {
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    setQtySavingId(item.id);
    try {
      const updated = await updateInventoryItem(item.id, { stock_quantity: parsed });
      applyUpdatedItem(updated);
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess("Quantity updated");
    } catch {
      await showInternalError();
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setQtySavingId(null);
    }
  }

  function bulkFactorDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(bulkFactorDrafts, item.id)) {
      return bulkFactorDrafts[item.id] ?? "";
    }
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    return bulkUnit ? String(bulkUnit.factor) : "";
  }

  async function saveBulkFactor(item: InventoryItem) {
    if (isHotelMenuItem(item) || bulkFactorSavingId === item.id || selecting) return;
    const raw = bulkFactorDraftValue(item).trim();
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    const currentFactor = bulkUnit?.factor ?? null;

    if (raw === "") {
      if (currentFactor == null) {
        setBulkFactorDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        return;
      }
      const existingPacks = packUnits(item);
      const remainingPacks = existingPacks.filter((p) => p.name !== bulkUnit?.name);
      const nextAttrs = mergeSellUnitsIntoAttributes(item.attributes, remainingPacks);
      setBulkFactorSavingId(item.id);
      try {
        const updated = await updateInventoryItem(item.id, { attributes: nextAttrs });
        applyUpdatedItem(updated);
        setBulkFactorDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        await toastSuccess("Bulk unit removed");
      } catch {
        await showInternalError();
        setBulkFactorDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } finally {
        setBulkFactorSavingId(null);
      }
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 2) {
      await showError("Invalid bulk quantity", "Enter a whole number of 2 or higher (or clear to remove bulk pack).");
      setBulkFactorDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    if (currentFactor === parsed) {
      setBulkFactorDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    const existingPacks = packUnits(item);
    let updatedPacks: SellUnit[];
    if (bulkUnit && existingPacks.some((p) => p.name === bulkUnit.name)) {
      updatedPacks = existingPacks.map((pack) => {
        if (pack.name === bulkUnit.name) {
          return { ...pack, factor: parsed };
        }
        return pack;
      });
    } else {
      updatedPacks = [
        ...existingPacks,
        {
          name: "Bulk",
          factor: parsed,
        },
      ];
    }

    const nextAttrs = mergeSellUnitsIntoAttributes(item.attributes, updatedPacks);
    setBulkFactorSavingId(item.id);
    try {
      const updated = await updateInventoryItem(item.id, { attributes: nextAttrs });
      applyUpdatedItem(updated);
      setBulkFactorDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess("Bulk quantity updated");
    } catch {
      await showInternalError();
      setBulkFactorDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setBulkFactorSavingId(null);
    }
  }

  function bulkQtyDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(bulkQtyDrafts, item.id)) {
      return bulkQtyDrafts[item.id] ?? "";
    }
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    if (!bulkUnit || bulkUnit.factor < 2 || item.stock_quantity == null) return "";
    return String(Math.floor(item.stock_quantity / bulkUnit.factor));
  }

  async function saveBulkQty(item: InventoryItem) {
    if (!canAdjustQty || isHotelMenuItem(item) || bulkQtySavingId === item.id || selecting) return;
    const raw = bulkQtyDraftValue(item).trim();
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    if (!bulkUnit || bulkUnit.factor < 2) return;

    if (raw === "") {
      setBulkQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      await showError("Invalid bulk quantity", "Enter a whole number 0 or higher.");
      setBulkQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    const currentTotal = item.stock_quantity ?? 0;
    const currentBulk = Math.floor(currentTotal / bulkUnit.factor);
    if (currentBulk === parsed) {
      setBulkQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    const remainder = currentTotal >= 0 ? currentTotal % bulkUnit.factor : 0;
    const newTotal = parsed * bulkUnit.factor + remainder;

    setBulkQtySavingId(item.id);
    try {
      const updated = await updateInventoryItem(item.id, { stock_quantity: newTotal });
      applyUpdatedItem(updated);
      setBulkQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess("Bulk quantity updated");
    } catch {
      await showInternalError();
      setBulkQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setBulkQtySavingId(null);
    }
  }

  function bpSingleDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(bpSingleDrafts, item.id)) {
      return bpSingleDrafts[item.id] ?? "";
    }
    const units = allSellUnits(item);
    const singleUnit = units[0];
    return singleUnit?.buying_price != null ? String(singleUnit.buying_price) : "";
  }

  async function saveBpSingle(item: InventoryItem) {
    if (!canAdjustPrice || isHotelMenuItem(item) || priceSavingKey === `${item.id}:bp_single` || selecting) return;
    const raw = bpSingleDraftValue(item).trim();
    const current = item.buying_price ?? null;

    if (raw === "") {
      if (current == null) {
        setBpSingleDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        return;
      }
      setPriceSavingKey(`${item.id}:bp_single`);
      try {
        const updated = await updateInventoryItem(item.id, { buying_price: null });
        applyUpdatedItem(updated);
        setBpSingleDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        await toastSuccess("Buying price cleared");
      } catch {
        await showInternalError();
        setBpSingleDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } finally {
        setPriceSavingKey(null);
      }
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      await showError("Invalid price", "Enter a valid positive number.");
      setBpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    if (current === parsed) {
      setBpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    setPriceSavingKey(`${item.id}:bp_single`);
    try {
      const updated = await updateInventoryItem(item.id, { buying_price: parsed });
      applyUpdatedItem(updated);
      setBpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess("Buying price updated");
    } catch {
      await showInternalError();
      setBpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setPriceSavingKey(null);
    }
  }

  function spSingleDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(spSingleDrafts, item.id)) {
      return spSingleDrafts[item.id] ?? "";
    }
    const units = allSellUnits(item);
    const singleUnit = units[0];
    return singleUnit?.selling_price != null ? String(singleUnit.selling_price) : "";
  }

  async function saveSpSingle(item: InventoryItem) {
    if (!canAdjustPrice || isHotelMenuItem(item) || priceSavingKey === `${item.id}:sp_single` || selecting) return;
    const raw = spSingleDraftValue(item).trim();
    const current = item.selling_price ?? null;

    if (raw === "") {
      if (current == null) {
        setSpSingleDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        return;
      }
      setPriceSavingKey(`${item.id}:sp_single`);
      try {
        const updated = await updateInventoryItem(item.id, { selling_price: null });
        applyUpdatedItem(updated);
        setSpSingleDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        await toastSuccess("Selling price cleared");
      } catch {
        await showInternalError();
        setSpSingleDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } finally {
        setPriceSavingKey(null);
      }
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      await showError("Invalid price", "Enter a valid positive number.");
      setSpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    if (current === parsed) {
      setSpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    setPriceSavingKey(`${item.id}:sp_single`);
    try {
      const updated = await updateInventoryItem(item.id, { selling_price: parsed });
      applyUpdatedItem(updated);
      setSpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess("Selling price updated");
    } catch {
      await showInternalError();
      setSpSingleDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setPriceSavingKey(null);
    }
  }

  function bpBulkDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(bpBulkDrafts, item.id)) {
      return bpBulkDrafts[item.id] ?? "";
    }
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    return bulkUnit?.buying_price != null ? String(bulkUnit.buying_price) : "";
  }

  function spBulkDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(spBulkDrafts, item.id)) {
      return spBulkDrafts[item.id] ?? "";
    }
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    return bulkUnit?.selling_price != null ? String(bulkUnit.selling_price) : "";
  }

  async function saveBulkPrice(
    item: InventoryItem,
    kind: "buying_price" | "selling_price",
  ) {
    const isBp = kind === "buying_price";
    const savingKey = `${item.id}:${isBp ? "bp_bulk" : "sp_bulk"}`;
    if (!canAdjustPrice || isHotelMenuItem(item) || priceSavingKey === savingKey || selecting) return;

    const raw = (isBp ? bpBulkDraftValue(item) : spBulkDraftValue(item)).trim();
    const setDrafts = isBp ? setBpBulkDrafts : setSpBulkDrafts;
    const units = allSellUnits(item);
    const bulkUnit =
      units.length > 1
        ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
        : null;
    if (!bulkUnit || bulkUnit.factor < 2) return;

    const currentPrice = bulkUnit[kind] ?? null;

    if (raw === "") {
      if (currentPrice == null) {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        return;
      }
      const existingPacks = packUnits(item);
      const updatedPacks = (existingPacks.length ? existingPacks : [{ name: bulkUnit.name, factor: bulkUnit.factor }]).map((p) => {
        if (p.name === bulkUnit.name) {
          const copy = { ...p };
          delete copy[kind];
          return copy;
        }
        return p;
      });
      const nextAttrs = mergeSellUnitsIntoAttributes(item.attributes, updatedPacks);
      setPriceSavingKey(savingKey);
      try {
        const updated = await updateInventoryItem(item.id, { attributes: nextAttrs });
        applyUpdatedItem(updated);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        await toastSuccess(isBp ? "Bulk buying price cleared" : "Bulk selling price cleared");
      } catch {
        await showInternalError();
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } finally {
        setPriceSavingKey(null);
      }
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      await showError("Invalid price", "Enter a valid positive number.");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    if (currentPrice === parsed) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    const existingPacks = packUnits(item);
    let updatedPacks: SellUnit[];
    if (existingPacks.some((p) => p.name === bulkUnit.name)) {
      updatedPacks = existingPacks.map((p) => {
        if (p.name === bulkUnit.name) {
          return { ...p, [kind]: parsed };
        }
        return p;
      });
    } else {
      updatedPacks = [
        ...existingPacks,
        {
          name: bulkUnit.name,
          factor: bulkUnit.factor,
          [kind]: parsed,
        },
      ];
    }

    const nextAttrs = mergeSellUnitsIntoAttributes(item.attributes, updatedPacks);
    setPriceSavingKey(savingKey);
    try {
      const updated = await updateInventoryItem(item.id, { attributes: nextAttrs });
      applyUpdatedItem(updated);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess(isBp ? "Bulk buying price updated" : "Bulk selling price updated");
    } catch {
      await showInternalError();
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setPriceSavingKey(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSelecting() {
    setOpenId(null);
    setSelecting(true);
    setSelectedIds(new Set());
  }

  function stopSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  function selectFiltered() {
    setSelectedIds(new Set(filtered.map((item) => item.id)));
  }

  function selectOutOfStock() {
    setSelectedIds(new Set(outOfStockFiltered.map((item) => item.id)));
  }

  const issuableSelectedIds = restaurant
    ? items
        .filter(
          (item) =>
            selectedIds.has(item.id) &&
            item.stock_quantity != null &&
            isKitchenIssuableRole(inventoryRole(item)),
        )
        .map((item) => item.id)
    : [];

  async function disableSelected() {
    const targets = filtered.filter(
      (item) => selectedIds.has(item.id) && item.is_active,
    );
    if (!targets.length || bulkSaving) return;
    const ok = await confirmAction(
      `Disable ${targets.length} item${targets.length === 1 ? "" : "s"}?`,
      "They won’t show in New sale until you turn them back on.",
      "Disable",
    );
    if (!ok) return;
    setBulkSaving(true);
    try {
      const results = await Promise.allSettled(
        targets.map((item) => updateInventoryActive(item.id, false)),
      );
      const updated = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.length - updated.length;
      if (updated.length) {
        const disabledIds = new Set(updated.map((item) => item.id));
        setItems((prev) => prev.filter((row) => !disabledIds.has(row.id)));
      }
      if (failed) {
        await showError(
          "Could not disable all items",
          `${failed} item${failed === 1 ? "" : "s"} failed. Try again.`,
        );
        return;
      }
      await toastSuccess(
        targets.length === 1 ? "Item disabled" : `${targets.length} items disabled`,
      );
      stopSelecting();
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className={`trans-chap-sales${view === "list" ? " trans-chap-sales--list" : ""}`}>
      <div className="trans-chap-sales__filters">
        <div className="trans-chap-sales__search-row">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder={
                restaurant
                  ? "Search store inventory & supplies…"
                  : "Search stock…"
              }
              aria-label={restaurant ? "Search store inventory" : "Search stock"}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="trans-chap-sales__view" role="group" aria-label="Stock layout">
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${view === "grid" ? " is-on" : ""}`}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setStocksView("grid")}
            >
              <i className="fa-solid fa-table-cells" aria-hidden />
            </button>
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${view === "list" ? " is-on" : ""}`}
              aria-pressed={view === "list"}
              aria-label="List view"
              title="List view"
              onClick={() => setStocksView("list")}
            >
              <i className="fa-solid fa-list" aria-hidden />
            </button>
          </div>
          {!restaurant ? (
            <button
              type="button"
              className={`trans-chap-sales__chip${outOnly ? " is-active" : ""}`}
              aria-pressed={outOnly}
              onClick={() => setOutOnly((value) => !value)}
            >
              Out of stock
            </button>
          ) : null}
          {items.length ? (
            <button
              type="button"
              className={`trans-chap-sales__chip${selecting ? " is-active" : ""}`}
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : startSelecting())}
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : null}
          {restaurant ? (
            <Link
              href="/trans-chap/purchases/issue?new=1&from=store"
              className="trans-chap-sales__chip trans-chap-sales__chip--issue"
              title="Hand supplies from the store to the kitchen"
            >
              <i className="fa-solid fa-dolly" style={{ marginRight: "0.35rem" }} aria-hidden />
              Issue<span className="trans-chap-sales__chip-extra">&nbsp;to kitchen</span>
            </Link>
          ) : (
            <Link
              href="/trans-chap/stocks/quotation"
              className="trans-chap-sales__chip trans-chap-sales__chip--quotation"
              title="Create quotation and send via WhatsApp"
              id="stocks-quotation-chip"
            >
              <i className="fa-brands fa-whatsapp" style={{ marginRight: "0.35rem", color: "#25D366" }} aria-hidden />
              Quotation
            </Link>
          )}
        </div>
        {!restaurant ? (
          <div className="trans-chap-sales__chips" role="group" aria-label="Stock type">
            {roleFilters.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={`trans-chap-sales__chip${roleFilter === chip.id ? " is-active" : ""}`}
                aria-pressed={roleFilter === chip.id}
                onClick={() => setRoleFilter(chip.id)}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className="trans-chap-sales__chip"
              onClick={() => setImportModalOpen(true)}
              title="Import inventory from Excel or CSV file"
            >
              <i className="fa-solid fa-file-import" style={{ marginRight: "0.35rem" }} aria-hidden />
              Import
            </button>
          </div>
        ) : null}
      </div>
      <div className="trans-chap-sales__list">
        {restaurant ? <RestaurantKitchenRequests /> : null}
        {loading && items.length === 0 ? (
          <TransChapListSkeleton />
        ) : error && items.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : items.length === 0 ? (
          <TransChapStatus
            actionHref={restaurant ? "/trans-chap/purchases/new?mode=select" : buyHref}
            actionLabel={restaurant ? "Buy supplies" : "Record a purchase"}
          >
            {restaurant
              ? "No store inventory yet. Record supplies and ingredients when you buy them."
              : "No stock yet. Add products when you buy them."}
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {restaurant
              ? "No store inventory items match this search."
              : outOnly
                ? "No out-of-stock products match this search."
                : roleFilter !== "all"
                  ? `No ${inventoryRoleLabel(roleFilter).toLowerCase()} items match this search.`
                  : "No products match this search."}
          </p>
        ) : view === "list" ? (
          <div className="trans-chap-stock-table-wrap trans-chap-stock-table-wrap--cards trans-chap-stock-table-wrap--stock">
            <table className="trans-chap-stock-table trans-chap-stock-table--cards trans-chap-stock-table--stock">
              <thead>
                <tr>
                  {selecting ? <th className="trans-chap-stock-table__check" scope="col"> </th> : null}
                  <th scope="col">Product</th>
                  <th className="trans-chap-stock-table__qty" scope="col" title="Quantity per 1 bulk pack">
                    Qty per 1 Bulk
                  </th>
                  <th scope="col">Unit</th>
                  <th className="trans-chap-stock-table__qty" scope="col" title="Quantity in single units">
                    Qty single
                  </th>
                  <th className="trans-chap-stock-table__qty" scope="col" title="Quantity in bulk packs">
                    Qty bulk
                  </th>
                  <th className="trans-chap-stock-table__money" scope="col" title="Buying price, single">BP single</th>
                  <th className="trans-chap-stock-table__money" scope="col" title="Selling price, single">SP single</th>
                  <th className="trans-chap-stock-table__money" scope="col" title="Buying price, bulk">BP bulk</th>
                  <th className="trans-chap-stock-table__money" scope="col" title="Selling price, bulk">SP bulk</th>
                  <th className="trans-chap-stock-table__money" scope="col" title="Markup, single">Mkup single</th>
                  <th className="trans-chap-stock-table__money" scope="col" title="Markup, bulk">Mkup bulk</th>
                  <th scope="col" title="Enable 1/4, 1/2, 3/4, Full fractional selling">1/4 · 1/2</th>
                  <th scope="col">Active</th>
                  <th className="trans-chap-stock-table__actions" scope="col">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleFiltered.map((item) => {
                  const name = inventoryProductName(item);
                  const hotel = isHotelMenuItem(item);
                  const picked = selectedIds.has(item.id);
                  const units = allSellUnits(item);
                  const singleUnit = units[0];
                  const bulkUnit =
                    units.length > 1
                      ? units.slice(1).reduce((best, unit) => (unit.factor > best.factor ? unit : best))
                      : null;
                  const bulkQty =
                    !hotel && bulkUnit && item.stock_quantity != null
                      ? Math.floor(item.stock_quantity / bulkUnit.factor)
                      : null;
                  const priceText = (value: number | null | undefined) =>
                    hotel || value == null || !Number.isFinite(value)
                      ? "—"
                      : Math.round(value).toLocaleString("en-KE");
                  const markupText = (sell: number | null | undefined, buy: number | null | undefined) =>
                    hotel || sell == null || buy == null || !Number.isFinite(sell) || !Number.isFinite(buy)
                      ? "—"
                      : formatKesDigits(sell - buy);
                  const sku =
                    item.product?.sku?.trim() ||
                    item.product?.product_code?.trim() ||
                    "—";
                  const unit = item.product?.unit?.trim() || "—";
                  const qtyHint =
                    !hotel && canAdjustQty && groupedQtyBreakdown(item)
                      ? `${groupedQtyBreakdown(item)} · qty in ${baseUnitName(item)}`
                      : undefined;
                  return (
                    <tr
                      key={item.id}
                      className={`${!item.is_active ? "is-inactive" : ""}${picked ? " is-picked" : ""}`}
                    >
                      {selecting ? (
                        <td className="trans-chap-stock-table__check">
                          <button
                            type="button"
                            role="checkbox"
                            className={`trans-chap-panel__check${picked ? " is-on" : ""}`}
                            aria-checked={picked}
                            aria-label={`${picked ? "Unselect" : "Select"} ${name}`}
                            onClick={() => toggleSelected(item.id)}
                          >
                            {picked ? <i className="fa-solid fa-check" aria-hidden /> : null}
                          </button>
                        </td>
                      ) : null}
                      <td className="trans-chap-stock-table__product">
                        <div className="trans-chap-stock-table__product-inner">
                          <TransChapProductThumb
                            src={inventoryCoverUrl(item)}
                            name={name}
                            size="sm"
                          />
                          <span title={name}>{name}</span>
                        </div>
                      </td>
                      <td
                        className="trans-chap-stock-table__qty"
                        title={
                          bulkUnit
                            ? `${bulkUnit.factor} ${item.product?.unit?.trim() || "units"} per ${bulkUnit.name}`
                            : undefined
                        }
                      >
                        {hotel ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustQty ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Qty per 1 Bulk</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={2}
                              step={1}
                              placeholder="—"
                              value={bulkFactorDraftValue(item)}
                              disabled={bulkFactorSavingId === item.id}
                              aria-label={`Quantity per 1 bulk for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setBulkFactorDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveBulkFactor(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setBulkFactorDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__mono">
                            {bulkUnit ? bulkUnit.factor : "—"}
                          </span>
                        )}
                      </td>
                      <td>{unit}</td>
                      <td className="trans-chap-stock-table__qty" title={qtyHint}>
                        {hotel ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustQty ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Qty</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              value={qtyDraftValue(item)}
                              disabled={qtySavingId === item.id}
                              aria-label={`Quantity for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setQtyDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveQty(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setQtyDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__mono">
                            {formatGroupedQty(item)}
                          </span>
                        )}
                      </td>
                      <td
                        className="trans-chap-stock-table__qty"
                        title={bulkUnit ? `${bulkUnit.name} of ${bulkUnit.factor}` : "No bulk pack"}
                      >
                        {hotel || !bulkUnit ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustQty ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Qty bulk</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              placeholder="—"
                              value={bulkQtyDraftValue(item)}
                              disabled={bulkQtySavingId === item.id}
                              aria-label={`Bulk quantity for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setBulkQtyDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveBulkQty(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setBulkQtyDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__mono">
                            {bulkQty == null ? "—" : bulkQty}
                          </span>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__money">
                        {hotel ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustPrice ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">BP single</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              placeholder="—"
                              value={bpSingleDraftValue(item)}
                              disabled={priceSavingKey === `${item.id}:bp_single`}
                              aria-label={`Buying price single for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setBpSingleDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveBpSingle(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setBpSingleDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__mono">{priceText(singleUnit?.buying_price)}</span>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__money">
                        {hotel ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustPrice ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">SP single</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              placeholder="—"
                              value={spSingleDraftValue(item)}
                              disabled={priceSavingKey === `${item.id}:sp_single`}
                              aria-label={`Selling price single for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSpSingleDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveSpSingle(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setSpSingleDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__strong">{priceText(singleUnit?.selling_price)}</span>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__money">
                        {hotel || !bulkUnit ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustPrice ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">BP bulk</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              placeholder="—"
                              value={bpBulkDraftValue(item)}
                              disabled={priceSavingKey === `${item.id}:bp_bulk`}
                              aria-label={`Buying price bulk for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setBpBulkDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveBulkPrice(item, "buying_price")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setBpBulkDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__mono">{priceText(bulkUnit?.buying_price)}</span>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__money">
                        {hotel || !bulkUnit ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canAdjustPrice ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">SP bulk</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              placeholder="—"
                              value={spBulkDraftValue(item)}
                              disabled={priceSavingKey === `${item.id}:sp_bulk`}
                              aria-label={`Selling price bulk for ${name}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSpBulkDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveBulkPrice(item, "selling_price")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setSpBulkDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__strong">{priceText(bulkUnit?.selling_price)}</span>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__money">
                        <span className="trans-chap-stock-table__mono">{markupText(singleUnit?.selling_price, singleUnit?.buying_price)}</span>
                      </td>
                      <td className="trans-chap-stock-table__money">
                        <span className="trans-chap-stock-table__mono">{markupText(bulkUnit?.selling_price, bulkUnit?.buying_price)}</span>
                      </td>
                      <td>
                        {selecting || inventoryRole(item) === "raw_material" ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : (
                          <button
                            type="button"
                            role="switch"
                            className={`theme-switch trans-chap-panel__switch${allowsFractionalSelling(item) ? " is-on" : ""}`}
                            aria-checked={allowsFractionalSelling(item)}
                            aria-label={
                              allowsFractionalSelling(item)
                                ? `Disable fractional selling (1/4, 1/2, 3/4) for ${name}`
                                : `Enable fractional selling (1/4, 1/2, 3/4) for ${name}`
                            }
                            title="Allow selling 1/4, 1/2, 3/4, and Full portions on POS"
                            disabled={savingId === item.id}
                            onClick={() => void toggleFractional(item)}
                          >
                            <span className="theme-switch__thumb" aria-hidden />
                          </button>
                        )}
                      </td>
                      <td>
                        {selecting ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : (
                          <button
                            type="button"
                            role="switch"
                            className={`theme-switch trans-chap-panel__switch${item.is_active ? " is-on" : ""}`}
                            aria-checked={item.is_active}
                            aria-label={
                              item.is_active ? `Disable ${name}` : `Enable ${name}`
                            }
                            disabled={savingId === item.id}
                            onClick={() => void toggleActive(item)}
                          >
                            <span className="theme-switch__thumb" aria-hidden />
                          </button>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__actions">
                        <div className="trans-chap-stock-table__actions-inner">
                          <Link
                            href={`/trans-chap/stocks/edit?id=${encodeURIComponent(item.id)}`}
                            className="trans-chap-stock-table__icon-btn"
                            title={hotel || item.selling_price != null ? `Edit ${name}` : `Set price for ${name}`}
                            aria-label={hotel || item.selling_price != null ? `Edit ${name}` : `Set price for ${name}`}
                          >
                            <i className="fa-solid fa-pen" aria-hidden />
                          </Link>
                          {restaurant && isKitchenIssuableRole(inventoryRole(item)) ? (
                            <Link
                              href={`/trans-chap/purchases/issue?new=1&from=store&items=${encodeURIComponent(item.id)}`}
                              className="trans-chap-stock-table__icon-btn"
                              style={{ color: "var(--app-primary)" }}
                              title={`Release ${name} to the kitchen`}
                              aria-label={`Release ${name} to the kitchen`}
                            >
                              <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden />
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
          {visibleFiltered.map((item) => {
            const name = inventoryProductName(item);
            const hotel = isHotelMenuItem(item);
            const picked = selectedIds.has(item.id);
            const open = !selecting && openId === item.id;
            const panelId = `${listId}-${item.id}`;
            const price =
              item.selling_price != null ? formatKsh(item.selling_price) : "—";
            return (
              <MotionItem key={item.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="stock"
                title={name}
                imageUrl={inventoryCoverUrl(item)}
                qty={hotel || canAdjustQty ? undefined : stockQtyLabel(item)}
                price={price}
                badge={stockBadge(item, restaurant)}
                inactive={!item.is_active}
                picking={selecting}
                picked={picked}
                onToggle={() =>
                  selecting
                    ? toggleSelected(item.id)
                    : setOpenId(open ? null : item.id)
                }
                midAction={
                  selecting || hotel || !canAdjustQty ? null : (
                    <label className="trans-chap-panel__qty-edit">
                      <span>Qty</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={qtyDraftValue(item)}
                        disabled={qtySavingId === item.id}
                        aria-label={`Quantity for ${name}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const value = event.target.value;
                          setQtyDrafts((prev) => ({ ...prev, [item.id]: value }));
                        }}
                        onBlur={() => void saveQty(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            (event.target as HTMLInputElement).blur();
                          }
                          if (event.key === "Escape") {
                            setQtyDrafts((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                            (event.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </label>
                  )
                }
                headAction={
                  selecting ? (
                    <button
                      type="button"
                      role="checkbox"
                      className={`trans-chap-panel__check${picked ? " is-on" : ""}`}
                      aria-checked={picked}
                      aria-label={`${picked ? "Unselect" : "Select"} ${name}`}
                      onClick={() => toggleSelected(item.id)}
                    >
                      {picked ? <i className="fa-solid fa-check" aria-hidden /> : null}
                    </button>
                  ) : (
                    <div className="trans-chap-panel__availability">
                      <span>{item.is_active ? "Active" : "Off"}</span>
                      <button
                        type="button"
                        role="switch"
                        className={`theme-switch trans-chap-panel__switch${item.is_active ? " is-on" : ""}`}
                        aria-checked={item.is_active}
                        aria-label={item.is_active ? `Disable ${name}` : `Enable ${name}`}
                        disabled={savingId === item.id}
                        onClick={() => void toggleActive(item)}
                      >
                        <span className="theme-switch__thumb" aria-hidden />
                      </button>
                    </div>
                  )
                }
                action={
                  <>
                    <Link
                      href={`/trans-chap/stocks/edit?id=${encodeURIComponent(item.id)}`}
                      className="trans-chap-panel__link trans-chap-panel__icon-action"
                      title={hotel ? `Edit ${name}` : `Edit ${name} and its unit of measure`}
                      aria-label={hotel ? `Edit ${name}` : `Edit ${name} and its unit of measure`}
                    >
                      <i className="fa-solid fa-pen" aria-hidden />
                    </Link>
                    {restaurant && isKitchenIssuableRole(inventoryRole(item)) ? (
                      <Link
                        href={`/trans-chap/purchases/issue?new=1&from=store&items=${encodeURIComponent(item.id)}`}
                        className="trans-chap-panel__link trans-chap-panel__icon-action"
                        title={`Release ${name} to the kitchen`}
                        aria-label={`Release ${name} to the kitchen`}
                        style={{ color: "var(--app-primary)", fontWeight: 750 }}
                      >
                        <i className="fa-solid fa-dolly" aria-hidden />
                      </Link>
                    ) : null}
                  </>
                }
              >
                <dl className="trans-chap-panel__facts">
                  {hotel ? null : (
                    <div>
                      <dt>On hand</dt>
                      <dd>
                        {item.stock_quantity == null
                          ? "Not tracked"
                          : `${formatGroupedQty(item)}${groupedQtyBreakdown(item) ? "" : ` ${baseUnitName(item)}`}`}
                      </dd>
                    </div>
                  )}
                  {hotel ? null : (
                    <div>
                      <dt>Unit of measure</dt>
                      <dd>
                        <div>{baseUnitName(item)}</div>
                        {packUnits(item).map((unit) => (
                          <div key={unit.name} className="trans-chap-panel__unit-conversion">
                            <span>1 {unit.name} = {unit.factor} {baseUnitName(item)}</span>
                            <span>{unit.factor} {baseUnitName(item)} = 1 {unit.name}</span>
                          </div>
                        ))}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {restaurant && hotel
                        ? "Hotel menu"
                        : inventoryRoleLabel(inventoryRole(item))}
                    </dd>
                  </div>
                  <div>
                    <dt>Selling price</dt>
                    <dd>{price}</dd>
                  </div>
                  {hotel ? null : (
                    <div>
                      <dt>Buying price</dt>
                      <dd>
                        {item.buying_price != null
                          ? formatKsh(item.buying_price)
                          : "—"}
                      </dd>
                    </div>
                  )}
                  {inventoryRole(item) !== "raw_material" ? (
                    <div>
                      <dt>Fractional sale (1/4, 1/2, 3/4)</dt>
                      <dd>
                        <button
                          type="button"
                          role="switch"
                          className={`theme-switch trans-chap-panel__switch${allowsFractionalSelling(item) ? " is-on" : ""}`}
                          aria-checked={allowsFractionalSelling(item)}
                          aria-label={
                            allowsFractionalSelling(item)
                              ? `Disable fractional selling for ${name}`
                              : `Enable fractional selling for ${name}`
                          }
                          disabled={savingId === item.id}
                          onClick={() => void toggleFractional(item)}
                        >
                          <span className="theme-switch__thumb" aria-hidden />
                        </button>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </TransChapPanel>
              </MotionItem>
            );
          })}
          </MotionList>
        )}
        {visibleCount < filtered.length ? (
          <div
            ref={stocksSentinelRef}
            style={{
              textAlign: "center",
              padding: "1.25rem 1rem",
              color: "var(--tc-muted, #888)",
              fontSize: "0.85rem",
            }}
          >
            Showing {visibleFiltered.length} of {filtered.length} products (scroll down for more)…
          </div>
        ) : null}
      </div>
      {selecting ? (
        <div className="trans-chap-bulk-bar">
          <p className="trans-chap-bulk-bar__count">
            {selectedIds.size
              ? `${selectedIds.size} selected`
              : "Tap items to select"}
          </p>
          <button type="button" disabled={bulkSaving || !filtered.length} onClick={selectFiltered}>
            All
          </button>
          <button
            type="button"
            disabled={bulkSaving || !outOfStockFiltered.length}
            onClick={selectOutOfStock}
            title={
              outOfStockFiltered.length
                ? `Select ${outOfStockFiltered.length} out of stock`
                : "No out-of-stock items in this list"
            }
          >
            Out of stock
          </button>
          {restaurant ? (
            <Link
              href={`/trans-chap/purchases/issue?new=1&from=store&items=${issuableSelectedIds.map(encodeURIComponent).join(",")}`}
              className={`trans-chap-bulk-bar__issue-btn${issuableSelectedIds.length ? "" : " is-disabled"}`}
              aria-disabled={!issuableSelectedIds.length}
              tabIndex={issuableSelectedIds.length ? undefined : -1}
              title={
                issuableSelectedIds.length
                  ? "Issue the selected supplies to the kitchen"
                  : "Select raw materials or items used in cooking to issue to the kitchen"
              }
            >
              <i className="fa-solid fa-dolly" style={{ marginRight: "0.35rem" }} aria-hidden />
              Issue{issuableSelectedIds.length ? ` (${issuableSelectedIds.length})` : ""}
            </Link>
          ) : (
            <Link
              href={
                selectedIds.size
                  ? `/trans-chap/stocks/quotation?items=${Array.from(selectedIds).join(",")}`
                  : "/trans-chap/stocks/quotation"
              }
              className="trans-chap-bulk-bar__quote-btn"
              id="stocks-bulk-quote-btn"
              title="Create quotation with selected items"
            >
              <i className="fa-brands fa-whatsapp" style={{ marginRight: "0.35rem" }} aria-hidden />
              Quote{selectedIds.size ? ` (${selectedIds.size})` : ""}
            </Link>
          )}
          <button
            type="button"
            className="trans-chap-bulk-bar__disable"
            disabled={
              bulkSaving ||
              !filtered.some((item) => selectedIds.has(item.id) && item.is_active)
            }
            onClick={() => void disableSelected()}
          >
            {bulkSaving ? "Disabling…" : "Disable"}
          </button>
        </div>
      ) : (
        <>
          {restaurant ? (
            <div className="trans-chap-fab-release-wrap">
              <Link
                href="/trans-chap/purchases/issue?new=1&from=store"
                className="trans-chap-fab-release"
                aria-label="Release supply to the kitchen"
                title="Release supply to the kitchen"
              >
                <i className="fa-solid fa-dolly" aria-hidden />
                <span>Release to kitchen</span>
              </Link>
            </div>
          ) : null}
          <TransChapFab
            label={restaurant ? "Store stock" : "Add stock"}
            options={
              restaurant
                ? [
                    {
                      href: "/trans-chap/kitchen",
                      label: "Kitchen stock",
                      icon: "fa-fire-burner",
                    },
                    {
                      href: "/trans-chap/purchases/kitchen-day",
                      label: "Kitchen day report",
                      icon: "fa-chart-pie",
                    },
                    {
                      href: "/trans-chap/purchases/issue?new=1&from=store",
                      label: "Release to kitchen",
                      icon: "fa-dolly",
                    },
                    {
                      href: "/trans-chap/purchases/new?mode=select",
                      label: "Buy supplies",
                      icon: "fa-cart-shopping",
                    },
                    {
                      href: "/trans-chap/purchases/unavailable",
                      label: "New supply item",
                      icon: "fa-cart-plus",
                    },
                    {
                      label: "Import Excel / CSV",
                      icon: "fa-file-import",
                      onClick: () => setImportModalOpen(true),
                    },
                    {
                      href: "/trans-chap/stocks/quotation",
                      label: "Supplies quotation",
                      icon: "fa-file-invoice",
                    },
                    {
                      href: "/trans-chap/stocks/opening",
                      label: "Opening stock",
                      icon: "fa-boxes-stacked",
                    },
                  ]
            : canEditQty
              ? [
                  {
                    href: "/trans-chap/purchases/new",
                    label: "Select buy",
                    icon: "fa-list",
                  },
                  {
                    href: "/trans-chap/purchases/new?mode=scan",
                    label: "Scan buy",
                    icon: "fa-barcode",
                  },
                  {
                    href: "/trans-chap/purchases/unavailable",
                    label: "Buy new item",
                    icon: "fa-cart-plus",
                  },
                  {
                    label: "Import Excel / CSV",
                    icon: "fa-file-import",
                    onClick: () => setImportModalOpen(true),
                  },
                  {
                    href: "/trans-chap/stocks/quotation",
                    label: "WhatsApp quotation",
                    icon: "fa-file-invoice",
                  },
                  {
                    href: "/trans-chap/stocks/opening",
                    label: "Opening stock",
                    icon: "fa-boxes-stacked",
                  },
                ]
              : [
                  {
                    href: "/trans-chap/purchases/unavailable",
                    label: "Buy",
                    icon: "fa-cart-plus",
                  },
                  {
                    label: "Import Excel / CSV",
                    icon: "fa-file-import",
                    onClick: () => setImportModalOpen(true),
                  },
                ]
        }
      />
      </>
      )}

      <TransChapInventoryImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={reload}
      />
    </div>
  );
}
