import type { Order, OrderStatus, StoreStatus } from "@/lib/types";

/** Orders that need an immediate kitchen action (confirm / start prep). */
export const STATION_NEEDS_ACTION: OrderStatus[] = [
  "placed",
  "awaiting_payment",
  "payment_received",
];

/** Live kitchen queue. */
export const STATION_ACTIVE: OrderStatus[] = [
  "being_prepared",
  "ready",
  "out_for_delivery",
  "awaiting_delivery_confirmation",
  "awaiting_pickup_confirmation",
];

export function isStationNeedsAction(order: Order): boolean {
  return STATION_NEEDS_ACTION.includes(order.status);
}

export function isStationActive(order: Order): boolean {
  return STATION_ACTIVE.includes(order.status);
}

/** Still on the live station boards (needs action or active prep). */
export function isStationLive(order: Order): boolean {
  return isStationNeedsAction(order) || isStationActive(order);
}

/**
 * Canonical merchant sequence (delivery):
 * Created → Payment requested → Payment received → Preparing → Prepared →
 * Finding a rider → Rider en route → Rider at store → Out for delivery → Delivered
 */
export type StationPrimaryAction =
  | {
      kind: "transition";
      label: string;
      toStatus: OrderStatus;
      needsMpesaReceipt?: boolean;
    }
  | {
      kind: "confirm_handoff";
      label: string;
    };

export function stationPrimaryAction(order: Order): StationPrimaryAction | null {
  const next = order.allowed_next_statuses ?? [];
  const isMpesa = order.payment_method === "mpesa";

  if (order.status === "placed") {
    if (isMpesa && next.includes("awaiting_payment")) {
      return { kind: "transition", label: "Request payment", toStatus: "awaiting_payment" };
    }
    if (next.includes("payment_received")) {
      return {
        kind: "transition",
        label: "Payment received",
        toStatus: "payment_received",
        needsMpesaReceipt: isMpesa,
      };
    }
    if (next.includes("being_prepared")) {
      // Cash / already-paid shortcuts still land on prepare.
      return { kind: "transition", label: "Start preparing", toStatus: "being_prepared" };
    }
  }

  if (order.status === "awaiting_payment" && next.includes("payment_received")) {
    return {
      kind: "transition",
      label: "Payment received",
      toStatus: "payment_received",
      needsMpesaReceipt: isMpesa && !order.paid_at,
    };
  }

  if (order.status === "payment_received" && next.includes("being_prepared")) {
    return { kind: "transition", label: "Start preparing", toStatus: "being_prepared" };
  }

  if (order.status === "being_prepared" && next.includes("ready")) {
    return { kind: "transition", label: "Mark prepared", toStatus: "ready" };
  }

  if (order.status === "ready" && next.includes("out_for_delivery")) {
    return { kind: "transition", label: "Send for delivery", toStatus: "out_for_delivery" };
  }

  if (order.status === "ready" && order.fulfillment_type === "pickup") {
    return { kind: "confirm_handoff", label: "Mark picked up" };
  }

  if (
    order.status === "out_for_delivery" ||
    order.status === "awaiting_delivery_confirmation"
  ) {
    return { kind: "confirm_handoff", label: "Delivered" };
  }

  if (order.status === "awaiting_pickup_confirmation") {
    return { kind: "confirm_handoff", label: "Picked up" };
  }

  return null;
}

export function storeStatusLabel(status: StoreStatus): string {
  if (status.orders_paused) {
    if (status.orders_paused_reason === "heartbeat") {
      return "Paused (tablet offline)";
    }
    return "Paused";
  }
  if (status.busy_extra_prep_minutes > 0) {
    return `Busy (+${status.busy_extra_prep_minutes} min)`;
  }
  return "Open";
}

export function orderPrepMinutes(order: Order, store: StoreStatus | null): number {
  if (order.prep_minutes != null) return order.prep_minutes;
  return store?.effective_prep_minutes ?? 20;
}
