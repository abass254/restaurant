"use client";

import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, promptRejectReason } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  FULFILLMENT_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  formatMoney,
  isTransChapAgentOrder,
} from "@/lib/orders";
import {
  isStationActive,
  isStationLive,
  isStationNeedsAction,
  orderPrepMinutes,
  stationPrimaryAction,
  storeStatusLabel,
} from "@/lib/station";
import type { Order, OrderMutationResponse, OrderStatus, StoreStatus } from "@/lib/types";
import { useStationOrdersContext } from "@/components/station/StationOrdersContext";
import { useStationHeartbeat, useStoreStatus } from "@/hooks/useStation";

type Props = {
  view: "orders" | "history" | "settings";
};

export function StationWorkspace({ view }: Props) {
  const { store, pause, resume, setBusy, heartbeat, refresh: refreshStore } =
    useStoreStatus();
  const { online } = useStationHeartbeat(true, heartbeat);
  const {
    orders,
    setOrders,
    loading,
    error,
    refresh,
    dismissAlert,
    soundOn,
    setSoundOn,
  } = useStationOrdersContext();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const needsAction = useMemo(
    () => orders.filter(isStationNeedsAction),
    [orders],
  );
  const active = useMemo(() => orders.filter(isStationActive), [orders]);
  const history = useMemo(
    () => orders.filter((o) => !isStationLive(o)),
    [orders],
  );

  const selected =
    [...needsAction, ...active].find((o) => o.id === selectedId) ??
    needsAction[0] ??
    active[0] ??
    null;

  const transition = useCallback(
    async (
      order: Order,
      toStatus: OrderStatus,
      note?: string,
      mpesaReceiptNumber?: string,
    ) => {
      setActionBusy(true);
      setActionError(null);
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
        const updated = res.data;
        setOrders((prev) =>
          prev.map((row) => (row.id === order.id ? updated : row)),
        );
        dismissAlert(order.id);
        // Cancelled / completed tickets leave the live boards — drop selection.
        setSelectedId(isStationLive(updated) ? updated.id : null);
        await refresh();
      } catch (err) {
        setActionError(extractErrorMessage(err, "Could not update order."));
      } finally {
        setActionBusy(false);
      }
    },
    [dismissAlert, refresh, setOrders],
  );

  const runPrimary = useCallback(
    async (order: Order) => {
      const action = stationPrimaryAction(order);
      if (!action) return;
      if (action.kind === "confirm_handoff") {
        setActionBusy(true);
        setActionError(null);
        try {
          const res = await apiFetch<OrderMutationResponse>(
            apiRoutes.orderConfirmHandoff(order.id),
            { method: "POST", body: "{}" },
          );
          const updated = res.data;
          setOrders((prev) =>
            prev.map((row) => (row.id === order.id ? updated : row)),
          );
          dismissAlert(order.id);
          setSelectedId(isStationLive(updated) ? updated.id : null);
          await refresh();
        } catch (err) {
          setActionError(extractErrorMessage(err, "Could not update order."));
        } finally {
          setActionBusy(false);
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
          setActionError("M-PESA transaction code is required.");
          return;
        }
      }
      await transition(order, action.toStatus, undefined, receipt);
    },
    [dismissAlert, refresh, setOrders, transition],
  );

  const requestReject = useCallback(
    async (order: Order) => {
      const reason = await promptRejectReason(
        `Reject ${order.order_number}?`,
        "The customer will see this reason in their chat.",
      );
      if (!reason) return;
      await transition(order, "cancelled", reason);
    },
    [transition],
  );

  const bumpPrep = useCallback(
    async (order: Order, delta: number) => {
      const current = orderPrepMinutes(order, store);
      const next = Math.max(5, Math.min(180, current + delta));
      setActionBusy(true);
      try {
        await apiFetch(apiRoutes.storeStatusOrderPrep(order.id), {
          method: "PATCH",
          body: JSON.stringify({ prep_minutes: next }),
        });
        setOrders((prev) =>
          prev.map((row) =>
            row.id === order.id ? { ...row, prep_minutes: next } : row,
          ),
        );
      } catch (err) {
        setActionError(extractErrorMessage(err, "Could not update prep time."));
      } finally {
        setActionBusy(false);
      }
    },
    [setOrders, store],
  );

  return (
    <>
      {!online && (
        <div className="station-banner" role="status">
          <i className="fa-solid fa-wifi" aria-hidden />
          You are offline. Keep this tablet online — the shop may auto-pause if
          the connection stays down.
        </div>
      )}
      {store?.station_heartbeat_stale && (
        <div className="station-banner" role="status">
          <i className="fa-solid fa-heart-pulse" aria-hidden />
          Station heartbeat is stale. Online orders may be auto-paused.
        </div>
      )}
      {store?.orders_paused && (
        <div className="station-banner" role="status">
          <i className="fa-solid fa-pause" aria-hidden />
          Store is paused
          {store.orders_paused_reason === "heartbeat"
            ? " because the tablet went offline"
            : ""}
          . Online orders are blocked.
          <button
            type="button"
            className="station-btn station-btn--primary"
            onClick={() => void resume()}
          >
            Resume
          </button>
        </div>
      )}

      {view === "orders" && (
        <div className="station-body">
          <div className="station-col">
            <h2>Needs action ({needsAction.length})</h2>
            <div className="station-list">
              {loading && !orders.length ? (
                <div className="station-empty">Loading orders…</div>
              ) : needsAction.length === 0 ? (
                <div className="station-empty">No orders waiting. You are clear.</div>
              ) : (
                needsAction.map((order) => (
                  <TicketCard
                    key={order.id}
                    order={order}
                    store={store}
                    selected={selected?.id === order.id}
                    busy={busy}
                    onSelect={() => setSelectedId(order.id)}
                    onPrimary={() => {
                      void runPrimary(order);
                    }}
                    onReject={() => void requestReject(order)}
                  />
                ))
              )}
            </div>
            <h2>Active ({active.length})</h2>
            <div className="station-list">
              {active.length === 0 ? (
                <div className="station-empty">No active prep tickets.</div>
              ) : (
                active.map((order) => (
                  <TicketCard
                    key={order.id}
                    order={order}
                    store={store}
                    selected={selected?.id === order.id}
                    busy={busy}
                    onSelect={() => setSelectedId(order.id)}
                    onPrimary={() => {
                      void runPrimary(order);
                    }}
                    onReject={() => void requestReject(order)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="station-col">
            <h2>Ticket</h2>
            {error || actionError ? (
              <div className="station-banner" style={{ borderRadius: 12 }}>
                {actionError || error}
              </div>
            ) : null}
            {selected ? (
              <OrderDetail
                order={selected}
                store={store}
                busy={busy}
                onPrimary={() => {
                  void runPrimary(selected);
                }}
                onReject={() => void requestReject(selected)}
                onBumpPrep={(delta) => void bumpPrep(selected, delta)}
              />
            ) : (
              <div className="station-empty">Select a ticket to see details.</div>
            )}
          </div>
        </div>
      )}

      {view === "history" && (
        <div className="station-panel">
          <h2>Recent history</h2>
          <p className="lead">Closed and cancelled orders from the latest fetch.</p>
          <div className="station-list" style={{ maxHeight: "70dvh" }}>
            {history.length === 0 ? (
              <div className="station-empty">No history in this window yet.</div>
            ) : (
              history.slice(0, 40).map((order) => (
                <TicketCard
                  key={order.id}
                  order={order}
                  store={store}
                  selected={false}
                  busy={false}
                  onSelect={() => undefined}
                  compact
                />
              ))
            )}
          </div>
        </div>
      )}

      {view === "settings" && (
        <div className="station-panel">
          <h2>Station settings</h2>
          <p className="lead">
            {store?.business_name ?? "Your shop"} ·{" "}
            {store ? storeStatusLabel(store) : "…"} · Prep{" "}
            {store?.effective_prep_minutes ?? "—"} min
          </p>
          <div className="station-controls">
            {store?.orders_paused ? (
              <button
                type="button"
                className="station-btn station-btn--primary station-btn--lg"
                onClick={() => void resume()}
              >
                Resume accepting
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="station-btn station-btn--danger station-btn--lg"
                  onClick={() => void pause(30)}
                >
                  Pause 30 min
                </button>
                <button
                  type="button"
                  className="station-btn station-btn--danger station-btn--lg"
                  onClick={() => void pause(null)}
                >
                  Pause until resume
                </button>
              </>
            )}
            <button
              type="button"
              className="station-btn station-btn--lg"
              onClick={() => void setBusy(10)}
            >
              Busy +10 min
            </button>
            <button
              type="button"
              className="station-btn station-btn--lg"
              onClick={() => void setBusy(0)}
            >
              Clear busy
            </button>
            <button
              type="button"
              className="station-btn station-btn--lg"
              onClick={() => setSoundOn(!soundOn)}
            >
              Sound {soundOn ? "on" : "off"}
            </button>
            <button
              type="button"
              className="station-btn station-btn--lg"
              onClick={() => {
                void refresh();
                void refreshStore();
              }}
            >
              Refresh
            </button>
          </div>
          <div className="mobile-card">
            <div className="mobile-row">
              <span>Connection</span>
              <span className={`station-pill ${online ? "station-pill--ok" : "station-pill--danger"}`}>
                {online ? "Online" : "Offline"}
              </span>
            </div>
            <div className="mobile-row" style={{ marginTop: "0.65rem" }}>
              <span>Heartbeat</span>
              <span className="station-pill station-pill--muted">
                every 60s · auto-pause after 5 min silence
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TicketCard({
  order,
  store,
  selected,
  busy,
  onSelect,
  onPrimary,
  onReject,
  compact,
}: {
  order: Order;
  store: StoreStatus | null;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onPrimary?: () => void;
  onReject?: () => void;
  compact?: boolean;
}) {
  const action = stationPrimaryAction(order);
  return (
    <div
      className={`station-ticket ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="station-ticket__head">
        <div className="station-ticket__number">{order.order_number}</div>
        <span className="station-pill station-pill--muted">
          {STATUS_LABELS[order.status]}
        </span>
      </div>
      <div className="station-ticket__meta">
        {isTransChapAgentOrder(order) && (
          <span className="station-pill station-pill--ok">TransChap Agent</span>
        )}
        <span className="station-pill">{SOURCE_LABELS[order.source]}</span>
        <span className="station-pill">
          {FULFILLMENT_LABELS[order.fulfillment_type]}
        </span>
        <span className="station-pill station-pill--warn">
          {orderPrepMinutes(order, store)} min
        </span>
        <span className="station-pill">
          {formatMoney(order.total, order.currency)}
        </span>
      </div>
      {!compact && (
        <>
          <ul className="station-ticket__items">
            {(order.items ?? []).slice(0, 4).map((item) => (
              <li key={item.id}>
                <strong>
                  {item.quantity}× {item.product_name}
                </strong>
                {item.stock_quantity != null
                  ? ` — ${item.stock_quantity} in stock`
                  : ""}
                {item.notes ? ` — ${item.notes}` : ""}
              </li>
            ))}
            {(order.items?.length ?? 0) > 4 && (
              <li>+{(order.items?.length ?? 0) - 4} more</li>
            )}
          </ul>
          {(onPrimary || onReject) && (
            <div className="station-ticket__actions">
              {action && onPrimary && (
                <button
                  type="button"
                  className="station-btn station-btn--primary"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrimary();
                  }}
                >
                  {action.label}
                </button>
              )}
              {onReject && order.status !== "cancelled" && (
                <button
                  type="button"
                  className="station-btn station-btn--danger"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject();
                  }}
                >
                  Reject
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OrderDetail({
  order,
  store,
  busy,
  onPrimary,
  onReject,
  onBumpPrep,
}: {
  order: Order;
  store: StoreStatus | null;
  busy: boolean;
  onPrimary: () => void;
  onReject: () => void;
  onBumpPrep: (delta: number) => void;
}) {
  const action = stationPrimaryAction(order);
  return (
    <div className="station-detail">
      <div className="station-detail__title">
        <div>
          <h3>{order.order_number}</h3>
          <div className="station-ticket__meta" style={{ marginTop: "0.5rem" }}>
            <span className="station-pill">{STATUS_LABELS[order.status]}</span>
            {isTransChapAgentOrder(order) && (
              <span className="station-pill station-pill--ok">TransChap Agent</span>
            )}
            <span className="station-pill">{SOURCE_LABELS[order.source]}</span>
            <span className="station-pill">
              {FULFILLMENT_LABELS[order.fulfillment_type]}
            </span>
          </div>
        </div>
        <strong>{formatMoney(order.total, order.currency)}</strong>
      </div>

      <section>
        <h4>Customer</h4>
        <p style={{ margin: 0 }}>
          {order.customer_name || "Guest"}
          {order.customer_phone ? ` · ${order.customer_phone}` : ""}
        </p>
        {order.delivery_address && (
          <p style={{ margin: "0.35rem 0 0", color: "var(--station-muted)" }}>
            {order.delivery_address}
          </p>
        )}
        {(order.delivery_notes || (order.notes && !isTransChapAgentOrder(order))) && (
          <p style={{ margin: "0.35rem 0 0", color: "var(--station-warn)" }}>
            {order.delivery_notes || order.notes}
          </p>
        )}
      </section>

      <section>
        <h4>Items</h4>
        <ul className="station-ticket__items">
          {(order.items ?? []).map((item) => (
            <li key={item.id}>
              <strong>
                {item.quantity}× {item.product_name}
              </strong>{" "}
              · {formatMoney(item.line_total, order.currency)}
              {item.stock_quantity != null
                ? ` — ${item.stock_quantity} in stock`
                : ""}
              {item.notes ? ` — ${item.notes}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Prep time</h4>
        <div className="station-ticket__actions">
          <span className="station-pill station-pill--warn">
            {orderPrepMinutes(order, store)} min
          </span>
          <button
            type="button"
            className="station-btn"
            disabled={busy}
            onClick={() => onBumpPrep(5)}
          >
            +5
          </button>
          <button
            type="button"
            className="station-btn"
            disabled={busy}
            onClick={() => onBumpPrep(10)}
          >
            +10
          </button>
          <button
            type="button"
            className="station-btn"
            disabled={busy}
            onClick={() => onBumpPrep(-5)}
          >
            −5
          </button>
        </div>
      </section>

      <div className="station-ticket__actions" style={{ marginTop: "1.25rem" }}>
        {action && (
          <button
            type="button"
            className="station-btn station-btn--primary station-btn--lg"
            disabled={busy}
            onClick={onPrimary}
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          className="station-btn station-btn--danger station-btn--lg"
          disabled={busy}
          onClick={onReject}
        >
          Reject / cancel
        </button>
      </div>
    </div>
  );
}
