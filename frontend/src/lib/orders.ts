/**
 * Shared helpers for rendering order data — labels, status pills, currency.
 *
 * Server-side source of truth lives in `app/support/order_status.py`. This
 * file mirrors the labels so the UI can show them without an extra fetch.
 */

import type {
  Order,
  OrderFulfillmentType,
  OrderPaymentMethod,
  OrderPaymentSplit,
  OrderSource,
  OrderStatus,
  OrderWorkflowAction,
  OrderWorkflowStep,
} from "@/lib/types";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  placed: "Created",
  awaiting_payment: "Payment requested",
  payment_received: "Payment received",
  being_prepared: "Preparing",
  ready: "Prepared",
  out_for_delivery: "Out for delivery",
  awaiting_delivery_confirmation: "Confirming delivery",
  awaiting_pickup_confirmation: "Confirming pickup",
  delivered: "Delivered",
  picked_up: "Picked up",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/**
 * Tailored colour treatment per status. The "tone" maps to a CSS class on
 * the pill so the visual language stays consistent across pages.
 */
export const STATUS_TONES: Record<OrderStatus, string> = {
  placed: "info",
  awaiting_payment: "warn",
  payment_received: "info",
  being_prepared: "info",
  ready: "ok",
  out_for_delivery: "info",
  awaiting_delivery_confirmation: "warn",
  awaiting_pickup_confirmation: "warn",
  delivered: "ok",
  picked_up: "ok",
  cancelled: "muted",
  refunded: "muted",
};

export const SOURCE_LABELS: Record<OrderSource, string> = {
  walkin: "Walk-in",
  phone_call: "Phone call",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  tiktok: "TikTok",
  facebook: "Facebook",
  rider_request: "Rider request",
};

export const SOURCE_ICONS: Record<OrderSource, string> = {
  walkin: "fa-solid fa-person-walking",
  phone_call: "fa-solid fa-phone",
  instagram: "fa-brands fa-instagram",
  whatsapp: "fa-brands fa-whatsapp",
  tiktok: "fa-brands fa-tiktok",
  facebook: "fa-brands fa-facebook",
  rider_request: "fa-solid fa-motorcycle",
};

export const FULFILLMENT_LABELS: Record<OrderFulfillmentType, string> = {
  pickup: "Pickup",
  dine_in: "Dine in",
  delivery: "Delivery",
};

export const FULFILLMENT_ICONS: Record<OrderFulfillmentType, string> = {
  pickup: "fa-solid fa-bag-shopping",
  dine_in: "fa-solid fa-utensils",
  delivery: "fa-solid fa-truck",
};

export const PAYMENT_LABELS: Record<OrderPaymentMethod, string> = {
  mpesa: "M-PESA",
  cash: "Cash",
  card: "Card",
  credit: "Credit",
  other: "Other",
  split: "Split",
};

export function formatMoney(amount: number, currency = "KES"): string {
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type PaymentFields = {
  payment_method?: OrderPaymentMethod | string | null;
  payment_splits?: OrderPaymentSplit[] | null;
  total?: number | null;
};

/** Amount owed through each method; single-method orders owe the full total. */
export function orderPaymentPortions(order: PaymentFields): OrderPaymentSplit[] {
  if (order.payment_method === "split") {
    return (order.payment_splits ?? []).filter((p) => Number(p.amount) > 0);
  }
  if (!order.payment_method) return [];
  return [
    {
      method: order.payment_method as OrderPaymentSplit["method"],
      amount: Number(order.total ?? 0),
    },
  ];
}

export function orderUsesPayment(
  order: PaymentFields,
  method: OrderPaymentSplit["method"],
): boolean {
  if (order.payment_method === method) return true;
  return orderPaymentPortions(order).some((p) => p.method === method);
}

export function orderPaymentPortion(
  order: PaymentFields,
  method: OrderPaymentSplit["method"],
): number {
  return orderPaymentPortions(order)
    .filter((p) => p.method === method)
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

/** "Cash" or, for split payments, "Cash KES 500.00 + M-PESA KES 300.00". */
export function orderPaymentLabel(
  order: PaymentFields & { currency?: string | null },
): string {
  if (!order.payment_method) return "—";
  if (order.payment_method !== "split") {
    return (
      PAYMENT_LABELS[order.payment_method as OrderPaymentMethod] ??
      order.payment_method
    );
  }
  return orderPaymentPortions(order)
    .map(
      (p) =>
        `${PAYMENT_LABELS[p.method] ?? p.method} ${formatMoney(
          Number(p.amount),
          order.currency ?? "KES",
        )}`,
    )
    .join(" + ");
}

/** Orders created by the Instagram/WhatsApp DukAI sales agent. */
export function isDukAiAgentOrder(order: {
  notes?: string | null;
  placed_by_user_id?: string | null;
}): boolean {
  const notes = (order.notes ?? "").toLowerCase();
  if (notes.includes("dukai agent") || notes.includes("ai agent order")) {
    return true;
  }
  // Agent-placed DM orders have no merchant user on the ticket.
  return !order.placed_by_user_id && notes.includes("agent");
}

export function orderUnitsCount(
  order: { items?: { quantity: number }[] | null; items_count?: number | null },
): number {
  const items = order.items ?? [];
  if (items.length) {
    return items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }
  return order.items_count ?? 0;
}

export const ALL_SOURCES: OrderSource[] = [
  "walkin",
  "phone_call",
  "instagram",
  "whatsapp",
  "tiktok",
  "facebook",
  "rider_request",
];

/**
 * Channels that can be selected directly inside the POS. Other sources
 * (Instagram, WhatsApp, TikTok, Facebook) still exist on orders that
 * originate from those platforms' inboxes, but can't be picked manually
 * here — staff only ring up walk-in customers and phone callers.
 */
export const POS_SOURCES: OrderSource[] = ["walkin", "phone_call"];

/** Orders in these states won't receive external webhook/customer updates. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  "delivered",
  "picked_up",
  "cancelled",
  "refunded",
];

export function orderHasSuccessfulMpesa(order: Order): boolean {
  if (order.paid_at) return true;
  if (order.mpesa_transaction?.status === "success") return true;
  return order.mpesa_transactions?.some((txn) => txn.status === "success") ?? false;
}

/** M-PESA orders without a reflected payment need a receipt code to mark paid. */
export function orderRequiresMpesaReceiptConfirmation(order: Order): boolean {
  if (!orderUsesPayment(order, "mpesa")) return false;
  if (order.paid_at) return false;
  return !orderHasSuccessfulMpesa(order);
}

export function orderHasPendingMpesa(order: Order): boolean {
  if (order.mpesa_transaction?.status === "pending") return true;
  return order.mpesa_transactions?.some((txn) => txn.status === "pending") ?? false;
}

/** Keep polling the order detail while it may change from customer/webhook activity. */
export function orderNeedsLiveUpdates(order: Order | null): boolean {
  if (!order) return false;
  return !TERMINAL_ORDER_STATUSES.includes(order.status);
}

export const ALL_FULFILLMENT_TYPES: OrderFulfillmentType[] = [
  "pickup",
  "dine_in",
  "delivery",
];

export const ALL_PAYMENT_METHODS: OrderPaymentMethod[] = [
  "mpesa",
  "credit",
  "cash",
  "card",
  "other",
];

/**
 * The full canonical order, used for status filter chips. Terminal states
 * appear at the end so the most-used in-flight statuses are easiest to
 * reach.
 */
const DELIVERY_DETAIL_FIELDS: {
  key: keyof Pick<
    Order,
    "customer_name" | "customer_phone" | "delivery_address"
  >;
  label: string;
}[] = [
  { key: "customer_name", label: "Customer name" },
  { key: "customer_phone", label: "Phone number" },
  { key: "delivery_address", label: "Delivery address" },
];

export function orderMissingDeliveryFields(order: Order): string[] {
  if (order.fulfillment_type !== "delivery") return [];
  return DELIVERY_DETAIL_FIELDS.filter(
    ({ key }) => !(order[key] ?? "").trim(),
  ).map(({ label }) => label);
}

export function orderNeedsDeliveryDetails(order: Order): boolean {
  return orderMissingDeliveryFields(order).length > 0;
}

/** Fallback when API omits workflow_actions (mirrors backend order_workflow.py). */
export function fallbackWorkflowActions(order: Order): OrderWorkflowAction[] {
  const actions: OrderWorkflowAction[] = [];
  const mpesaPaid =
    !!order.paid_at || order.mpesa_transaction?.status === "success";
  const hasPhone = Boolean((order.customer_phone ?? "").trim());
  const isMpesa = orderUsesPayment(order, "mpesa");

  if (order.status === "placed") {
    if (isMpesa) {
      actions.push({
        kind: "transition",
        to_status: "awaiting_payment",
        label: "Request payment",
        variant: "primary",
        icon: "arrow-right",
      });
    } else {
      actions.push({
        kind: "transition",
        to_status: "payment_received",
        label: "Payment received",
        variant: "primary",
        icon: "check",
      });
    }
    actions.push({ kind: "delete", label: "Delete", variant: "danger", icon: "trash" });
  } else if (order.status === "awaiting_payment") {
    if (isMpesa && !mpesaPaid) {
      actions.push({
        kind: "mpesa_stk_push",
        label: order.mpesa_transaction_id ? "Resend payment request" : "Request payment",
        variant: "primary",
        icon: "paper-plane",
        disabled: !hasPhone,
        disabled_reason: "Add a customer phone number first",
      });
    }
    if (!mpesaPaid) {
      if (isMpesa) {
        if (orderHasSuccessfulMpesa(order)) {
          actions.push({
            kind: "transition",
            to_status: "payment_received",
            label: "Payment received",
            variant: "primary",
            icon: "check",
          });
        } else {
          actions.push({
            kind: "confirm_mpesa_payment",
            to_status: "payment_received",
            label: "Payment received",
            variant: "secondary",
            icon: "check",
            requires_mpesa_receipt: true,
          });
        }
      } else {
        actions.push({
          kind: "transition",
          to_status: "payment_received",
          label: "Payment received",
          variant: "secondary",
          icon: "check",
        });
      }
    }
  } else if (order.status === "payment_received") {
    actions.push({
      kind: "transition",
      to_status: "being_prepared",
      label: "Start preparing",
      variant: "primary",
      icon: "fire-burner",
    });
  } else if (order.status === "being_prepared") {
    actions.push({
      kind: "transition",
      to_status: "ready",
      label: "Mark prepared",
      variant: "primary",
      icon: "circle-check",
    });
  } else if (order.status === "ready") {
    if (order.fulfillment_type === "delivery") {
      actions.push({
        kind: "transition",
        to_status: "out_for_delivery",
        label: "Send for delivery",
        variant: "primary",
        icon: "truck",
        disabled: orderNeedsDeliveryDetails(order),
        disabled_reason: "Waiting for customer delivery details",
      });
    } else if (!order.merchant_delivery_confirmed_at) {
      actions.push({
        kind: "confirm_handoff",
        label: "Mark picked up",
        variant: "primary",
        icon: "bag-shopping",
      });
    }
  } else if (order.status === "out_for_delivery") {
    if (!order.merchant_delivery_confirmed_at) {
      actions.push({
        kind: "confirm_handoff",
        label: "Delivered",
        variant: "primary",
        icon: "circle-check",
      });
    }
  } else if (
    order.status === "awaiting_delivery_confirmation" ||
    order.status === "awaiting_pickup_confirmation"
  ) {
    if (!order.merchant_delivery_confirmed_at) {
      actions.push({
        kind: "confirm_handoff",
        label: order.fulfillment_type === "pickup" ? "Picked up" : "Delivered",
        variant: "primary",
        icon: "circle-check",
      });
    }
    if (!order.customer_delivery_confirmed_at) {
      actions.push({
        kind: "resend_completion_prompt",
        label: "Resend customer confirmation",
        variant: "secondary",
        icon: "paper-plane",
      });
    }
  } else if (order.status === "delivered" || order.status === "picked_up") {
    actions.push({
      kind: "refund",
      to_status: "refunded",
      label: "Mark refunded",
      variant: "danger",
      icon: "rotate-left",
    });
  }

  if (!["delivered", "picked_up", "cancelled", "refunded"].includes(order.status)) {
    actions.push({
      kind: "cancel",
      to_status: "cancelled",
      label: "Cancel order",
      variant: "danger",
      icon: "xmark",
    });
  }

  return actions;
}

export function orderWorkflowActions(order: Order): OrderWorkflowAction[] {
  return order.workflow_actions?.length
    ? order.workflow_actions
    : fallbackWorkflowActions(order);
}

export function orderWorkflowSteps(order: Order): OrderWorkflowStep[] {
  return order.workflow_steps ?? [];
}

const CLOSED_STATUSES: OrderStatus[] = [
  "delivered",
  "picked_up",
  "cancelled",
  "refunded",
];

export function isOrderClosed(status: OrderStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export const ALL_STATUSES: OrderStatus[] = [
  "placed",
  "awaiting_payment",
  "payment_received",
  "being_prepared",
  "ready",
  "out_for_delivery",
  "awaiting_delivery_confirmation",
  "awaiting_pickup_confirmation",
  "delivered",
  "picked_up",
  "cancelled",
  "refunded",
];
