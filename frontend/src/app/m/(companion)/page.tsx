"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatMoney, isOrderClosed } from "@/lib/orders";
import { isStationNeedsAction, stationPrimaryAction } from "@/lib/station";
import type { Order, OrderMutationResponse, OrdersListResponse } from "@/lib/types";
import { useStoreStatus } from "@/hooks/useStation";
import {
  enableCompanionPush,
  isCompanionPushEnabled,
} from "@/lib/companion-push";

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function MobileHomePage() {
  const { store, pause, resume, setBusy } = useStoreStatus();
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setActionBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPushEnabled(isCompanionPushEnabled());
  }, []);

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
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const todayStart = useMemo(() => startOfTodayIso(), []);
  const todayOrders = useMemo(
    () =>
      orders.filter((o) => (o.placed_at || o.created_at || "") >= todayStart),
    [orders, todayStart],
  );
  const todaySales = useMemo(
    () =>
      todayOrders
        .filter((o) => !["cancelled", "refunded"].includes(o.status))
        .reduce((sum, o) => sum + (o.total || 0), 0),
    [todayOrders],
  );
  const needsAction = useMemo(
    () => orders.filter(isStationNeedsAction),
    [orders],
  );
  const activeCount = useMemo(
    () => orders.filter((o) => !isOrderClosed(o.status) && !isStationNeedsAction(o)).length,
    [orders],
  );

  async function runPrimary(order: Order) {
    const action = stationPrimaryAction(order);
    if (!action) return;
    setActionBusy(true);
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
      setActionBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="station-banner" style={{ borderRadius: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="mobile-stats">
        <div className="mobile-stat">
          <strong>{formatMoney(todaySales)}</strong>
          <span>Today’s sales</span>
        </div>
        <div className="mobile-stat">
          <strong>{todayOrders.length}</strong>
          <span>Today’s orders</span>
        </div>
        <div className="mobile-stat">
          <strong>{needsAction.length}</strong>
          <span>Needs action</span>
        </div>
        <div className="mobile-stat">
          <strong>{activeCount}</strong>
          <span>In progress</span>
        </div>
      </div>

      <div className="mobile-card">
        <div className="mobile-row">
          <div>
            <h3 style={{ margin: 0 }}>Store status</h3>
            <p style={{ margin: "0.25rem 0 0", color: "var(--station-muted)", fontSize: "0.85rem" }}>
              Prep {store?.effective_prep_minutes ?? "—"} min
            </p>
          </div>
        </div>
        <div className="station-ticket__actions" style={{ marginTop: "0.85rem" }}>
          {store?.orders_paused ? (
            <button
              type="button"
              className="station-btn station-btn--primary"
              onClick={() => void resume()}
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              className="station-btn station-btn--danger"
              onClick={() => void pause(30)}
            >
              Pause 30 min
            </button>
          )}
          <button
            type="button"
            className="station-btn"
            onClick={() => void setBusy(10)}
          >
            Busy +10
          </button>
          <button
            type="button"
            className="station-btn"
            onClick={() => void setBusy(0)}
          >
            Clear busy
          </button>
        </div>
      </div>

      {!pushEnabled && (
        <div className="mobile-card">
          <div className="mobile-row">
            <h3 style={{ margin: 0 }}>Push alerts</h3>
            <button
              type="button"
              className="station-btn station-btn--primary"
              onClick={async () => {
                const result = await enableCompanionPush();
                if (result.ok) {
                  setPushEnabled(true);
                  setPushMsg(null);
                  return;
                }
                setPushMsg(result.message);
              }}
            >
              Enable
            </button>
          </div>
          {pushMsg && (
            <p
              style={{
                margin: "0.5rem 0 0",
                color: "var(--station-muted)",
                fontSize: "0.85rem",
              }}
            >
              {pushMsg}
            </p>
          )}
        </div>
      )}

      <div className="mobile-row" style={{ marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Needs action</h3>
        <Link href="/m/orders" style={{ color: "var(--station-accent)" }}>
          See all
        </Link>
      </div>
      {needsAction.length === 0 ? (
        <div className="station-empty">Nothing waiting right now.</div>
      ) : (
        needsAction.slice(0, 5).map((order) => {
          const action = stationPrimaryAction(order);
          return (
            <div key={order.id} className="mobile-card">
              <div className="mobile-row">
                <div>
                  <h3>{order.order_number}</h3>
                  <div style={{ color: "var(--station-muted)", fontSize: "0.85rem" }}>
                    {formatMoney(order.total, order.currency)} · {order.status}
                  </div>
                </div>
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
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
