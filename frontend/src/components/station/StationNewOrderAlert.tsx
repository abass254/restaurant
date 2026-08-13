"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, promptRejectReason } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  FULFILLMENT_LABELS,
  SOURCE_LABELS,
  formatMoney,
  isDukAiAgentOrder,
  orderUnitsCount,
} from "@/lib/orders";
import { isStationNeedsAction, stationPrimaryAction } from "@/lib/station";
import type { Order, OrderMutationResponse, OrderStatus } from "@/lib/types";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { useStationOrdersContext } from "@/components/station/StationOrdersContext";

/** DoorDash-style repeating chime while an incoming order fills the screen. */
function useRepeatingAlertSound(active: boolean, enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active || !enabled || typeof window === "undefined") return;

    let cancelled = false;
    let intervalId = 0;

    function ensureCtx(): AudioContext | null {
      try {
        if (!ctxRef.current) {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          ctxRef.current = new AC();
        }
        return ctxRef.current;
      } catch {
        return null;
      }
    }

    function chirp() {
      const ctx = ensureCtx();
      if (!ctx || cancelled) return;
      void ctx.resume();
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      gain.connect(ctx.destination);

      const freqs = [880, 1174.66, 880];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = freq;
        osc.connect(gain);
        const start = now + i * 0.16;
        osc.start(start);
        osc.stop(start + 0.14);
      });
    }

    chirp();
    intervalId = window.setInterval(chirp, 1800);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active, enabled]);
}

/**
 * Full-viewport incoming-order takeover (DoorDash Order Manager style).
 * Mount once in the station shell so it covers every station page + rail.
 */
export function StationNewOrderAlert() {
  const {
    orders,
    setOrders,
    refresh,
    newOrderIds,
    dismissAlert,
    soundOn,
  } = useStationOrdersContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alertQueue = useMemo(() => {
    return newOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is Order => Boolean(o && isStationNeedsAction(o)));
  }, [newOrderIds, orders]);

  const alertOrder = alertQueue[0] ?? null;
  const queueRemaining = alertQueue.length;

  useRepeatingAlertSound(Boolean(alertOrder), soundOn);

  useEffect(() => {
    if (!alertOrder) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [alertOrder]);

  const transition = useCallback(
    async (
      order: Order,
      toStatus: OrderStatus,
      note?: string,
      mpesaReceiptNumber?: string,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const body: Record<string, string | null> = {
          to_status: toStatus,
          note: note ?? null,
        };
        if (mpesaReceiptNumber) {
          body.mpesa_receipt_number = mpesaReceiptNumber;
        }
        const res = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderTransition(order.id),
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
        setOrders((prev) =>
          prev.map((row) => (row.id === order.id ? res.data : row)),
        );
        dismissAlert(order.id);
        await refresh();
      } catch (err) {
        setError(extractErrorMessage(err, "Could not update order."));
      } finally {
        setBusy(false);
      }
    },
    [dismissAlert, refresh, setOrders],
  );

  const runPrimary = useCallback(
    async (order: Order) => {
      const action = stationPrimaryAction(order);
      if (!action) {
        dismissAlert(order.id);
        return;
      }
      if (action.kind === "confirm_handoff") {
        setBusy(true);
        setError(null);
        try {
          const res = await apiFetch<OrderMutationResponse>(
            apiRoutes.orderConfirmHandoff(order.id),
            { method: "POST", body: "{}" },
          );
          setOrders((prev) =>
            prev.map((row) => (row.id === order.id ? res.data : row)),
          );
          dismissAlert(order.id);
          await refresh();
        } catch (err) {
          setError(extractErrorMessage(err, "Could not update order."));
        } finally {
          setBusy(false);
        }
        return;
      }

      let receipt: string | undefined;
      if (action.needsMpesaReceipt) {
        const entered = window.prompt(
          "Enter the M-PESA transaction code to mark payment made:",
        );
        if (entered == null) return;
        receipt = entered.trim();
        if (!receipt) {
          setError("M-PESA transaction code is required.");
          return;
        }
      }
      await transition(order, action.toStatus, undefined, receipt);
    },
    [dismissAlert, refresh, setOrders, transition],
  );

  if (!alertOrder) return null;

  const action = stationPrimaryAction(alertOrder);
  const unitCount = orderUnitsCount(alertOrder);
  const fromAgent = isDukAiAgentOrder(alertOrder);

  return (
    <div
      className="station-alert"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="station-alert-title"
    >
      <div className="station-alert__screen">
        <header className="station-alert__header">
          <p className="station-alert__eyebrow">New order</p>
          <h2 id="station-alert-title" className="station-alert__number">
            {alertOrder.order_number}
          </h2>
          {queueRemaining > 1 && (
            <p className="station-alert__queue">
              {queueRemaining} orders waiting — confirm this one first
            </p>
          )}
        </header>

        <div className="station-alert__meta">
          {fromAgent ? (
            <span className="station-alert__agent">
              <DukAiLogoMark size={14} color="currentColor" accentColor="currentColor" />
              DukAI Agent
            </span>
          ) : null}
          <span>{SOURCE_LABELS[alertOrder.source]}</span>
          <span>{FULFILLMENT_LABELS[alertOrder.fulfillment_type]}</span>
          <span>
            {unitCount} item{unitCount === 1 ? "" : "s"}
          </span>
          <span>{formatMoney(alertOrder.total, alertOrder.currency)}</span>
        </div>

        {(alertOrder.customer_name || alertOrder.customer_phone) && (
          <p className="station-alert__customer">
            {alertOrder.customer_name || "Customer"}
            {alertOrder.customer_phone ? ` · ${alertOrder.customer_phone}` : ""}
          </p>
        )}

        {(alertOrder.delivery_notes || alertOrder.delivery_address) && (
          <div className="station-alert__notes">
            {alertOrder.delivery_address && <p>{alertOrder.delivery_address}</p>}
            {alertOrder.delivery_notes && <p>{alertOrder.delivery_notes}</p>}
          </div>
        )}

        <ul className="station-alert__items">
          {(alertOrder.items ?? []).map((item) => (
            <li key={item.id}>
              <div className="station-alert__item-main">
                <span className="station-alert__qty">{item.quantity}×</span>
                <span className="station-alert__item-name">{item.product_name}</span>
              </div>
              {item.stock_quantity != null && (
                <span className="station-alert__item-stock">
                  {item.stock_quantity} in stock
                </span>
              )}
              {item.notes ? (
                <span className="station-alert__item-note">{item.notes}</span>
              ) : null}
            </li>
          ))}
        </ul>

        {error && <p className="station-alert__error">{error}</p>}

        <footer className="station-alert__actions">
          <button
            type="button"
            className="station-alert__confirm"
            disabled={busy}
            onClick={() => {
              void runPrimary(alertOrder);
            }}
          >
            {action?.label ?? "Confirm"}
          </button>
          <button
            type="button"
            className="station-alert__reject"
            disabled={busy}
            onClick={() => {
              void (async () => {
                const reason = await promptRejectReason(
                  `Reject ${alertOrder.order_number}?`,
                  "The customer will see this reason in their chat.",
                );
                if (!reason) return;
                await transition(alertOrder, "cancelled", reason);
              })();
            }}
          >
            Reject
          </button>
        </footer>
      </div>
    </div>
  );
}
