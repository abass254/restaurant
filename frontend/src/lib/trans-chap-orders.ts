import { apiFetch } from "@/lib/api";
import {
  extractErrorMessage,
  internalErrorMessage,
  promptStockFate,
  promptVoidReason,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { orderHasSuccessfulMpesa, orderUsesPayment } from "@/lib/orders";
import {
  fetchAllPages,
  timeWindowQuery,
  type PageProgressMeta,
  type TimeWindow,
} from "@/lib/paged-fetch";
import type { Order, OrderMutationResponse, OrdersListResponse } from "@/lib/types";

const MAX_PAGES = 20;

export type WalkinOrdersProgressCallback = (
  orders: Order[],
  meta: PageProgressMeta,
) => void;

export type FetchWalkinOrdersOptions = {
  maxPages?: number;
  untilPastDateKey?: string;
  shouldStop?: (pageRows: Order[], pageNumber: number, allRowsSoFar: Order[]) => boolean;
  onProgress?: WalkinOrdersProgressCallback;
} & TimeWindow;

export async function fetchWalkinOrders(
  options?: FetchWalkinOrdersOptions,
): Promise<{ orders: Order[]; error: string | null; truncated: boolean }> {
  const window = timeWindowQuery(options);
  const untilPastDateKey = options?.untilPastDateKey;

  const shouldStop =
    options?.shouldStop ??
    (untilPastDateKey
      ? (pageRows: Order[]) => {
          return pageRows.some((order) => {
            const date = parseIso(order.paid_at || order.placed_at || order.created_at);
            const k = date ? nairobiDateKey(date) : null;
            return Boolean(k && k < untilPastDateKey);
          });
        }
      : undefined);

  const result = await fetchAllPages<OrdersListResponse["data"][number]>(
    (page) => `${apiRoutes.orders}?source=walkin&per_page=100&page=${page}${window}`,
    options?.maxPages ?? MAX_PAGES,
    options?.onProgress,
    shouldStop,
  );
  return {
    orders: result.rows,
    error: result.failed ? internalErrorMessage() : null,
    truncated: result.truncated,
  };
}

export async function fetchWalkinOrdersPage(
  page = 1,
  options?: { perPage?: number } & TimeWindow,
): Promise<{ orders: Order[]; lastPage: number; total: number; error: string | null }> {
  const window = timeWindowQuery(options);
  const perPage = options?.perPage ?? 100;
  try {
    const res = await apiFetch<OrdersListResponse>(
      `${apiRoutes.orders}?source=walkin&per_page=${perPage}&page=${page}${window}`,
    );
    return {
      orders: res.data,
      lastPage: res.meta.last_page,
      total: res.meta.total,
      error: null,
    };
  } catch {
    return {
      orders: [],
      lastPage: 1,
      total: 0,
      error: internalErrorMessage(),
    };
  }
}

export function isCountedWalkinSale(order: Order): boolean {
  if (order.status === "cancelled" || order.status === "refunded") return false;
  if (!orderUsesPayment(order, "mpesa")) return true;
  return orderHasSuccessfulMpesa(order);
}

export function walkinUndoAction(order: {
  status: string;
  allowed_next_statuses?: string[] | null;
}): "void" | "refund" | null {
  if (order.status === "cancelled" || order.status === "refunded") return null;
  const next = order.allowed_next_statuses ?? [];
  if (next.includes("refunded")) return "refund";
  if (next.includes("cancelled")) return "void";
  if (order.status === "delivered" || order.status === "picked_up") return "refund";
  return "void";
}

export async function transitionWalkinSale(
  orderId: string,
  toStatus: "cancelled" | "refunded",
  note: string,
  wasteStock = false,
): Promise<Order> {
  const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(orderId), {
    method: "POST",
    body: JSON.stringify({ to_status: toStatus, note, waste_stock: wasteStock }),
  });
  return data.data;
}

type UndoOptions = { restaurant?: boolean };

export async function promptAndUndoWalkinSale(
  order: {
    id: string;
    status: string;
    allowed_next_statuses?: string[] | null;
    payment_method?: string | null;
    payment_splits?: Order["payment_splits"];
  },
  options: UndoOptions = {},
): Promise<Order | null> {
  const action = walkinUndoAction(order);
  if (!action) return null;
  const isRefund = action === "refund";
  const mpesaNote =
    orderUsesPayment(order, "mpesa")
      ? " M-PESA is not reversed — return the money yourself."
      : "";
  const reason = await promptVoidReason(
    isRefund ? "Refund this sale?" : "Void this sale?",
    isRefund
      ? `Stock comes back.${mpesaNote || " Return the money yourself if it was paid."}`
      : `This sale will be cancelled and stock will come back.${mpesaNote}`,
    isRefund ? "Refund" : "Void sale",
  );
  if (!reason) return null;
  const fate = options.restaurant ? await promptStockFate() : "return";
  if (!fate) return null;
  return transitionWalkinSale(order.id, isRefund ? "refunded" : "cancelled", reason, fate === "waste");
}

/** Void (or refund, once completed) several sales with one reason. */
export async function promptAndUndoWalkinSales(
  orders: Order[],
  options: UndoOptions = {},
): Promise<{ updated: Order[]; failures: string[] } | null> {
  const targets = orders.flatMap((order) => {
    const action = walkinUndoAction(order);
    return action ? [{ order, action }] : [];
  });
  if (!targets.length) return null;
  const count = targets.length;
  const refunds = targets.filter((t) => t.action === "refund").length;
  const hasMpesa = targets.some((t) => orderUsesPayment(t.order, "mpesa"));
  const reason = await promptVoidReason(
    `Void ${count} sale${count === 1 ? "" : "s"}?`,
    [
      "Stock will come back.",
      refunds ? `${refunds} completed sale${refunds === 1 ? " is" : "s are"} refunded instead of voided.` : null,
      hasMpesa ? "M-PESA is not reversed — return the money yourself." : null,
    ]
      .filter(Boolean)
      .join(" "),
    `Void ${count}`,
  );
  if (!reason) return null;
  const fate = options.restaurant ? await promptStockFate(count) : "return";
  if (!fate) return null;
  const updated: Order[] = [];
  const failures: string[] = [];
  for (const { order, action } of targets) {
    try {
      updated.push(
        await transitionWalkinSale(
          order.id,
          action === "refund" ? "refunded" : "cancelled",
          reason,
          fate === "waste",
        ),
      );
    } catch (err) {
      failures.push(`${order.order_number || order.id}: ${extractErrorMessage(err)}`);
    }
  }
  return { updated, failures };
}
