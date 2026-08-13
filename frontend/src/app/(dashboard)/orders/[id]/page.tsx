"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  confirmAction,
  extractErrorMessage,
  promptMpesaTransactionEdit,
  promptMpesaReceipt,
  promptRejectReason,
  showError,
  showSuccess,
  toastSuccess,
} from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import {
  FULFILLMENT_ICONS,
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  SOURCE_ICONS,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  formatMoney,
  orderHasSuccessfulMpesa,
  orderMissingDeliveryFields,
  orderNeedsDeliveryDetails,
  orderNeedsLiveUpdates,
  orderWorkflowActions,
  orderWorkflowSteps,
  POS_SOURCES,
} from "@/lib/orders";
import type { OrderWorkflowAction } from "@/lib/types";
import type {
  Order,
  OrderDetailResponse,
  OrderMpesaTransaction,
  OrderMutationResponse,
  OrderStatus,
  RiderSummary,
  RidersListResponse,
} from "@/lib/types";
import { formatNairobiDateTime } from "@/lib/nairobi-time";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return formatNairobiDateTime(iso) || "—";
}

const ORDER_POLL_MS = 4_000;

function notifyOrderLiveUpdate(previous: Order, next: Order) {
  if (previous.status !== next.status) {
    void toastSuccess(`Order updated — ${STATUS_LABELS[next.status]}`);
    return;
  }
  if (!orderHasSuccessfulMpesa(previous) && orderHasSuccessfulMpesa(next)) {
    void toastSuccess("M-PESA payment received");
  }
}

function mpesaStatusLabel(status: string): string {
  if (status === "success") return "Paid";
  if (status === "pending") return "Awaiting customer";
  if (status === "cancelled") return "Customer cancelled";
  return "Failed";
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = params?.id ?? "";
  const shouldAutoPrint = searchParams.get("print") === "1";
  const hasAutoPrinted = useRef(false);

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [copiedTrackLink, setCopiedTrackLink] = useState(false);
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [assigningRider, setAssigningRider] = useState(false);
  const orderRef = useRef<Order | null>(null);

  orderRef.current = order;

  const refreshOrder = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!orderId) return;
      const silent = opts?.silent ?? false;
      if (!silent) setLoading(true);
      try {
        const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(orderId));
        const previous = orderRef.current;
        if (silent && previous) {
          notifyOrderLiveUpdate(previous, data.data);
        }
        setOrder(data.data);
        setError(null);
      } catch (err) {
        if (!silent) {
          setError(extractErrorMessage(err, "Failed to load order."));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    void refreshOrder();
  }, [refreshOrder]);

  useEffect(() => {
    if (!order || order.fulfillment_type !== "delivery") return;
    void apiFetch<RidersListResponse>(apiRoutes.riders)
      .then((res) => setRiders(res.data.filter((r) => r.status === "active")))
      .catch(() => setRiders([]));
  }, [order?.fulfillment_type, order?.id]);

  useEffect(() => {
    if (!order || !shouldAutoPrint || hasAutoPrinted.current) return;
    hasAutoPrinted.current = true;
    const timer = window.setTimeout(() => {
      window.print();
      const next = new URL(window.location.href);
      next.searchParams.delete("print");
      window.history.replaceState({}, "", `${next.pathname}${next.search}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [order, shouldAutoPrint]);

  async function assignRider(riderId: string) {
    if (!order) return;
    setAssigningRider(true);
    try {
      const res = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderAssignRider(order.id),
        {
          method: "POST",
          body: JSON.stringify({ rider_id: riderId }),
        },
      );
      setOrder(res.data);
      await toastSuccess("Rider assigned");
    } catch (err) {
      await showError("Could not assign rider", extractErrorMessage(err));
    } finally {
      setAssigningRider(false);
    }
  }

  useEffect(() => {
    const needsLiveUpdates = orderNeedsLiveUpdates(order);
    if (!needsLiveUpdates || actingOn !== null) return;

    const poll = () => {
      if (actingOn !== null) return;
      void refreshOrder({ silent: true });
    };

    const intervalId = window.setInterval(poll, ORDER_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [order, actingOn, refreshOrder]);

  useEffect(() => {
    const needsLiveUpdates = orderNeedsLiveUpdates(order);
    if (!needsLiveUpdates) return;

    function onFocus() {
      if (actingOn !== null) return;
      void refreshOrder({ silent: true });
    }

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [order, actingOn, refreshOrder]);

  async function copyTrackingLink() {
    if (!order?.tracking_url) return;
    try {
      await navigator.clipboard.writeText(order.tracking_url);
      setCopiedTrackLink(true);
      toastSuccess("Tracking link copied");
      window.setTimeout(() => setCopiedTrackLink(false), 2000);
    } catch {
      await showError("Couldn't copy link", "Copy the tracking URL manually.");
    }
  }

  function printReceipt() {
    window.print();
  }

  async function runWorkflowAction(action: OrderWorkflowAction) {
    if (!order) return;

    if (action.kind === "delete") {
      await deleteOrder();
      return;
    }

    if (action.kind === "mpesa_stk_push") {
      setActingOn(action.label);
      try {
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderMpesaStkPush(order.id),
          { method: "POST", body: "{}" },
        );
        setOrder(data.data);
        await showSuccess(
          "Payment request sent",
          data.mpesa_push?.message ??
            "Ask the customer to check their phone for the M-PESA prompt.",
        );
      } catch (err) {
        await showError("Couldn't send payment request", extractErrorMessage(err));
      } finally {
        setActingOn(null);
      }
      return;
    }

    if (action.kind === "confirm_handoff") {
      setActingOn(action.label);
      try {
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderConfirmHandoff(order.id),
          { method: "POST", body: "{}" },
        );
        setOrder(data.data);
        await toastSuccess(action.label);
      } catch (err) {
        await showError("Couldn't confirm handoff", extractErrorMessage(err));
      } finally {
        setActingOn(null);
      }
      return;
    }

    if (action.kind === "resend_completion_prompt") {
      setActingOn(action.label);
      try {
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderResendCompletionPrompt(order.id),
          { method: "POST", body: "{}" },
        );
        setOrder(data.data);
        await toastSuccess("Confirmation request sent");
      } catch (err) {
        await showError("Couldn't resend confirmation", extractErrorMessage(err));
      } finally {
        setActingOn(null);
      }
      return;
    }

    const target = action.to_status;
    if (!target) return;

    if (
      target === "out_for_delivery" &&
      order.fulfillment_type === "delivery" &&
      orderNeedsDeliveryDetails(order)
    ) {
      let copied = false;
      if (order.tracking_url) {
        try {
          await navigator.clipboard.writeText(order.tracking_url);
          setCopiedTrackLink(true);
          window.setTimeout(() => setCopiedTrackLink(false), 2000);
          copied = true;
        } catch {
          copied = false;
        }
      }
      await showError(
        "Delivery details required",
        copied
          ? "Tracking form link copied. Share it with the customer so they can fill delivery instructions before dispatch."
          : "Ask the customer to fill delivery instructions from the tracking form before dispatch.",
      );
      return;
    }

    if (action.kind === "confirm_mpesa_payment") {
      const receipt = await promptMpesaReceipt(
        action.label,
        "Ask the customer for their M-PESA confirmation SMS, then enter the transaction code here.",
      );
      if (!receipt) return;

      setActingOn(action.label);
      try {
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderTransition(order.id),
          {
            method: "POST",
            body: JSON.stringify({
              to_status: target,
              mpesa_receipt_number: receipt,
            }),
          },
        );
        setOrder(data.data);
        await toastSuccess(action.label);
      } catch (err) {
        await showError("Couldn't confirm payment", extractErrorMessage(err));
      } finally {
        setActingOn(null);
      }
      return;
    }

    if (action.kind === "cancel" || action.kind === "refund") {
      if (action.kind === "cancel") {
        const reason = await promptRejectReason(
          "Cancel this order?",
          "The customer will see this reason. This can't be undone.",
        );
        if (!reason) return;

        setActingOn(action.label);
        try {
          const data = await apiFetch<OrderMutationResponse>(
            apiRoutes.orderTransition(order.id),
            {
              method: "POST",
              body: JSON.stringify({ to_status: target, note: reason }),
            },
          );
          setOrder(data.data);
          await toastSuccess(action.label);
        } catch (err) {
          await showError("Couldn't update order", extractErrorMessage(err));
        } finally {
          setActingOn(null);
        }
        return;
      }

      const confirmed = await confirmAction(
        "Refund this order?",
        "The order will be marked refunded. This can't be undone.",
        "Yes, refund",
      );
      if (!confirmed) return;
    }

    setActingOn(action.label);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderTransition(order.id),
        {
          method: "POST",
          body: JSON.stringify({ to_status: target }),
        },
      );
      setOrder(data.data);
      await toastSuccess(action.label);
    } catch (err) {
      await showError("Couldn't update order", extractErrorMessage(err));
    } finally {
      setActingOn(null);
    }
  }

  async function deleteOrder() {
    if (!order) return;
    const confirmed = await confirmAction(
      "Delete this order?",
      `Order ${order.order_number} will be permanently removed. Only orders still in "placed" can be deleted.`,
      "Yes, delete",
    );
    if (!confirmed) return;
    try {
      await apiFetch(apiRoutes.order(order.id), { method: "DELETE" });
      await toastSuccess("Order deleted.");
      router.push("/orders");
    } catch (err) {
      await showError("Couldn't delete", extractErrorMessage(err));
    }
  }

  async function editMpesaTransaction(txn: OrderMpesaTransaction) {
    if (!order) return;
    const edited = await promptMpesaTransactionEdit({
      status: txn.status,
      phone_number: txn.phone_number,
      amount: txn.amount,
      result_desc: txn.result_desc ?? "",
      mpesa_receipt_number: txn.mpesa_receipt_number ?? "",
    });
    if (!edited) return;

    setActingOn("Edit M-PESA attempt");
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderMpesaTransaction(order.id, txn.id),
        {
          method: "PATCH",
          body: JSON.stringify(edited),
        },
      );
      setOrder(data.data);
      await toastSuccess("M-PESA attempt updated");
    } catch (err) {
      await showError("Couldn't update M-PESA attempt", extractErrorMessage(err));
    } finally {
      setActingOn(null);
    }
  }

  if (loading) {
    return (
      <section className="app-panel">
        <header className="orders-detail__head">
          <Skeleton variant="text" width={220} height={28} />
          <Skeleton variant="text" width={120} height={20} />
        </header>
        <Skeleton variant="rect" width="100%" height={160} />
      </section>
    );
  }

  if (error || !order) {
    return (
      <section className="app-panel">
        <p className="app-error">{error ?? "Order not found."}</p>
        <Link href="/orders" className="btn btn-ghost btn-sm">
          ← Back to orders
        </Link>
      </section>
    );
  }

  const tone = STATUS_TONES[order.status];
  const actions = orderWorkflowActions(order);
  const steps = orderWorkflowSteps(order);
  const primaryActions = actions.filter(
    (action) => action.variant === "primary" || action.variant === "secondary",
  );
  const isCompleted = Boolean(order.completed_at) || ["delivered", "picked_up"].includes(order.status);
  const secondaryActions = actions.filter((action) => {
    if (!(action.variant === "danger" || action.kind === "delete")) return false;
    if (action.kind === "cancel" && isCompleted) return false;
    return true;
  });
  const missingDeliveryFields = orderMissingDeliveryFields(order);

  return (
    <section className="app-panel orders-detail">
      <header className="orders-detail__head">
        <div>
          <Link href="/orders" className="orders-detail__back">
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            Back to orders
          </Link>
          <h1 className="app-title">
            {order.order_number}
            <span
              className={`orders-status-pill orders-status-pill--${tone} orders-status-pill--lg`}
            >
              {STATUS_LABELS[order.status]}
            </span>
          </h1>
          <p className="app-lead">
            Placed {formatDateTime(order.placed_at ?? order.created_at)}
          </p>
        </div>

        <div className="orders-detail__head-actions">
          <div className="orders-detail__transitions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={printReceipt}
            >
              <i className="fa-solid fa-print" aria-hidden="true" />
              Print receipt
            </button>
          </div>
          {order.tracking_url ? (
            <div className="orders-detail__transitions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void copyTrackingLink()}
              >
                <i
                  className={`fa-solid fa-${copiedTrackLink ? "check" : "link"}`}
                  aria-hidden="true"
                />
                {copiedTrackLink ? "Copied" : "Copy tracking link"}
              </button>
              <a
                href={order.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                Preview
              </a>
            </div>
          ) : null}
          {primaryActions.length > 0 ? (
            <div className="orders-detail__transitions">
              {primaryActions.map((action) => {
                const allowDispatchGuardClick =
                  action.to_status === "out_for_delivery" &&
                  order.fulfillment_type === "delivery" &&
                  orderNeedsDeliveryDetails(order);
                const disabled = actingOn !== null || (action.disabled && !allowDispatchGuardClick);
                return (
                <button
                  key={`${action.kind}-${action.label}`}
                  type="button"
                  className={`btn btn-sm ${
                    action.variant === "secondary" ? "btn-ghost" : "btn-primary"
                  }`}
                  onClick={() => void runWorkflowAction(action)}
                  disabled={disabled}
                  title={action.disabled ? action.disabled_reason ?? undefined : undefined}
                >
                  {actingOn === action.label ? (
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                  ) : action.icon ? (
                    <i className={`fa-solid fa-${action.icon}`} aria-hidden="true" />
                  ) : null}
                  {action.label}
                </button>
                );
              })}
            </div>
          ) : null}
          {secondaryActions.length > 0 ? (
            <div className="orders-detail__transitions orders-detail__transitions--secondary">
              {secondaryActions.map((action) => (
                <button
                  key={`${action.kind}-${action.label}`}
                  type="button"
                  className="btn btn-ghost btn-sm orders-danger"
                  onClick={() => void runWorkflowAction(action)}
                  disabled={actingOn !== null || action.disabled}
                >
                  {actingOn === action.label ? (
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                  ) : action.icon ? (
                    <i className={`fa-solid fa-${action.icon}`} aria-hidden="true" />
                  ) : null}
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {steps.length > 0 ? (
        <ol className="orders-workflow" aria-label="Order progress">
          {steps.map((step) => (
            <li
              key={step.key}
              className={`orders-workflow__step orders-workflow__step--${step.state}`}
            >
              <span className="orders-workflow__dot" aria-hidden="true" />
              <span className="orders-workflow__label">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {order.status === "awaiting_delivery_confirmation" ||
      order.status === "awaiting_pickup_confirmation" ? (
        <div className="orders-detail__card orders-detail__confirm-banner">
          <h3>Confirmation status</h3>
          <ul className="orders-confirm-list">
            <li className={order.merchant_delivery_confirmed_at ? "is-done" : "is-pending"}>
              <i
                className={`fa-solid fa-${order.merchant_delivery_confirmed_at ? "check" : "clock"}`}
                aria-hidden="true"
              />
              Shop {order.merchant_delivery_confirmed_at ? "confirmed" : "pending"}
            </li>
            <li className={order.customer_delivery_confirmed_at ? "is-done" : "is-pending"}>
              <i
                className={`fa-solid fa-${order.customer_delivery_confirmed_at ? "check" : "clock"}`}
                aria-hidden="true"
              />
              Customer {order.customer_delivery_confirmed_at ? "confirmed" : "pending"}
            </li>
          </ul>
          {order.delivery_disputed_at ? (
            <p className="app-error">
              Customer reported an issue on {formatDateTime(order.delivery_disputed_at)}.
            </p>
          ) : null}
        </div>
      ) : null}

      {order.status === "ready" &&
      order.fulfillment_type === "delivery" &&
      orderNeedsDeliveryDetails(order) ? (
        <div className="orders-detail__card orders-detail__confirm-banner">
          <h3>Waiting for delivery details</h3>
          <p className="orders-detail__hint">
            The customer needs to submit their delivery details on the tracking link
            before you can dispatch this order. Share the tracking link if they have
            not filled it in yet.
          </p>
          {missingDeliveryFields.length > 0 ? (
            <p className="orders-detail__hint">
              Still missing:{" "}
              <strong>{missingDeliveryFields.join(", ")}</strong>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="orders-detail__grid">
        <div className="orders-detail__main">
          <div className="orders-detail__card">
            <h3>Line items</h3>
            <table className="orders-detail__items">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(order.items ?? []).map((line) => (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.product_name}</strong>
                      {line.product_sku ? (
                        <div className="app-muted">{line.product_sku}</div>
                      ) : null}
                      {line.notes ? (
                        <div className="app-muted">{line.notes}</div>
                      ) : null}
                    </td>
                    <td>{line.quantity}</td>
                    <td>{formatMoney(line.unit_price, order.currency)}</td>
                    <td>
                      <strong>
                        {formatMoney(line.line_total, order.currency)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="app-muted">
                    Subtotal
                  </td>
                  <td>{formatMoney(order.subtotal, order.currency)}</td>
                </tr>
                {order.delivery_fee > 0 ? (
                  <tr>
                    <td colSpan={3} className="app-muted">
                      Delivery
                    </td>
                    <td>{formatMoney(order.delivery_fee, order.currency)}</td>
                  </tr>
                ) : null}
                {order.discount > 0 ? (
                  <tr>
                    <td colSpan={3} className="app-muted">
                      Discount
                    </td>
                    <td>−{formatMoney(order.discount, order.currency)}</td>
                  </tr>
                ) : null}
                <tr className="orders-detail__items-grand">
                  <td colSpan={3}>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>
                      {formatMoney(order.total, order.currency)}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="orders-detail__card">
            <h3>Status timeline</h3>
            <ol className="orders-timeline">
              {(order.status_history ?? []).map((event) => (
                <li key={event.id}>
                  <div className="orders-timeline__dot" aria-hidden="true" />
                  <div className="orders-timeline__body">
                    <div>
                      {event.from_status ? (
                        <span className="app-muted">
                          {STATUS_LABELS[event.from_status]} →{" "}
                        </span>
                      ) : null}
                      <strong>{STATUS_LABELS[event.to_status]}</strong>
                    </div>
                    {event.note ? (
                      <div className="app-muted">{event.note}</div>
                    ) : null}
                    <div className="app-muted orders-timeline__time">
                      {formatDateTime(event.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <aside className="orders-detail__side">
          <div className="orders-detail__card">
            <h3>Customer</h3>
            <dl className="orders-detail__defs">
              <dt>Name</dt>
              <dd>{order.customer_name ?? "—"}</dd>
              <dt>Phone</dt>
              <dd>{order.customer_phone ?? "—"}</dd>
              <dt>Email</dt>
              <dd>{order.customer_email ?? "—"}</dd>
            </dl>
          </div>

          <div className="orders-detail__card">
            <h3>Channel</h3>
            <dl className="orders-detail__defs">
              <dt>Source</dt>
              <dd>
                <span className="orders-meta-pill">
                  <i className={SOURCE_ICONS[order.source]} aria-hidden="true" />
                  {SOURCE_LABELS[order.source]}
                </span>
              </dd>
              <dt>Fulfillment</dt>
              <dd>
                <span className="orders-meta-pill">
                  <i className={FULFILLMENT_ICONS[order.fulfillment_type]} aria-hidden="true" />
                  {FULFILLMENT_LABELS[order.fulfillment_type]}
                </span>
              </dd>
              <dt>Payment</dt>
              <dd>
                {order.payment_method
                  ? PAYMENT_LABELS[order.payment_method]
                  : "—"}
              </dd>
            </dl>
          </div>

          {order.fulfillment_type === "delivery" &&
          ["ready", "out_for_delivery", "awaiting_delivery_confirmation"].includes(
            order.status,
          ) ? (
            <div className="orders-detail__card">
              <h3>
                <i className="fa-solid fa-motorcycle" aria-hidden="true" /> Rider
              </h3>
              {order.assigned_rider_name ? (
                <p>
                  Assigned to <strong>{order.assigned_rider_name}</strong>
                </p>
              ) : (
                <p className="app-muted">No rider assigned yet.</p>
              )}
              {riders.length > 0 ? (
                <label className="sf-field">
                  <span className="sr-only">Assign rider</span>
                  <select
                    disabled={assigningRider}
                    value={order.assigned_rider_id ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) void assignRider(value);
                    }}
                  >
                    <option value="">Select rider…</option>
                    {riders.map((rider) => (
                      <option key={rider.id} value={rider.id}>
                        {rider.name} ({rider.phone})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="app-muted">
                  <Link href="/settings#section-riders">Invite riders</Link> in Settings
                  to assign deliveries.
                </p>
              )}
            </div>
          ) : null}

          {order.payment_method === "mpesa" ||
          order.mpesa_transaction ||
          (order.mpesa_transactions?.length ?? 0) > 0 ? (
            <div className="orders-detail__card">
              <h3>
                <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
                M-PESA payment
              </h3>
              {order.mpesa_settlement ? (
                <dl className="orders-detail__defs orders-detail__mpesa-settlement">
                  <dt>DukAI hub account</dt>
                  <dd>
                    <code>{order.mpesa_settlement.transaction_account ?? "—"}</code>
                  </dd>
                  <dt>DukAI → your store</dt>
                  <dd>
                    {order.mpesa_settlement.payout_shortcode ? (
                      <>
                        {order.mpesa_settlement.payout_shortcode_type === "pochi"
                          ? "Pochi"
                          : order.mpesa_settlement.payout_shortcode_type === "till"
                            ? "Till"
                            : "Paybill"}{" "}
                        <code>{order.mpesa_settlement.payout_shortcode}</code>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </dl>
              ) : null}
              {(order.mpesa_transactions?.length ?? 0) > 0 ? (
                <div className="orders-detail__mpesa-list">
                  {order.mpesa_transactions!.map((txn) => (
                    <dl key={txn.id} className="orders-detail__defs orders-detail__mpesa-item">
                      <dt className="orders-detail__mpesa-edit-row" />
                      <dd className="orders-detail__mpesa-edit-row">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm orders-detail__mpesa-edit-btn"
                          onClick={() => void editMpesaTransaction(txn)}
                          disabled={actingOn !== null}
                        >
                          <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                          Edit
                        </button>
                      </dd>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={`orders-mpesa-pill orders-mpesa-pill--${txn.status}`}
                        >
                          {mpesaStatusLabel(txn.status)}
                        </span>
                      </dd>
                      <dt>Phone</dt>
                      <dd>{txn.phone_number}</dd>
                      <dt>Amount</dt>
                      <dd>{formatMoney(txn.amount, order.currency)}</dd>
                      {txn.mpesa_receipt_number ? (
                        <>
                          <dt>At DukAI</dt>
                          <dd>
                            <code>{txn.mpesa_receipt_number}</code>
                          </dd>
                        </>
                      ) : null}
                      {txn.status === "success" ? (
                        <>
                          <dt>DukAI → your store</dt>
                          <dd>
                            {txn.payout_status === "success"
                              ? `Paid out${txn.payout_receipt_number ? ` · ${txn.payout_receipt_number}` : ""}`
                              : txn.payout_status === "queued"
                                ? "Payout queued with Safaricom"
                                : txn.payout_status === "pending"
                                  ? "Sending payout…"
                                  : txn.payout_status === "failed"
                                    ? `Payout failed${txn.payout_result_desc ? ` — ${txn.payout_result_desc}` : ""}`
                                    : txn.payout_status === "skipped"
                                      ? txn.payout_result_desc || "Payout skipped"
                                      : "Pending payout"}
                          </dd>
                        </>
                      ) : null}
                      {txn.result_desc ? (
                        <>
                          <dt>Notes</dt>
                          <dd>{txn.result_desc}</dd>
                        </>
                      ) : null}
                      <dt>Sent</dt>
                      <dd>{formatDateTime(txn.created_at)}</dd>
                    </dl>
                  ))}
                </div>
              ) : order.mpesa_transaction ? (
                <dl className="orders-detail__defs">
                  <dt className="orders-detail__mpesa-edit-row" />
                  <dd className="orders-detail__mpesa-edit-row">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm orders-detail__mpesa-edit-btn"
                      onClick={() => {
                        if (!order.mpesa_transaction) return;
                        void editMpesaTransaction(order.mpesa_transaction);
                      }}
                      disabled={actingOn !== null}
                    >
                      <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                      Edit
                    </button>
                  </dd>
                  <dt>Status</dt>
                  <dd>
                    <span
                      className={`orders-mpesa-pill orders-mpesa-pill--${order.mpesa_transaction.status}`}
                    >
                      {mpesaStatusLabel(order.mpesa_transaction.status)}
                    </span>
                  </dd>
                  <dt>Phone</dt>
                  <dd>{order.mpesa_transaction.phone_number}</dd>
                  <dt>Amount</dt>
                  <dd>
                    {formatMoney(
                      order.mpesa_transaction.amount,
                      order.currency,
                    )}
                  </dd>
                  {order.mpesa_transaction.mpesa_receipt_number ? (
                    <>
                      <dt>At DukAI</dt>
                      <dd>
                        <code>
                          {order.mpesa_transaction.mpesa_receipt_number}
                        </code>
                      </dd>
                    </>
                  ) : null}
                  {order.mpesa_transaction.result_desc ? (
                    <>
                      <dt>Notes</dt>
                      <dd>{order.mpesa_transaction.result_desc}</dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="orders-detail__hint">
                  No M-PESA push has been sent yet for this order.
                </p>
              )}

              {POS_SOURCES.includes(order.source) &&
              order.status === "awaiting_payment" &&
              !order.paid_at &&
              !orderHasSuccessfulMpesa(order) ? (
                <p className="orders-detail__hint">
                  After the customer pays at the till, use{" "}
                  <strong>Confirm M-PESA payment</strong> above and enter their
                  transaction code.
                </p>
              ) : null}

              {!POS_SOURCES.includes(order.source) &&
              order.status === "awaiting_payment" &&
              !order.paid_at &&
              !orderHasSuccessfulMpesa(order) ? (
                <>
                  <p className="orders-detail__hint">
                    Use <strong>Request payment</strong> above to send the M-PESA
                    prompt.
                  </p>
                  <p className="orders-detail__hint">
                    If the customer says they have already paid, use{" "}
                    <strong>Confirm M-PESA payment</strong> above and enter the
                    transaction code from their SMS.
                  </p>
                </>
              ) : null}

              {order.status === "awaiting_payment" &&
              !order.paid_at &&
              orderHasSuccessfulMpesa(order) ? (
                <p className="orders-detail__hint">
                  M-PESA payment is showing below. Use{" "}
                  <strong>Mark payment received</strong> above to continue.
                </p>
              ) : null}
            </div>
          ) : null}

          {order.fulfillment_type === "delivery" ? (
            <div className="orders-detail__card">
              <h3>Delivery</h3>
              <dl className="orders-detail__defs">
                <dt>Address</dt>
                <dd>{order.delivery_address ?? "—"}</dd>
                <dt>Notes</dt>
                <dd>{order.delivery_notes ?? "—"}</dd>
              </dl>
            </div>
          ) : null}

          <div className="orders-detail__card">
            <h3>Milestones</h3>
            <dl className="orders-detail__defs">
              <dt>Placed</dt>
              <dd>{formatDateTime(order.placed_at)}</dd>
              <dt>Paid</dt>
              <dd>{formatDateTime(order.paid_at)}</dd>
              <dt>Prepared</dt>
              <dd>{formatDateTime(order.prepared_at)}</dd>
              <dt>Ready</dt>
              <dd>{formatDateTime(order.ready_at)}</dd>
              {order.fulfillment_type === "delivery" ? (
                <>
                  <dt>Dispatched</dt>
                  <dd>{formatDateTime(order.dispatched_at)}</dd>
                </>
              ) : null}
              <dt>Completed</dt>
              <dd>{formatDateTime(order.completed_at)}</dd>
              {order.cancelled_at ? (
                <>
                  <dt>Cancelled</dt>
                  <dd>{formatDateTime(order.cancelled_at)}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </aside>
      </div>

      <section className="orders-receipt-print" aria-hidden="true">
        <header className="orders-receipt-print__head">
          <h2>Sales Receipt</h2>
          <p>Order #{order.order_number}</p>
        </header>

        <dl className="orders-receipt-print__meta">
          <div>
            <dt>Date</dt>
            <dd>{formatDateTime(order.placed_at ?? order.created_at)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{STATUS_LABELS[order.status]}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{order.customer_name ?? "Walk-in customer"}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>{order.payment_method ? PAYMENT_LABELS[order.payment_method] : "Pay later"}</dd>
          </div>
        </dl>

        <table className="orders-receipt-print__items">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(order.items ?? []).map((line) => (
              <tr key={line.id}>
                <td>{line.product_name}</td>
                <td>{line.quantity}</td>
                <td>{formatMoney(line.unit_price, order.currency)}</td>
                <td>{formatMoney(line.line_total, order.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Subtotal</td>
              <td>{formatMoney(order.subtotal, order.currency)}</td>
            </tr>
            {order.delivery_fee > 0 ? (
              <tr>
                <td colSpan={3}>Delivery</td>
                <td>{formatMoney(order.delivery_fee, order.currency)}</td>
              </tr>
            ) : null}
            {order.discount > 0 ? (
              <tr>
                <td colSpan={3}>Discount</td>
                <td>-{formatMoney(order.discount, order.currency)}</td>
              </tr>
            ) : null}
            <tr className="orders-receipt-print__grand">
              <td colSpan={3}>Total</td>
              <td>{formatMoney(order.total, order.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </section>
  );
}
