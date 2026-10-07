import { apiFetch } from "@/lib/api";
import { extractErrorMessage, internalErrorMessage, promptVoidReason } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { orderHasSuccessfulMpesa, orderUsesPayment } from "@/lib/orders";
import type { Order, OrderMutationResponse, OrdersListResponse } from "@/lib/types";

const MAX_PAGES = 20;

export async function fetchWalkinOrders(options?: {
  maxPages?: number;
}): Promise<{ orders: Order[]; error: string | null; truncated: boolean }> {
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const orders: Order[] = [];
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?source=walkin&per_page=100&page=${page}`,
      );
      orders.push(...data.data);
      if (page >= data.meta.last_page) {
        return { orders, error: null, truncated: false };
      }
    }
    return { orders, error: null, truncated: true };
  } catch {
    return {
      orders,
      error: internalErrorMessage(),
      truncated: false,
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
): Promise<Order> {
  const data = await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(orderId), {
    method: "POST",
    body: JSON.stringify({ to_status: toStatus, note }),
  });
  return data.data;
}

export async function promptAndUndoWalkinSale(order: {
  id: string;
  status: string;
  allowed_next_statuses?: string[] | null;
  payment_method?: string | null;
  payment_splits?: Order["payment_splits"];
}): Promise<Order | null> {
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
  return transitionWalkinSale(order.id, isRefund ? "refunded" : "cancelled", reason);
}

/** Void (or refund, once completed) several sales with one reason. */
export async function promptAndUndoWalkinSales(
  orders: Order[],
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
  const updated: Order[] = [];
  const failures: string[] = [];
  for (const { order, action } of targets) {
    try {
      updated.push(
        await transitionWalkinSale(
          order.id,
          action === "refund" ? "refunded" : "cancelled",
          reason,
        ),
      );
    } catch (err) {
      failures.push(`${order.order_number || order.id}: ${extractErrorMessage(err)}`);
    }
  }
  return { updated, failures };
}
