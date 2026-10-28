"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapViewToggle } from "@/components/trans-chap/TransChapViewToggle";
import { TransChapFilterChips, type ChipOption } from "@/components/trans-chap/TransChapFilterChips";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { summarizeFailures, useTransChapListView } from "@/lib/trans-chap-list-view";
import { showError, showInternalError, toastSuccess, promptMpesaReceipt, promptPendingStk, extractErrorMessage } from "@/lib/alerts";
import { apiFetch, readPageCache, writePageCache } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { isRestaurantStore } from "@/lib/onboarding";
import { formatNairobiStamp24, isWithinLastDays, nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import {
  PAYMENT_LABELS,
  orderHasPendingMpesa,
  orderHasSuccessfulMpesa,
  orderUsesPayment,
} from "@/lib/orders";
import { buildMpesaFlowSteps, MpesaFlowStatus } from "@/components/app/MpesaFlowStatus";
import {
  fetchWalkinOrders,
  promptAndUndoWalkinSale,
  promptAndUndoWalkinSales,
  walkinUndoAction,
} from "@/lib/trans-chap-orders";
import {
  formatKsh,
  receiptFromOrder,
  transChapPayLabel,
  transChapReceiptHref,
  transChapReceiptPayLabel,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";
import { TransChapGoodsOnReturnModal } from "@/components/trans-chap/TransChapGoodsOnReturnModal";
import { TransChapOrderDetailModal } from "@/components/trans-chap/TransChapOrderDetailModal";
import type { Order, OrderMutationResponse } from "@/lib/types";

type WhenFilter = "all" | "today" | "week";
type MethodFilter = "all" | "credit" | "mpesa";
type StatusFilter = "all" | "paid" | "waiting" | "failed" | "voided";

const WHEN_CHIPS: ChipOption<Exclude<WhenFilter, "all">>[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
];

const METHOD_CHIPS: ChipOption<Exclude<MethodFilter, "all">>[] = [
  { id: "credit", label: "Credit" },
  { id: "mpesa", label: "M-PESA" },
];

const STATUS_CHIPS: ChipOption<Exclude<StatusFilter, "all">>[] = [
  { id: "paid", label: "Paid" },
  { id: "waiting", label: "Waiting" },
  { id: "failed", label: "Failed" },
  { id: "voided", label: "Voided" },
];

function saleStatus(order: Order): { label: string; tone: "ok" | "wait" | "fail" | "credit" } {
  if (order.status === "cancelled") {
    return { label: "Voided", tone: "fail" };
  }
  if (order.status === "refunded") {
    return { label: "Refunded", tone: "fail" };
  }
  if (orderUsesPayment(order, "mpesa") && !orderHasSuccessfulMpesa(order)) {
    if (orderHasPendingMpesa(order) || order.status === "awaiting_payment") {
      return { label: "Waiting", tone: "wait" };
    }
    return { label: "Failed", tone: "fail" };
  }
  if (orderUsesPayment(order, "credit")) {
    return { label: "On credit", tone: "credit" };
  }
  if (!order.paid_at) {
    if (order.status === "placed") return { label: "In Kitchen", tone: "wait" };
    if (order.status === "being_prepared") return { label: "Preparing", tone: "wait" };
    if (order.status === "ready") return { label: "Ready", tone: "ok" };
    if (order.status === "picked_up") return { label: "Served · Unpaid", tone: "wait" };
    if (order.status === "awaiting_payment") return { label: "Unpaid", tone: "wait" };
  }
  return { label: "Paid", tone: "ok" };
}

function orderDateKey(order: Order): string | null {
  const date = parseIso(order.paid_at || order.placed_at || order.created_at);
  return date ? nairobiDateKey(date) : null;
}

const SALES_CACHE_KEY = "trans-chap:sales";
const SALES_STORAGE_KEY = "trans-chap:sales:cache:v1";
const INITIAL_VISIBLE_COUNT = 50;
const VISIBLE_INCREMENT = 50;

type SalesSnapshot = { orders: Order[]; truncated: boolean; timestamp?: number };

type IndexedOrder = Order & {
  _searchText?: string;
  _saleStatus?: { label: string; tone: "ok" | "wait" | "fail" | "credit" };
  _dateKey?: string | null;
  _receipt?: TransChapReceipt;
};

function readSalesCache(): SalesSnapshot | null {
  const mem = readPageCache<SalesSnapshot>(SALES_CACHE_KEY);
  if (mem && mem.orders && mem.orders.length > 0) return mem;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SALES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.orders) && parsed.orders.length > 0) {
      writePageCache(SALES_CACHE_KEY, parsed);
      return parsed as SalesSnapshot;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function writeSalesCache(snapshot: SalesSnapshot) {
  writePageCache(SALES_CACHE_KEY, snapshot);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SALES_STORAGE_KEY, JSON.stringify({ ...snapshot, timestamp: Date.now() }));
  } catch {
    // Ignore quota errors
  }
}

function getOrderSearchText(order: IndexedOrder): string {
  if (order._searchText !== undefined) return order._searchText;
  const items = order.items ?? [];
  const hay = [
    ...items.map((line) => line.product_name),
    order.order_number,
    order.customer_name,
    order.customer_phone,
    order.mpesa_transaction?.mpesa_receipt_number,
    ...(order.mpesa_transactions?.map((txn) => txn.mpesa_receipt_number) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  order._searchText = hay;
  return hay;
}

function getCachedSaleStatus(order: IndexedOrder) {
  if (order._saleStatus !== undefined) return order._saleStatus;
  const s = saleStatus(order);
  order._saleStatus = s;
  return s;
}

function getCachedDateKey(order: IndexedOrder): string | null {
  if (order._dateKey !== undefined) return order._dateKey;
  const k = orderDateKey(order);
  order._dateKey = k;
  return k;
}

function getCachedReceipt(order: IndexedOrder, shopName: string): TransChapReceipt {
  if (order._receipt !== undefined) return order._receipt;
  const r = receiptFromOrder(order, shopName);
  order._receipt = r;
  return r;
}

export function TransChapSalesList() {
  const user = useAuthUser();
  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const listId = useId();
  const [cached] = useState(() => readSalesCache());
  const [orders, setOrders] = useState<Order[]>(cached?.orders ?? []);
  const initialLoadedRef = useRef(Boolean(cached?.orders?.length));
  const allLoadedRef = useRef(false);
  const [loading, setLoading] = useState(!cached?.orders?.length);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(cached?.truncated ?? false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [when, setWhen] = useState<WhenFilter>(() => {
    if (typeof window !== "undefined") {
      const value = new URLSearchParams(window.location.search).get("when");
      if (value === "all" || value === "today" || value === "week") {
        return value;
      }
    }
    return "today";
  });
  const [method, setMethod] = useState<MethodFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [stkBusyId, setStkBusyId] = useState<string | null>(null);
  const [returnOrder, setReturnOrder] = useState<Order | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [view, setView] = useTransChapListView("trans-chap-sales-view");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkUndoing, setBulkUndoing] = useState(false);
  const canVoid = isStoreAdmin(user);
  const undoActionFor = (order: Order) => (canVoid ? walkinUndoAction(order) : null);
  const canReturnGoods = (order: Order) => {
    if (order.status === "cancelled") return false;
    const items = order.items ?? [];
    if (!items.length) return false;
    return items.some((i) => i.quantity - (i.returned_quantity || 0) > 0);
  };
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";

  const todayKey = useMemo(() => nairobiDateKey(new Date()), []);
  const sevenDaysAgoKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return nairobiDateKey(d);
  }, []);

  const reload = useCallback(async (opts?: { silent?: boolean; forceAll?: boolean }) => {
    const hasData = initialLoadedRef.current || Boolean(readSalesCache()?.orders?.length);
    if (!opts?.silent && !hasData) {
      setLoading(true);
    }
    const untilPastDateKey = opts?.forceAll
      ? undefined
      : when === "today"
        ? todayKey
        : when === "week"
          ? sevenDaysAgoKey
          : undefined;

    const result = await fetchWalkinOrders({
      untilPastDateKey,
      onProgress: (progressiveOrders, meta) => {
        setOrders((existing) => {
          const freshIds = new Set(progressiveOrders.map((o) => o.id));
          const older = existing.filter((o) => !freshIds.has(o.id));
          return [...progressiveOrders, ...older];
        });
        initialLoadedRef.current = true;
        setLoading(false);
        if (!meta.done) {
          setBackgroundSyncing(true);
        }
      },
    });

    if (result.orders.length > 0) {
      setOrders((existing) => {
        const freshIds = new Set(result.orders.map((o) => o.id));
        const older = existing.filter((o) => !freshIds.has(o.id));
        const merged = [...result.orders, ...older];
        writeSalesCache({
          orders: merged,
          truncated: result.truncated,
        });
        return merged;
      });
    }

    if (!untilPastDateKey) {
      allLoadedRef.current = true;
    }
    setError(result.error);
    setTruncated(result.truncated);
    setBackgroundSyncing(false);
    initialLoadedRef.current = true;
    setLoading(false);
  }, [sevenDaysAgoKey, todayKey, when]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fetchOlderOrders = useCallback(async (targetDateKey?: string) => {
    if (allLoadedRef.current) return;
    setBackgroundSyncing(true);
    try {
      const result = await fetchWalkinOrders({
        untilPastDateKey: targetDateKey,
        onProgress: (progressiveOrders) => {
          setOrders((existing) => {
            const freshIds = new Set(progressiveOrders.map((o) => o.id));
            const older = existing.filter((o) => !freshIds.has(o.id));
            return [...progressiveOrders, ...older];
          });
        },
      });
      if (result.orders.length > 0) {
        setOrders((existing) => {
          const freshIds = new Set(result.orders.map((o) => o.id));
          const older = existing.filter((o) => !freshIds.has(o.id));
          const merged = [...result.orders, ...older];
          writeSalesCache({
            orders: merged,
            truncated: result.truncated,
          });
          return merged;
        });
      }
      if (!targetDateKey) {
        allLoadedRef.current = true;
      }
    } finally {
      setBackgroundSyncing(false);
    }
  }, []);

  const handleWhenChange = useCallback(
    (nextWhen: WhenFilter) => {
      setWhen(nextWhen);
      if (nextWhen === "today") return;

      if (nextWhen === "week") {
        const hasOlderThan7Days = orders.some((order) => {
          const k = getCachedDateKey(order as IndexedOrder);
          return Boolean(k && k < sevenDaysAgoKey);
        });
        if (!hasOlderThan7Days && !allLoadedRef.current) {
          void fetchOlderOrders(sevenDaysAgoKey);
        }
      } else if (nextWhen === "all") {
        if (!allLoadedRef.current) {
          void fetchOlderOrders();
        }
      }
    },
    [fetchOlderOrders, orders, sevenDaysAgoKey],
  );

  useEffect(() => {
    if (deferredQuery.trim().length >= 3 && !allLoadedRef.current && !backgroundSyncing) {
      void fetchOlderOrders();
    }
  }, [deferredQuery, fetchOlderOrders, backgroundSyncing]);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("when");
    if (value === "all" || value === "today" || value === "week") {
      setWhen(value);
      if (value !== "today") {
        setFiltersOpen(true);
      }
    }
  }, []);

  async function undoSale(order: Order) {
    setUndoingId(order.id);
    try {
      const updated = await promptAndUndoWalkinSale(order, { restaurant });
      if (!updated) return;
      setOrders((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      await toastSuccess(updated.status === "refunded" ? "Sale refunded" : "Sale voided");
    } catch {
      await showInternalError();
    } finally {
      setUndoingId(null);
    }
  }

  async function handlePendingStk(order: Order) {
    const choice = await promptPendingStk();
    if (!choice) return;
    setStkBusyId(order.id);
    try {
      if (choice === "enter_code") {
        const receipt = await promptMpesaReceipt(
          "Enter M-PESA code",
          "Type the transaction code from the customer’s SMS. Use this when they paid you directly or already finished on their phone.",
        );
        if (!receipt) return;
        const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
          method: "POST",
          body: JSON.stringify({
            to_status: "payment_received",
            mpesa_receipt_number: receipt,
          }),
        });
        setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
        await toastSuccess("M-PESA sale closed");
        return;
      }
      if (choice === "check") {
        const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderMpesaCheck(order.id), {
          method: "POST",
          body: "{}",
        });
        setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
        if (data.outcome === "paid") {
          await toastSuccess("Customer already paid");
        } else {
          await showError("Still waiting", "Please try again in a moment.");
        }
        return;
      }
      const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderMpesaStkPush(order.id), {
        method: "POST",
        body: "{}",
      });
      setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
      if (data.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent");
      } else {
        await showInternalError();
      }
    } catch (err) {
      await showError("Could not complete M-PESA", extractErrorMessage(err));
    } finally {
      setStkBusyId(null);
    }
  }

  async function handleSettlePayment(order: Order) {
    const choice = await promptMpesaReceipt(
      `Settle bill: ${order.table_number || order.order_number}`,
      `Total: KSh ${Math.round(order.total).toLocaleString("en-KE")}. Enter customer's M-PESA transaction code, or leave blank to record Cash payment.`,
    );
    if (choice === null) return;
    setStkBusyId(order.id);
    try {
      const code = choice.trim();
      const payload: Record<string, any> = {
        is_paid: true,
      };
      if (code) {
        payload.payment_method = "mpesa";
        payload.mpesa_receipt_number = code;
      } else {
        payload.payment_method = "cash";
      }
      const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderRecordPayment(order.id), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setOrders((prev) => prev.map((row) => (row.id === data.data.id ? data.data : row)));
      if (viewingOrder?.id === data.data.id) {
        setViewingOrder(data.data);
      }
      await toastSuccess(code ? "M-PESA payment recorded" : "Cash payment recorded");
    } catch (err) {
      await showError("Could not record payment", extractErrorMessage(err));
    } finally {
      setStkBusyId(null);
    }
  }
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return orders.filter((order) => {
      const idxOrder = order as IndexedOrder;
      if (needle && !getOrderSearchText(idxOrder).includes(needle)) return false;
      if (method === "credit" && !orderUsesPayment(order, "credit")) return false;
      if (method === "mpesa" && !orderUsesPayment(order, "mpesa")) return false;
      const tone = getCachedSaleStatus(idxOrder).tone;
      if (status === "paid" && tone !== "ok") return false;
      if (status === "waiting" && tone !== "wait") return false;
      if (status === "failed" && (tone !== "fail" || order.status === "cancelled" || order.status === "refunded")) {
        return false;
      }
      if (status === "voided" && order.status !== "cancelled" && order.status !== "refunded") {
        return false;
      }
      if (when === "all") return true;
      const key = getCachedDateKey(idxOrder);
      if (!key) return false;
      if (when === "today") return key === todayKey;
      return isWithinLastDays(key, 7, todayKey);
    });
  }, [deferredQuery, method, orders, status, todayKey, when]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [deferredQuery, when, method, status]);

  // Infinite scroll progressive loading via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || selecting) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + VISIBLE_INCREMENT, filtered.length));
        }
      },
      { rootMargin: "350px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered.length, selecting]);

  const displayedOrders = useMemo(() => {
    if (selecting) return filtered;
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount, selecting]);

  const activeFilterCount =
    Number(when !== "all") + Number(method !== "all") + Number(status !== "all");
  const filtersOn = activeFilterCount > 0 || query.trim() !== "";
  const filterSummary = [
    when === "today" ? "Today" : when === "week" ? "7 days" : null,
    method === "credit" ? "Credit" : method === "mpesa" ? "M-PESA" : null,
    status === "paid"
      ? "Paid"
      : status === "waiting"
        ? "Waiting"
        : status === "failed"
          ? "Failed"
          : status === "voided"
            ? "Voided"
            : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const undoable = useMemo(
    () => (canVoid ? filtered.filter((order) => walkinUndoAction(order) !== null) : []),
    [canVoid, filtered],
  );
  const selectedOrders = undoable.filter((order) => selectedIds.has(order.id));

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

  function toggleSelectAll() {
    setSelectedIds(
      selectedOrders.length === undoable.length
        ? new Set()
        : new Set(undoable.map((order) => order.id)),
    );
  }

  async function undoSelected() {
    if (!selectedOrders.length || bulkUndoing) return;
    setBulkUndoing(true);
    try {
      const result = await promptAndUndoWalkinSales(selectedOrders, { restaurant });
      if (!result) return;
      const byId = new Map(result.updated.map((order) => [order.id, order]));
      setOrders((prev) => prev.map((row) => byId.get(row.id) ?? row));
      if (result.failures.length) {
        setSelectedIds(
          new Set(selectedOrders.filter((o) => !byId.has(o.id)).map((o) => o.id)),
        );
        await showError(
          result.updated.length
            ? `Voided ${result.updated.length}, ${result.failures.length} failed`
            : "Could not void sales",
          summarizeFailures(result.failures),
        );
        return;
      }
      await toastSuccess(
        result.updated.length === 1 ? "Sale voided" : `${result.updated.length} sales voided`,
      );
      stopSelecting();
    } finally {
      setBulkUndoing(false);
    }
  }

  function renderCheck(order: Order, label: string) {
    if (!undoActionFor(order)) return null;
    const picked = selectedIds.has(order.id);
    return (
      <button
        type="button"
        role="checkbox"
        className={`trans-chap-panel__check${picked ? " is-on" : ""}`}
        aria-checked={picked}
        aria-label={`${picked ? "Unselect" : "Select"} ${label}`}
        onClick={() => toggleSelected(order.id)}
      >
        {picked ? <i className="fa-solid fa-check" aria-hidden /> : null}
      </button>
    );
  }

  function renderTableActions(order: Order, product: string) {
    const sale = saleStatus(order);
    const undo = undoActionFor(order);
    const busy = stkBusyId === order.id || undoingId === order.id || bulkUndoing;
    return (
      <>
        {sale.tone === "wait" || (orderUsesPayment(order, "mpesa") && sale.tone === "fail" && order.status !== "cancelled" && order.status !== "refunded") ? (
          <button
            type="button"
            className="trans-chap-stock-table__icon-btn"
            disabled={busy}
            title={stkBusyId === order.id ? "Working…" : "Complete M-PESA"}
            aria-label={`Complete M-PESA for ${product}`}
            onClick={() => void handlePendingStk(order)}
          >
            <i
              className={stkBusyId === order.id ? "fa-solid fa-circle-notch fa-spin" : "fa-solid fa-mobile-screen-button"}
              aria-hidden
            />
          </button>
        ) : null}
        {undo ? (
          <button
            type="button"
            className="trans-chap-stock-table__icon-btn trans-chap-stock-table__icon-btn--void"
            disabled={busy}
            title={undoingId === order.id ? "Working…" : undo === "refund" ? "Refund sale" : "Void sale"}
            aria-label={undo === "refund" ? `Refund sale for ${product}` : `Void sale for ${product}`}
            onClick={() => void undoSale(order)}
          >
            <i
              className={undoingId === order.id ? "fa-solid fa-circle-notch fa-spin" : "fa-solid fa-ban"}
              aria-hidden
            />
          </button>
        ) : null}
        {canReturnGoods(order) ? (
          <button
            type="button"
            className="trans-chap-stock-table__icon-btn trans-chap-stock-table__icon-btn--return"
            disabled={busy}
            title="Return goods"
            aria-label={`Return goods for ${product}`}
            onClick={() => setReturnOrder(order)}
          >
            <i className="fa-solid fa-arrow-rotate-left" aria-hidden />
          </button>
        ) : null}
        <Link
          href={transChapReceiptHref(order.id)}
          className="trans-chap-stock-table__icon-btn trans-chap-stock-table__icon-btn--receipt"
          title="Open receipt"
          aria-label={`Open receipt for ${product}`}
        >
          <i className="fa-solid fa-receipt" aria-hidden />
        </Link>
      </>
    );
  }

  function renderActions(order: Order, product: string) {
    const sale = saleStatus(order);
    const undo = undoActionFor(order);
    const busy = stkBusyId === order.id || undoingId === order.id || bulkUndoing;
    const isPaid = Boolean(order.paid_at);
    const isUndone = order.status === "cancelled" || order.status === "refunded";

    return (
      <div className="trans-chap-actions-group">
        <button
          type="button"
          className="trans-chap-action-btn trans-chap-action-btn--view"
          title={`View order ${order.order_number}`}
          aria-label={`View order ${order.order_number}`}
          onClick={() => setViewingOrder(order)}
        >
          <i className="fa-solid fa-eye" aria-hidden />
        </button>
        {!isPaid && !isUndone ? (
          <button
            type="button"
            className="trans-chap-action-btn trans-chap-action-btn--pay"
            disabled={busy}
            title={`Record payment (${formatKsh(order.total)})`}
            aria-label="Record payment"
            onClick={() => setViewingOrder(order)}
          >
            <i className="fa-solid fa-money-bill-wave" aria-hidden />
          </button>
        ) : isPaid && !isUndone ? (
          <button
            type="button"
            className="trans-chap-action-btn trans-chap-action-btn--paid"
            disabled={busy}
            title="Bill paid — click to view or manage"
            aria-label="Bill paid"
            onClick={() => setViewingOrder(order)}
          >
            <i className="fa-solid fa-circle-check" aria-hidden />
          </button>
        ) : null}
        {restaurant && order.workflow_actions ? (
          (() => {
            const stepAction = order.workflow_actions.find(
              (a) =>
                a.kind === "transition" &&
                a.to_status !== "cancelled" &&
                a.to_status !== "payment_received",
            );
            if (!stepAction) return null;
            const stepIcon =
              stepAction.to_status === "being_prepared"
                ? "fa-fire-burner"
                : stepAction.to_status === "ready"
                  ? "fa-bell-concierge"
                  : stepAction.to_status === "picked_up"
                    ? "fa-utensils"
                    : "fa-circle-check";
            return (
              <button
                type="button"
                className="trans-chap-action-btn trans-chap-action-btn--workflow"
                title={stepAction.label}
                aria-label={stepAction.label}
                disabled={busy}
                onClick={async () => {
                  setStkBusyId(order.id);
                  try {
                    let updated: Order;
                    if (stepAction.to_status === "picked_up") {
                      const res = await apiFetch<OrderMutationResponse>(
                        apiRoutes.orderConfirmHandoff(order.id),
                        { method: "POST", body: "{}" },
                      );
                      updated = res.data;
                    } else {
                      const res = await apiFetch<OrderMutationResponse>(
                        apiRoutes.orderTransition(order.id),
                        {
                          method: "POST",
                          body: JSON.stringify({ to_status: stepAction.to_status }),
                        },
                      );
                      updated = res.data;
                    }
                    setOrders((prev) =>
                      prev.map((row) => (row.id === updated.id ? updated : row)),
                    );
                    if (viewingOrder?.id === updated.id) {
                      setViewingOrder(updated);
                    }
                    await toastSuccess(stepAction.label);
                  } catch (err) {
                    await showError("Could not update order", extractErrorMessage(err));
                  } finally {
                    setStkBusyId(null);
                  }
                }}
              >
                <i className={`fa-solid ${stepIcon}`} aria-hidden />
              </button>
            );
          })()
        ) : null}
        {sale.tone === "wait" || (orderUsesPayment(order, "mpesa") && sale.tone === "fail" && !isUndone) ? (
          <button
            type="button"
            className="trans-chap-action-btn trans-chap-action-btn--mpesa"
            disabled={busy}
            title={stkBusyId === order.id ? "Working…" : "Complete M-PESA"}
            aria-label="Complete M-PESA"
            onClick={() => void handlePendingStk(order)}
          >
            <i className={stkBusyId === order.id ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-mobile-screen-button"} aria-hidden />
          </button>
        ) : null}
        {canReturnGoods(order) ? (
          <button
            type="button"
            className="trans-chap-action-btn trans-chap-action-btn--return"
            disabled={busy}
            title="Return goods"
            aria-label="Return goods"
            onClick={() => setReturnOrder(order)}
          >
            <i className="fa-solid fa-box-open" aria-hidden />
          </button>
        ) : null}
        {undo ? (
          <button
            type="button"
            className="trans-chap-action-btn trans-chap-action-btn--void"
            disabled={busy}
            title={undoingId === order.id ? "Working…" : undo === "refund" ? "Refund sale" : "Void sale"}
            aria-label={undo === "refund" ? "Refund sale" : "Void sale"}
            onClick={() => void undoSale(order)}
          >
            <i className={undoingId === order.id ? "fa-solid fa-spinner fa-spin" : undo === "refund" ? "fa-solid fa-rotate-left" : "fa-solid fa-ban"} aria-hidden />
          </button>
        ) : null}
        <Link
          href={transChapReceiptHref(order.id)}
          className="trans-chap-action-btn trans-chap-action-btn--receipt"
          title={`Open receipt for ${product}`}
          aria-label={`Open receipt for ${product}`}
        >
          <i className="fa-solid fa-receipt" aria-hidden />
        </Link>
      </div>
    );
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
              placeholder="Search sales…"
              aria-label="Search sales"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`trans-chap-sales__filter-btn${filtersOpen || activeFilterCount ? " is-on" : ""}`}
            aria-expanded={filtersOpen}
            aria-controls="trans-chap-sales-filters"
            aria-label="Filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <i className="fa-solid fa-sliders" aria-hidden />
            {activeFilterCount ? <em>{activeFilterCount}</em> : null}
          </button>
          <TransChapViewToggle view={view} onChange={setView} label="Sales layout" />
          {backgroundSyncing ? (
            <span
              className="trans-chap-sales__chip"
              style={{
                cursor: "default",
                opacity: 0.85,
                fontSize: "0.78rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
              }}
              title="Earlier sales are loading in the background"
            >
              <i className="fa-solid fa-circle-notch fa-spin" aria-hidden style={{ fontSize: "0.75rem" }} />
              Syncing…
            </span>
          ) : null}
          {orders.some((order) => undoActionFor(order) !== null) ? (
            <button
              type="button"
              className={`trans-chap-sales__chip${selecting ? " is-active" : ""}`}
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : startSelecting())}
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : null}
        </div>
        {filtersOpen ? (
          <div id="trans-chap-sales-filters" className="trans-chap-sales__chips">
            <TransChapFilterChips label="When" value={when} options={WHEN_CHIPS} onChange={handleWhenChange} />
            <TransChapFilterChips label="Payment" value={method} options={METHOD_CHIPS} onChange={setMethod} />
            <TransChapFilterChips label="Status" value={status} options={STATUS_CHIPS} onChange={setStatus} />
            {activeFilterCount ? (
              <button
                type="button"
                className="trans-chap-sales__chip trans-chap-sales__chip--clear"
                onClick={() => {
                  handleWhenChange("all");
                  setMethod("all");
                  setStatus("all");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : filterSummary ? (
          <button
            type="button"
            className="trans-chap-sales__summary"
            onClick={() => setFiltersOpen(true)}
          >
            {filterSummary}
          </button>
        ) : null}
      </div>
      <div className="trans-chap-sales__list">
        {loading ? (
          <TransChapListSkeleton />
        ) : error && orders.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : orders.length === 0 ? (
          <TransChapStatus
            actionHref="/trans-chap/sales/new"
            actionLabel="Make a sale"
          >
            No sales yet.
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
            <p className="trans-chap-sales__empty" style={{ margin: "0 0 0.75rem" }}>
              {when === "today" && activeFilterCount === 1 && !query.trim()
                ? "No sales recorded today."
                : filtersOn
                  ? "No sales match these filters."
                  : "No sales yet."}
            </p>
            {when === "today" && orders.length > 0 && !query.trim() && activeFilterCount === 1 ? (
              <button
                type="button"
                className="trans-chap-sales__chip"
                onClick={() => setWhen("all")}
                style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", cursor: "pointer" }}
              >
                View all sales
              </button>
            ) : null}
          </div>
        ) : view === "list" ? (
          <div className="trans-chap-stock-table-wrap trans-chap-stock-table-wrap--cards">
            <table className="trans-chap-stock-table trans-chap-stock-table--cards trans-chap-stock-table--sale">
              <thead>
                <tr>
                  {selecting ? <th className="trans-chap-stock-table__check" scope="col"> </th> : null}
                  <th scope="col">Items</th>
                  <th scope="col">Ref</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Total</th>
                  <th scope="col">Method</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th className="trans-chap-stock-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedOrders.map((order) => {
                  const items = order.items ?? [];
                  const product = items[0]?.product_name || "Sale";
                  const extra = items.length > 1 ? ` +${items.length - 1}` : "";
                  const qty = items.reduce((sum, line) => sum + (line.quantity || 0), 0);
                  const sale = saleStatus(order);
                  const receipt = receiptFromOrder(order, shopName);
                  const picked = selectedIds.has(order.id);
                  const undone = order.status === "cancelled" || order.status === "refunded";
                  return (
                    <tr
                      key={order.id}
                      className={`${undone ? "is-inactive" : ""}${picked ? " is-picked" : ""}`}
                    >
                      {selecting ? (
                        <td className="trans-chap-stock-table__check">
                          {renderCheck(order, `${product}${extra}`)}
                        </td>
                      ) : null}
                      <td
                        className="trans-chap-stock-table__product"
                        onClick={() => setViewingOrder(order)}
                        style={{ cursor: "pointer" }}
                        title="Click to view order details"
                      >
                        <div>{`${product}${extra}`}</div>
                        {Number(order.returned_total || 0) > 0 ? (
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: "2px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              background: "rgba(245, 158, 11, 0.14)",
                              color: "#b45309",
                            }}
                          >
                            Returned {formatKsh(order.returned_total || 0)}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="trans-chap-stock-table__mono"
                        onClick={() => setViewingOrder(order)}
                        style={{ cursor: "pointer" }}
                        title="Click to view order details"
                      >
                        {receipt.orderNumber}
                      </td>
                      <td className="trans-chap-stock-table__mono">{qty}</td>
                      <td className="trans-chap-stock-table__strong">{formatKsh(order.total)}</td>
                      <td title={transChapReceiptPayLabel(receipt)}>
                        {receipt.paymentSplits
                          ? receipt.paymentSplits.map((p) => PAYMENT_LABELS[p.method]).join(" + ")
                          : transChapPayLabel(receipt.payMode)}
                      </td>
                      <td className="trans-chap-stock-table__wrap">
                        {receipt.customerName?.trim() || "Walk-in"}
                      </td>
                      <td className="trans-chap-stock-table__mono">
                        {formatNairobiStamp24(receipt.paidAt) || "—"}
                      </td>
                      <td>
                        <em className={`trans-chap-panel__badge is-${sale.tone}`}>{sale.label}</em>
                      </td>
                      <td className="trans-chap-stock-table__actions">
                        <div className="trans-chap-stock-table__actions-inner">
                          {selecting ? null : renderTableActions(order, product)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <MotionList
            as="div"
            className="trans-chap-sales__stagger"
            staggerChildren={displayedOrders.length > 20 ? 0 : 0.02}
          >
            {displayedOrders.map((order) => {
            const rawProduct = order.items?.[0]?.product_name || (restaurant ? "Order" : "Sale");
            const product =
              restaurant && order.table_number
                ? `${order.table_number} · ${rawProduct}`
                : rawProduct;
            const extra = (order.items?.length ?? 0) > 1
              ? ` +${(order.items?.length ?? 0) - 1}`
              : "";
            const qty = (order.items ?? []).reduce(
              (sum, line) => sum + (line.quantity || 0),
              0,
            );
            const sale = saleStatus(order);
            const undoable = undoActionFor(order) !== null;
            const open = !selecting && openId === order.id;
            const panelId = `${listId}-${order.id}`;
            const receipt = receiptFromOrder(order, shopName);
            const paidAt = formatNairobiStamp24(receipt.paidAt);
            return (
              <MotionItem key={order.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="sale"
                title={`${product}${extra}`}
                qty={`Qty ${qty}`}
                price={formatKsh(order.total)}
                badge={sale}
                inactive={selecting && !undoable}
                picking={selecting}
                picked={selectedIds.has(order.id)}
                onToggle={() => {
                  if (!selecting) setOpenId(open ? null : order.id);
                  else if (undoable) toggleSelected(order.id);
                }}
                headAction={
                  selecting ? (
                    renderCheck(order, `${product}${extra}`)
                  ) : (
                    <Link
                      href={transChapReceiptHref(order.id)}
                      className="trans-chap-panel__receipt"
                      aria-label={`Open receipt for ${product}`}
                    >
                      <i className="fa-solid fa-receipt" aria-hidden />
                    </Link>
                  )
                }
                action={renderActions(order, product)}
              >
                <p className="trans-chap-panel__lead">
                  {sale.label === "Voided"
                    ? "This sale was voided. Stock came back."
                    : sale.label === "Refunded"
                      ? "This sale was refunded. Stock came back."
                      : sale.label === "On credit"
                        ? "On the customer’s tab. Not paid yet."
                        : sale.tone === "ok"
                          ? "Payment received."
                          : sale.tone === "wait"
                            ? "Waiting for M-PESA. Tap Complete M-PESA to send a prompt or enter the SMS code."
                            : "M-PESA didn’t go through. Tap Complete M-PESA to try again or enter the SMS code."}
                </p>
                {orderUsesPayment(order, "mpesa") && order.mpesa_transaction ? (
                  <MpesaFlowStatus
                    steps={buildMpesaFlowSteps(order.mpesa_transaction)}
                    onStepAction={
                      sale.tone === "wait" || sale.tone === "fail"
                        ? () => void handlePendingStk(order)
                        : undefined
                    }
                  />
                ) : null}
                <ul className="trans-chap-panel__lines">
                  {(order.items ?? []).map((line) => (
                    <li key={line.id || `${line.product_name}-${line.quantity}`}>
                      <span>
                        {line.product_name}
                        {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                        {Number(line.returned_quantity || 0) > 0 ? (
                          <em style={{ fontStyle: "normal", color: "#b45309", fontSize: "0.74rem", marginLeft: 6 }}>
                            ({line.returned_quantity} returned)
                          </em>
                        ) : null}
                      </span>
                      <em>{formatKsh(line.line_total)}</em>
                    </li>
                  ))}
                </ul>
                {Number(order.returned_total || 0) > 0 || (order.returns && order.returns.length > 0) ? (
                  <div
                    style={{
                      margin: "0.6rem 0",
                      padding: "0.6rem 0.75rem",
                      background: "rgba(245, 158, 11, 0.08)",
                      borderRadius: "8px",
                      border: "1px dashed rgba(245, 158, 11, 0.35)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "0.82rem", color: "#92400e" }}>
                        <i className="fa-solid fa-arrow-rotate-left" style={{ marginRight: 6 }} aria-hidden />
                        Goods on return recorded
                      </strong>
                      <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#b45309" }}>
                        -{formatKsh(order.returned_total || 0)}
                      </span>
                    </div>
                    {order.returns?.map((ret) => (
                      <div key={ret.id} style={{ fontSize: "0.74rem", color: "#78350f", marginTop: "0.25rem" }}>
                        {ret.return_number}: {ret.reason} (
                        {ret.items?.map((i) => `${i.quantity}x ${i.product_name}`).join(", ")})
                      </div>
                    ))}
                  </div>
                ) : null}
                <dl className="trans-chap-panel__facts">
                  <div>
                    <dt>Ref</dt>
                    <dd>{receipt.orderNumber}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{paidAt || "—"}</dd>
                  </div>
                  <div>
                    <dt>Method</dt>
                    <dd>{transChapReceiptPayLabel(receipt)}</dd>
                  </div>
                  <div>
                    <dt>Customer</dt>
                    <dd>{receipt.customerName?.trim() || "Walk-in"}</dd>
                  </div>
                  {receipt.mpesaReceiptNumber ? (
                    <div>
                      <dt>M-PESA code</dt>
                      <dd>{receipt.mpesaReceiptNumber}</dd>
                    </div>
                  ) : null}
                </dl>
              </TransChapPanel>
              </MotionItem>
            );
          })}
          </MotionList>
        )}
        {!selecting && filtered.length > displayedOrders.length ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1rem 0" }}>
            <div ref={sentinelRef} style={{ height: "1px", width: "100%", margin: "4px 0" }} />
            <button
              type="button"
              className="trans-chap-sales__chip"
              onClick={() =>
                setVisibleCount((prev) => Math.min(prev + VISIBLE_INCREMENT, filtered.length))
              }
              style={{ padding: "0.55rem 1.25rem", fontSize: "0.85rem", cursor: "pointer" }}
            >
              Showing {displayedOrders.length} of {filtered.length} · Load more
            </button>
          </div>
        ) : null}
        {truncated ? (
          <p className="trans-chap-sales__empty">Showing the most recent 2,000 sales.</p>
        ) : null}
      </div>
      {selecting ? (
        <div className="trans-chap-bulk-bar">
          <p className="trans-chap-bulk-bar__count">
            {selectedOrders.length ? `${selectedOrders.length} selected` : "Tap sales to select"}
          </p>
          <button type="button" disabled={bulkUndoing || !undoable.length} onClick={toggleSelectAll}>
            {undoable.length && selectedOrders.length === undoable.length ? "None" : "All"}
          </button>
          <button
            type="button"
            className="trans-chap-bulk-bar__disable"
            disabled={bulkUndoing || !selectedOrders.length}
            onClick={() => void undoSelected()}
          >
            {bulkUndoing ? "Voiding…" : "Void"}
          </button>
        </div>
      ) : (
        <TransChapFab label={restaurant ? "Take order" : "New sale"} href="/trans-chap/pos" />
      )}
      <TransChapGoodsOnReturnModal
        order={returnOrder}
        open={Boolean(returnOrder)}
        onClose={() => setReturnOrder(null)}
        onSuccess={(updated) => {
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        }}
      />
      <TransChapOrderDetailModal
        order={viewingOrder}
        open={Boolean(viewingOrder)}
        onClose={() => setViewingOrder(null)}
        onOrderUpdated={(updated) => {
          setOrders((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
          setViewingOrder(updated);
        }}
        onReturnGoods={(order) => setReturnOrder(order)}
        onVoidOrder={(order) => void undoSale(order)}
        restaurant={restaurant}
      />
    </div>
  );
}
