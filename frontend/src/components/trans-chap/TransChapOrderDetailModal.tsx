"use client";

import { useEffect, useState, useId } from "react";
import Link from "next/link";
import { MotionModal } from "@/components/app/MotionModal";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { markTransChapOrderOpened } from "@/lib/use-trans-chap-nav-counts";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  orderPaymentLabel,
  orderUsesPayment,
  orderHasSuccessfulMpesa,
} from "@/lib/orders";
import type { Order, OrderMutationResponse, OrderPaymentMethod } from "@/lib/types";

function formatKsh(amount: number): string {
  return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
}

type Props = {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onOrderUpdated: (updated: Order) => void;
  onReturnGoods?: (order: Order) => void;
  onVoidOrder?: (order: Order) => void;
  restaurant?: boolean;
};

export function TransChapOrderDetailModal({
  order,
  open,
  onClose,
  onOrderUpdated,
  onReturnGoods,
  onVoidOrder,
  restaurant = false,
}: Props) {
  const formId = useId();
  const [method, setMethod] = useState<OrderPaymentMethod>("cash");
  const [mpesaReceipt, setMpesaReceipt] = useState("");
  const [note, setNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [editPaymentOpen, setEditPaymentOpen] = useState(false);

  useEffect(() => {
    if (open && order?.id) {
      markTransChapOrderOpened(order.account_id, order.id);
    }
  }, [open, order?.id, order?.account_id]);

  if (!order) return null;

  const isPaid = Boolean(order.paid_at);
  const items = order.items ?? [];
  const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const hasReturns = Number(order.returned_total || 0) > 0;
  const isCancelled = order.status === "cancelled" || order.status === "refunded";

  async function handleRecordPayment(markAsPaid: boolean) {
    if (!order) return;
    if (!markAsPaid) {
      const confirmed = await confirmAction(
        "Mark order as unpaid?",
        `Are you sure you want to mark ${order.order_number} as unpaid? The bill will need to be settled again.`,
        "Mark unpaid",
      );
      if (!confirmed) return;
    }

    setIsBusy(true);
    try {
      const payload: Record<string, any> = {
        is_paid: markAsPaid,
      };

      if (markAsPaid) {
        payload.payment_method = method;
        if (method === "mpesa" && mpesaReceipt.trim()) {
          payload.mpesa_receipt_number = mpesaReceipt.trim().toUpperCase();
        }
        if (note.trim()) {
          payload.note = note.trim();
        }
      } else {
        payload.note = note.trim() || "Recorded as unpaid";
      }

      const res = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderRecordPayment(order.id),
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

      onOrderUpdated(res.data);
      setEditPaymentOpen(false);
      setMpesaReceipt("");
      setNote("");
      await toastSuccess(
        markAsPaid ? "Payment recorded successfully" : "Order marked as unpaid",
      );
    } catch (err) {
      await showError("Could not update payment status", extractErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendStkPush() {
    if (!order) return;
    if (!order.customer_phone?.trim()) {
      await showError(
        "Phone number required",
        "This order doesn't have a customer phone number to send an M-PESA STK push.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const res = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderMpesaStkPush(order.id),
        {
          method: "POST",
          body: "{}",
        },
      );
      onOrderUpdated(res.data);
      if (res.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent to customer phone");
      } else {
        await toastSuccess("M-PESA request sent");
      }
    } catch (err) {
      await showError("Could not send M-PESA prompt", extractErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel={`Order details for ${order.order_number}`}
      panelClassName="trans-chap-order-detail-modal"
    >
      <div className="trans-chap-order-detail">
        {/* Header */}
        <div className="trans-chap-order-detail__header">
          <div className="trans-chap-order-detail__title-wrap">
            <div className="trans-chap-order-detail__num-row">
              <span className="trans-chap-order-detail__ref">
                {order.order_number}
              </span>
              {restaurant && order.table_number ? (
                <span className="trans-chap-order-detail__table-badge">
                  <i className="fa-solid fa-utensils" aria-hidden />{" "}
                  {order.table_number}
                </span>
              ) : null}
              <span className={`trans-chap-order-detail__status-badge is-${order.status}`}>
                {order.status.replace(/_/g, " ").toUpperCase()}
              </span>
            </div>
            <p className="trans-chap-order-detail__date">
              <i className="fa-regular fa-clock" aria-hidden />{" "}
              {formatNairobiDateTime(order.created_at) || "—"}
            </p>
          </div>
          <button
            type="button"
            className="trans-chap-modal__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <i className="fa-solid fa-xmark" aria-hidden />
          </button>
        </div>

        {/* Content Body */}
        <div className="trans-chap-order-detail__body">
          {/* Customer & Dining Info */}
          <div className="trans-chap-order-detail__meta-grid">
            <div className="trans-chap-order-detail__meta-box">
              <span className="trans-chap-order-detail__meta-label">Customer</span>
              <strong className="trans-chap-order-detail__meta-val">
                {order.customer_name?.trim() || "Walk-in Guest"}
              </strong>
              {order.customer_phone ? (
                <a
                  href={`tel:${order.customer_phone}`}
                  className="trans-chap-order-detail__phone-link"
                >
                  <i className="fa-solid fa-phone" aria-hidden /> {order.customer_phone}
                </a>
              ) : null}
            </div>

            <div className="trans-chap-order-detail__meta-box">
              <span className="trans-chap-order-detail__meta-label">Order Type</span>
              <strong className="trans-chap-order-detail__meta-val">
                {order.fulfillment_type === "dine_in"
                  ? "Dine-in"
                  : order.fulfillment_type === "delivery"
                    ? "Delivery"
                    : "Takeaway / Pickup"}
              </strong>
              <span className="trans-chap-order-detail__source">
                Source: {order.source || "POS"}
              </span>
            </div>
          </div>

          {/* Payment Workflow Section */}
          <div
            className={`trans-chap-order-detail__payment-card${
              isPaid ? " is-paid" : " is-unpaid"
            }`}
          >
            <div className="trans-chap-order-detail__payment-header">
              <div className="trans-chap-order-detail__payment-status-pill">
                <i
                  className={
                    isPaid
                      ? "fa-solid fa-circle-check"
                      : "fa-solid fa-circle-exclamation"
                  }
                  aria-hidden
                />
                <span>{isPaid ? "Bill Paid" : "Bill Unpaid / Pending"}</span>
              </div>
              <strong className="trans-chap-order-detail__payment-total">
                {formatKsh(order.total)}
              </strong>
            </div>

            {isPaid && !editPaymentOpen ? (
              <div className="trans-chap-order-detail__paid-info">
                <div className="trans-chap-order-detail__paid-facts">
                  <div>
                    <span>Method</span>
                    <strong>{orderPaymentLabel(order)}</strong>
                  </div>
                  {order.paid_at ? (
                    <div>
                      <span>Paid At</span>
                      <strong>{formatNairobiDateTime(order.paid_at)}</strong>
                    </div>
                  ) : null}
                  {order.mpesa_transaction?.mpesa_receipt_number ? (
                    <div>
                      <span>M-PESA Code</span>
                      <strong className="trans-chap-order-detail__mono">
                        {order.mpesa_transaction.mpesa_receipt_number}
                      </strong>
                    </div>
                  ) : null}
                </div>

                {!isCancelled ? (
                  <div className="trans-chap-order-detail__payment-actions">
                    <button
                      type="button"
                      className="trans-chap-order-detail__btn-outline-danger"
                      disabled={isBusy}
                      onClick={() => void handleRecordPayment(false)}
                      title="Mark order as unpaid"
                    >
                      <i className="fa-solid fa-arrow-rotate-left" aria-hidden />{" "}
                      Mark as Unpaid
                    </button>
                    <button
                      type="button"
                      className="trans-chap-order-detail__btn-outline"
                      disabled={isBusy}
                      onClick={() => {
                        setMethod(order.payment_method || "cash");
                        setEditPaymentOpen(true);
                      }}
                      title="Update payment method or transaction code"
                    >
                      <i className="fa-solid fa-pen" aria-hidden /> Edit Payment
                    </button>
                  </div>
                ) : null}
              </div>
            ) : !isCancelled ? (
              <div className="trans-chap-order-detail__record-form">
                <p className="trans-chap-order-detail__form-lead">
                  {editPaymentOpen
                    ? "Update payment recording:"
                    : "Record payment for this order:"}
                </p>

                {/* Method selector pills */}
                <div className="trans-chap-order-detail__methods">
                  {(
                    [
                      { id: "cash", label: "Cash", icon: "fa-money-bill-wave" },
                      { id: "mpesa", label: "M-PESA", icon: "fa-mobile-screen-button" },
                      { id: "card", label: "Card", icon: "fa-credit-card" },
                      { id: "credit", label: "Tab / Credit", icon: "fa-book" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`trans-chap-order-detail__method-btn${
                        method === m.id ? " is-active" : ""
                      }`}
                      onClick={() => setMethod(m.id)}
                    >
                      <i className={`fa-solid ${m.icon}`} aria-hidden />
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* M-PESA Code input if M-PESA */}
                {method === "mpesa" ? (
                  <div className="trans-chap-order-detail__field">
                    <label htmlFor={`${formId}-mpesa-code`}>
                      M-PESA Transaction Code (from SMS)
                    </label>
                    <div className="trans-chap-order-detail__input-with-action">
                      <input
                        id={`${formId}-mpesa-code`}
                        type="text"
                        placeholder="e.g. QHX892LKL9"
                        value={mpesaReceipt}
                        onChange={(e) => setMpesaReceipt(e.target.value.toUpperCase())}
                        maxLength={20}
                      />
                      {order.customer_phone ? (
                        <button
                          type="button"
                          className="trans-chap-order-detail__stk-btn"
                          disabled={isBusy}
                          onClick={() => void handleSendStkPush()}
                          title="Prompt customer's phone for payment"
                        >
                          <i className="fa-solid fa-paper-plane" aria-hidden /> STK Push
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {/* Optional Note */}
                <div className="trans-chap-order-detail__field">
                  <label htmlFor={`${formId}-note`}>Note (optional)</label>
                  <input
                    id={`${formId}-note`}
                    type="text"
                    placeholder="e.g. Paid at counter by table guest"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                {/* Form Buttons */}
                <div className="trans-chap-order-detail__form-btns">
                  {editPaymentOpen ? (
                    <button
                      type="button"
                      className="trans-chap-order-detail__btn-outline"
                      onClick={() => setEditPaymentOpen(false)}
                      disabled={isBusy}
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="trans-chap-order-detail__btn-primary-pay"
                    disabled={isBusy}
                    onClick={() => void handleRecordPayment(true)}
                  >
                    <i className="fa-solid fa-circle-check" aria-hidden />
                    {isBusy
                      ? "Recording…"
                      : `Record as Paid (${formatKsh(order.total)})`}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Items breakdown */}
          <div className="trans-chap-order-detail__items-section">
            <div className="trans-chap-order-detail__section-head">
              <h4>Ordered Items ({totalQty})</h4>
            </div>

            <div className="trans-chap-order-detail__items-list">
              {items.map((item, idx) => {
                const mods = item.modifiers ?? [];
                return (
                  <div
                    key={item.id || `${item.product_name}-${idx}`}
                    className="trans-chap-order-detail__item-row"
                  >
                    <div className="trans-chap-order-detail__item-info">
                      <div className="trans-chap-order-detail__item-main">
                        <span className="trans-chap-order-detail__item-name">
                          {item.product_name}
                        </span>
                        <span className="trans-chap-order-detail__item-qty">
                          × {item.quantity}
                        </span>
                      </div>
                      {mods.length > 0 ? (
                        <div className="trans-chap-order-detail__item-mods">
                          {mods.map((mod, mIdx) => (
                            <span
                              key={`${mod.name}-${mIdx}`}
                              className="trans-chap-order-detail__mod-chip"
                            >
                              {mod.name}
                              {mod.price ? ` (+${formatKsh(mod.price)})` : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.notes ? (
                        <p className="trans-chap-order-detail__item-notes">
                          <em>Note:</em> {item.notes}
                        </p>
                      ) : null}
                      {Number(item.returned_quantity || 0) > 0 ? (
                        <span className="trans-chap-order-detail__returned-badge">
                          <i className="fa-solid fa-arrow-rotate-left" aria-hidden />{" "}
                          {item.returned_quantity} returned
                        </span>
                      ) : null}
                    </div>
                    <strong className="trans-chap-order-detail__item-total">
                      {formatKsh(item.line_total)}
                    </strong>
                  </div>
                );
              })}
            </div>

            {/* Financial summary breakdown */}
            <div className="trans-chap-order-detail__totals">
              <div className="trans-chap-order-detail__total-row">
                <span>Subtotal</span>
                <span>{formatKsh(order.subtotal || order.total)}</span>
              </div>
              {Number(order.discount || 0) > 0 ? (
                <div className="trans-chap-order-detail__total-row is-discount">
                  <span>Discount</span>
                  <span>-{formatKsh(order.discount)}</span>
                </div>
              ) : null}
              {Number(order.delivery_fee || 0) > 0 ? (
                <div className="trans-chap-order-detail__total-row">
                  <span>Delivery fee</span>
                  <span>+{formatKsh(order.delivery_fee)}</span>
                </div>
              ) : null}
              {hasReturns ? (
                <div className="trans-chap-order-detail__total-row is-return">
                  <span>Returned goods</span>
                  <span>-{formatKsh(order.returned_total || 0)}</span>
                </div>
              ) : null}
              <div className="trans-chap-order-detail__total-row is-grand">
                <strong>Total Amount</strong>
                <strong>{formatKsh(order.total)}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="trans-chap-order-detail__footer">
          <div className="trans-chap-order-detail__footer-left">
            <Link
              href={`/orders/${order.id}`}
              className="trans-chap-order-detail__footer-link"
              title="Open full order management page"
            >
              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden /> Full Order Page
            </Link>
            <Link
              href={`/trans-chap/sales/receipt?id=${order.id}`}
              className="trans-chap-order-detail__footer-link"
              title="Open customer receipt"
            >
              <i className="fa-solid fa-receipt" aria-hidden /> View Receipt
            </Link>
          </div>

          <div className="trans-chap-order-detail__footer-right">
            {onReturnGoods && !isCancelled ? (
              <button
                type="button"
                className="trans-chap-order-detail__btn-subtle"
                onClick={() => {
                  onClose();
                  onReturnGoods(order);
                }}
              >
                <i className="fa-solid fa-box-open" aria-hidden /> Return Goods
              </button>
            ) : null}
            {onVoidOrder && !isCancelled ? (
              <button
                type="button"
                className="trans-chap-order-detail__btn-danger"
                onClick={() => {
                  onClose();
                  onVoidOrder(order);
                }}
              >
                <i className="fa-solid fa-ban" aria-hidden /> Void / Refund
              </button>
            ) : null}
            <button
              type="button"
              className="trans-chap-order-detail__btn-close"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </MotionModal>
  );
}
