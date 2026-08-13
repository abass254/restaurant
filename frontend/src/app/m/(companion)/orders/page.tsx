"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, promptRejectReason } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  FULFILLMENT_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  formatMoney,
} from "@/lib/orders";
import { isStationActive, isStationNeedsAction, stationPrimaryAction } from "@/lib/station";
import type { Order, OrderMutationResponse, OrdersListResponse, OrderStatus } from "@/lib/types";

export default function MobileOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"action" | "active" | "all">("action");

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?per_page=100`,
      );
      setOrders(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load orders."));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const visible = useMemo(() => {
    if (tab === "action") return orders.filter(isStationNeedsAction);
    if (tab === "active") return orders.filter(isStationActive);
    return orders;
  }, [orders, tab]);

  async function transition(order: Order, toStatus: OrderStatus, note?: string) {
    setBusy(true);
    try {
      await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
        method: "POST",
        body: JSON.stringify({ to_status: toStatus, note: note ?? null }),
      });
      await refresh();
    } catch (err) {
      setError(extractErrorMessage(err, "Could not update order."));
    } finally {
      setBusy(false);
    }
  }

  async function runPrimary(order: Order) {
    const action = stationPrimaryAction(order);
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === "confirm_handoff") {
        await apiFetch<OrderMutationResponse>(
          apiRoutes.orderConfirmHandoff(order.id),
          { method: "POST", body: "{}" },
        );
      } else {
        const body: Record<string, string | null> = {
          to_status: action.toStatus,
          note: null,
        };
        if (action.needsMpesaReceipt) {
          const entered = window.prompt(
            "Enter the M-PESA transaction code to mark payment made:",
          );
          if (entered == null) return;
          const receipt = entered.trim();
          if (!receipt) {
            setError("M-PESA transaction code is required.");
            return;
          }
          body.mpesa_receipt_number = receipt;
        }
        await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      await refresh();
    } catch (err) {
      setError(extractErrorMessage(err, "Could not update order."));
    } finally {
      setBusy(false);
    }
  }

  async function rejectOrder(order: Order) {
    const reason = await promptRejectReason(
      `Reject ${order.order_number}?`,
      "The customer will see this reason in their chat.",
    );
    if (!reason) return;
    await transition(order, "cancelled", reason);
  }

  return (
    <>
      <div className="station-ticket__actions" style={{ marginBottom: "0.85rem" }}>
        {(
          [
            ["action", "Needs action"],
            ["active", "Active"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`station-btn ${tab === key ? "station-btn--primary" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="station-banner" style={{ borderRadius: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {visible.length === 0 ? (
        <div className="station-empty">No orders in this list.</div>
      ) : (
        visible.map((order) => {
          const action = stationPrimaryAction(order);
          return (
            <div key={order.id} className="mobile-card">
              <div className="mobile-row">
                <h3 style={{ margin: 0 }}>{order.order_number}</h3>
                <span className="station-pill station-pill--muted">
                  {STATUS_LABELS[order.status]}
                </span>
              </div>
              <p style={{ margin: "0.4rem 0", color: "var(--station-muted)", fontSize: "0.85rem" }}>
                {SOURCE_LABELS[order.source]} ·{" "}
                {FULFILLMENT_LABELS[order.fulfillment_type]} ·{" "}
                {formatMoney(order.total, order.currency)}
              </p>
              <ul className="station-ticket__items">
                {(order.items ?? []).slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.quantity}× {item.product_name}
                    </strong>
                  </li>
                ))}
              </ul>
              <div className="station-ticket__actions">
                {action && (
                  <button
                    type="button"
                    className="station-btn station-btn--primary"
                    disabled={busy}
                    onClick={() => void runPrimary(order)}
                  >
                    {action.label}
                  </button>
                )}
                {!["cancelled", "delivered", "picked_up", "refunded"].includes(
                  order.status,
                ) && (
                  <button
                    type="button"
                    className="station-btn station-btn--danger"
                    disabled={busy}
                    onClick={() => void rejectOrder(order)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
