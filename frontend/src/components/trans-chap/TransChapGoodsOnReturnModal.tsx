"use client";

import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { MotionModal } from "@/components/app/MotionModal";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatMoney } from "@/lib/orders";
import type { Order, OrderMutationResponse, OrderReturnPayload } from "@/lib/types";

export type GoodsOnReturnModalProps = {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (updated: Order) => void;
};

type LineDraft = {
  orderItemId: string;
  productName: string;
  boughtQty: number;
  returnedQty: number;
  availableQty: number;
  unitPrice: number;
  selected: boolean;
  returnQty: number;
  condition: "restock" | "damaged";
};

const COMMON_REASONS = [
  "Customer changed mind",
  "Defective or damaged",
  "Wrong item or size",
  "Expired / near expiry",
  "Incorrect billing",
] as const;

export function TransChapGoodsOnReturnModal({
  order,
  open,
  onClose,
  onSuccess,
}: GoodsOnReturnModalProps) {
  const baseId = useId();
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [reason, setReason] = useState<string>("Customer changed mind");
  const [customReason, setCustomReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "mpesa" | "credit" | "none">("cash");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customRefundAmount, setCustomRefundAmount] = useState<string>("");

  useEffect(() => {
    if (!order || !open) return;
    const initialLines: LineDraft[] = (order.items ?? []).map((item) => {
      const returned = item.returned_quantity || 0;
      const available = Math.max(0, item.quantity - returned);
      return {
        orderItemId: item.id,
        productName: item.product_name,
        boughtQty: item.quantity,
        returnedQty: returned,
        availableQty: available,
        unitPrice: Number(item.unit_price) || 0,
        selected: available > 0,
        returnQty: available > 0 ? 1 : 0,
        condition: "restock",
      };
    });
    setLines(initialLines);
    setReason("Customer changed mind");
    setCustomReason("");
    setNotes("");
    setCustomRefundAmount("");

    // Default refund method based on order payment
    if (order.payment_method === "credit") {
      setRefundMethod("credit");
    } else if (order.payment_method === "mpesa") {
      setRefundMethod("mpesa");
    } else {
      setRefundMethod("cash");
    }
  }, [order, open]);

  const currency = order?.currency || "KES";

  const selectedLines = useMemo(
    () => lines.filter((line) => line.selected && line.returnQty > 0),
    [lines],
  );

  const calculatedTotal = useMemo(() => {
    return selectedLines.reduce(
      (sum, line) => sum + line.unitPrice * line.returnQty,
      0,
    );
  }, [selectedLines]);

  const effectiveRefundAmount =
    customRefundAmount.trim() !== ""
      ? Math.max(0, parseFloat(customRefundAmount) || 0)
      : calculatedTotal;

  function toggleLine(index: number) {
    setLines((prev) =>
      prev.map((line, idx) =>
        idx === index ? { ...line, selected: !line.selected } : line,
      ),
    );
  }

  function updateQty(index: number, nextQty: number) {
    setLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== index) return line;
        const clamped = Math.max(1, Math.min(nextQty, line.availableQty));
        return { ...line, returnQty: clamped, selected: true };
      }),
    );
  }

  function updateCondition(index: number, condition: "restock" | "damaged") {
    setLines((prev) =>
      prev.map((line, idx) => (idx === index ? { ...line, condition } : line)),
    );
  }

  function selectAll() {
    const allSelected = lines.every((l) => l.availableQty === 0 || l.selected);
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        selected: !allSelected && l.availableQty > 0,
        returnQty: l.returnQty > 0 ? l.returnQty : (l.availableQty > 0 ? 1 : 0),
      })),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!order) return;

    if (!selectedLines.length) {
      await showError("Select items", "Select at least one item to return.");
      return;
    }

    for (const line of selectedLines) {
      if (line.returnQty <= 0) {
        await showError(
          "Invalid quantity",
          `Enter a return quantity for ${line.productName}.`,
        );
        return;
      }
      if (line.returnQty > line.availableQty) {
        await showError(
          "Exceeds available",
          `Cannot return ${line.returnQty} of ${line.productName}. Only ${line.availableQty} available.`,
        );
        return;
      }
    }

    const finalReason =
      reason === "Other"
        ? customReason.trim() || "Goods on return"
        : reason;

    if (!finalReason) {
      await showError("Return reason", "Please provide a reason for the return.");
      return;
    }

    const payload: OrderReturnPayload = {
      items: selectedLines.map((line) => ({
        order_item_id: line.orderItemId,
        quantity: line.returnQty,
        condition: line.condition,
      })),
      reason: finalReason,
      notes: notes.trim() || null,
      refund_payment_method: refundMethod,
      refund_amount: effectiveRefundAmount,
    };

    setSubmitting(true);
    try {
      const res = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderReturns(order.id),
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      await toastSuccess("Goods on return recorded");
      onSuccess(res.data);
      onClose();
    } catch (err) {
      await showError("Could not record return", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!order) return null;

  const returnableLines = lines.filter((l) => l.availableQty > 0);
  const fullyReturned = lines.length > 0 && returnableLines.length === 0;

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabelledBy={`${baseId}-title`}
      panelClassName="trans-chap-purchase-modal trans-chap-return-modal"
    >
      <header className="inventory-modal__head">
        <div className="trans-chap-purchase-modal__heading">
          <h2 id={`${baseId}-title`}>
            <i className="fa-solid fa-arrow-rotate-left" style={{ marginRight: 8, color: "var(--app-primary)" }} aria-hidden />
            Record Goods on Return
          </h2>
          <p>
            Order #{order.order_number} · Customer: {order.customer_name?.trim() || "Walk-in"}
          </p>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          disabled={submitting}
          onClick={onClose}
        >
          <i className="fa-solid fa-xmark" aria-hidden />
        </button>
      </header>

      <form
        className="inventory-modal__body trans-chap-purchase-modal__body"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="trans-chap-purchase-modal__grid" style={{ gap: "1rem" }}>
          {fullyReturned ? (
            <div
              style={{
                padding: "1.25rem",
                borderRadius: "12px",
                background: "var(--app-surface-muted, #f8f9fc)",
                border: "1px solid var(--app-border, #e5e7eb)",
                textAlign: "center",
              }}
            >
              <i
                className="fa-solid fa-circle-check"
                style={{ fontSize: "2rem", color: "#10b981", marginBottom: "0.5rem" }}
                aria-hidden
              />
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                All items on this sale have already been returned.
              </h3>
              <p style={{ margin: "0.25rem 0 0", color: "var(--app-text-secondary, #6b7280)", fontSize: "0.85rem" }}>
                Total returned: {formatMoney(order.returned_total || 0, currency)}
              </p>
            </div>
          ) : (
            <>
              {/* Items Section */}
              <div className="trans-chap-purchase-modal__span">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--app-text)" }}>
                    Select goods being returned:
                  </span>
                  <button
                    type="button"
                    onClick={selectAll}
                    style={{
                      border: "none",
                      background: "none",
                      color: "var(--app-primary)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "4px 8px",
                      borderRadius: "6px",
                    }}
                  >
                    {lines.every((l) => l.availableQty === 0 || l.selected)
                      ? "Unselect all"
                      : "Select all"}
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.6rem",
                  }}
                >
                  {lines.map((line, idx) => {
                    const lineDisabled = line.availableQty === 0;
                    return (
                      <div
                        key={line.orderItemId}
                        style={{
                          border: `1.5px solid ${
                            line.selected && !lineDisabled
                              ? "var(--app-primary)"
                              : "var(--app-border, #e5e7eb)"
                          }`,
                          borderRadius: "10px",
                          padding: "0.75rem 0.85rem",
                          background: lineDisabled
                            ? "var(--app-surface-muted, #f9fafb)"
                            : line.selected
                              ? "color-mix(in srgb, var(--app-primary) 6%, transparent)"
                              : "var(--app-surface, #ffffff)",
                          opacity: lineDisabled ? 0.6 : 1,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.5rem",
                          }}
                        >
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.65rem",
                              cursor: lineDisabled ? "not-allowed" : "pointer",
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={line.selected && !lineDisabled}
                              disabled={lineDisabled}
                              onChange={() => toggleLine(idx)}
                              style={{ width: "18px", height: "18px", accentColor: "var(--app-primary)" }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <strong
                                style={{
                                  display: "block",
                                  fontSize: "0.92rem",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {line.productName}
                              </strong>
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "var(--app-text-secondary, #6b7280)",
                                }}
                              >
                                {formatMoney(line.unitPrice, currency)} each · Bought: {line.boughtQty}
                                {line.returnedQty > 0 ? ` (Prev. returned: ${line.returnedQty})` : ""}
                              </span>
                            </div>
                          </label>

                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <strong style={{ fontSize: "0.92rem", color: "var(--app-text)" }}>
                              {line.selected && !lineDisabled
                                ? formatMoney(line.unitPrice * line.returnQty, currency)
                                : "—"}
                            </strong>
                          </div>
                        </div>

                        {line.selected && !lineDisabled ? (
                          <div
                            style={{
                              marginTop: "0.65rem",
                              paddingTop: "0.65rem",
                              borderTop: "1px dashed var(--app-border, #e5e7eb)",
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "0.5rem",
                            }}
                          >
                            {/* Quantity Controls */}
                            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                              <span style={{ fontSize: "0.78rem", color: "var(--app-text-secondary)", fontWeight: 600 }}>
                                Return Qty:
                              </span>
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  border: "1px solid var(--app-border, #d1d5db)",
                                  borderRadius: "8px",
                                  overflow: "hidden",
                                  background: "#fff",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => updateQty(idx, line.returnQty - 1)}
                                  disabled={line.returnQty <= 1}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    width: "28px",
                                    height: "28px",
                                    cursor: line.returnQty <= 1 ? "not-allowed" : "pointer",
                                    color: "var(--app-text)",
                                  }}
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  max={line.availableQty}
                                  value={line.returnQty}
                                  onChange={(e) => updateQty(idx, parseInt(e.target.value, 10) || 1)}
                                  style={{
                                    width: "40px",
                                    textAlign: "center",
                                    border: "none",
                                    fontSize: "0.85rem",
                                    fontWeight: 700,
                                    outline: "none",
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => updateQty(idx, line.returnQty + 1)}
                                  disabled={line.returnQty >= line.availableQty}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    width: "28px",
                                    height: "28px",
                                    cursor: line.returnQty >= line.availableQty ? "not-allowed" : "pointer",
                                    color: "var(--app-text)",
                                  }}
                                >
                                  +
                                </button>
                              </div>
                              <span style={{ fontSize: "0.74rem", color: "var(--app-text-secondary)" }}>
                                / max {line.availableQty}
                              </span>
                            </div>

                            {/* Restock Condition */}
                            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                              <button
                                type="button"
                                onClick={() => updateCondition(idx, "restock")}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "0.74rem",
                                  fontWeight: 600,
                                  border: `1px solid ${
                                    line.condition === "restock"
                                      ? "#10b981"
                                      : "var(--app-border, #d1d5db)"
                                  }`,
                                  background:
                                    line.condition === "restock"
                                      ? "rgba(16, 185, 129, 0.12)"
                                      : "transparent",
                                  color: line.condition === "restock" ? "#065f46" : "var(--app-text-secondary)",
                                  cursor: "pointer",
                                }}
                              >
                                <i className="fa-solid fa-boxes-packing" style={{ marginRight: 4 }} aria-hidden />
                                Restock
                              </button>
                              <button
                                type="button"
                                onClick={() => updateCondition(idx, "damaged")}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "0.74rem",
                                  fontWeight: 600,
                                  border: `1px solid ${
                                    line.condition === "damaged"
                                      ? "#f59e0b"
                                      : "var(--app-border, #d1d5db)"
                                  }`,
                                  background:
                                    line.condition === "damaged"
                                      ? "rgba(245, 158, 11, 0.12)"
                                      : "transparent",
                                  color: line.condition === "damaged" ? "#92400e" : "var(--app-text-secondary)",
                                  cursor: "pointer",
                                }}
                              >
                                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 4 }} aria-hidden />
                                Damaged
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Refund Method & Reason */}
              <div
                className="trans-chap-purchase-modal__span"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.85rem",
                }}
              >
                <div className="auth-split__field">
                  <label htmlFor={`${baseId}-refund-method`}>Refund method</label>
                  <div className="trans-chap-input">
                    <select
                      id={`${baseId}-refund-method`}
                      className="auth-split__input"
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value as any)}
                      style={{ paddingRight: "1rem" }}
                    >
                      <option value="cash">Cash refund</option>
                      <option value="mpesa">M-PESA refund</option>
                      <option value="credit">Deduct customer credit tab</option>
                      <option value="none">No monetary refund (Exchange/Write-off)</option>
                    </select>
                  </div>
                </div>

                <div className="auth-split__field">
                  <label htmlFor={`${baseId}-refund-amount`}>
                    Refund amount <span>(auto: {formatMoney(calculatedTotal, currency)})</span>
                  </label>
                  <div className="trans-chap-input">
                    <input
                      id={`${baseId}-refund-amount`}
                      type="number"
                      step="0.01"
                      className="auth-split__input"
                      placeholder={calculatedTotal.toFixed(2)}
                      value={customRefundAmount}
                      onChange={(e) => setCustomRefundAmount(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Return Reason Chips */}
              <div className="auth-split__field trans-chap-purchase-modal__span">
                <span className="trans-chap-form__label" id={`${baseId}-reason-label`}>
                  Reason for return
                </span>
                <div
                  className="trans-chap-form__chips"
                  role="group"
                  aria-labelledby={`${baseId}-reason-label`}
                  style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}
                >
                  {COMMON_REASONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={`trans-chap-form__chip${reason === opt ? " is-active" : ""}`}
                      onClick={() => setReason(opt)}
                      style={{ fontSize: "0.78rem" }}
                    >
                      {opt}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`trans-chap-form__chip${reason === "Other" ? " is-active" : ""}`}
                    onClick={() => setReason("Other")}
                    style={{ fontSize: "0.78rem" }}
                  >
                    Other…
                  </button>
                </div>
              </div>

              {reason === "Other" ? (
                <div className="auth-split__field trans-chap-purchase-modal__span">
                  <label htmlFor={`${baseId}-custom-reason`}>Specify reason</label>
                  <div className="trans-chap-input">
                    <input
                      id={`${baseId}-custom-reason`}
                      type="text"
                      required
                      className="auth-split__input"
                      placeholder="e.g. Broken seal, wrong color"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {/* Notes */}
              <div className="auth-split__field trans-chap-purchase-modal__span">
                <label htmlFor={`${baseId}-notes`}>
                  Staff notes <span>(optional)</span>
                </label>
                <div className="trans-chap-input">
                  <textarea
                    id={`${baseId}-notes`}
                    rows={2}
                    className="auth-split__input"
                    placeholder="Any notes about customer interaction or condition..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ resize: "vertical", height: "auto", minHeight: "60px", padding: "8px" }}
                  />
                </div>
              </div>

              {/* Live Summary Box */}
              <div
                className="trans-chap-purchase-modal__span"
                style={{
                  background: "var(--app-surface-muted, #f8f9fc)",
                  borderRadius: "10px",
                  padding: "0.85rem 1rem",
                  border: "1px solid var(--app-border, #e5e7eb)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <span style={{ fontSize: "0.78rem", color: "var(--app-text-secondary)" }}>
                    Items selected:
                  </span>
                  <strong style={{ display: "block", fontSize: "0.95rem" }}>
                    {selectedLines.reduce((s, l) => s + l.returnQty, 0)} piece(s)
                  </strong>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--app-text-secondary)" }}>
                    Total refund:
                  </span>
                  <strong
                    style={{
                      display: "block",
                      fontSize: "1.15rem",
                      color: "var(--app-primary)",
                      fontWeight: 800,
                    }}
                  >
                    {formatMoney(effectiveRefundAmount, currency)}
                  </strong>
                </div>
              </div>
            </>
          )}
        </div>

        <div
          className="inventory-modal__actions trans-chap-purchase-modal__actions"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr",
            gap: "0.75rem",
            padding: "0.9rem 1.25rem 1.1rem",
            borderTop: "1px solid var(--app-border, #e5e7eb)",
            background: "var(--app-surface, #ffffff)",
          }}
        >
          <button
            type="button"
            className="trans-chap-form__secondary"
            disabled={submitting}
            onClick={onClose}
            style={{
              minHeight: "48px",
              padding: "0.65rem 1rem",
              borderRadius: "12px",
              border: "1px solid var(--app-border, #d1d5db)",
              background: "var(--app-surface, #ffffff)",
              color: "var(--app-text, #1f2937)",
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Cancel
          </button>
          {!fullyReturned ? (
            <button
              type="submit"
              disabled={submitting || !selectedLines.length}
              style={{
                minHeight: "48px",
                padding: "0.65rem 1.25rem",
                borderRadius: "12px",
                border: "none",
                background: !selectedLines.length
                  ? "#fdba74"
                  : "linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-hover) 100%)",
                color: !selectedLines.length ? "#ffffff" : "var(--app-primary-text)",
                fontSize: "0.95rem",
                fontWeight: 750,
                cursor: submitting || !selectedLines.length ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : !selectedLines.length ? 0.65 : 1,
                boxShadow: !selectedLines.length
                  ? "none"
                  : "0 4px 14px rgba(234, 88, 12, 0.35)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                transition: "all 0.15s ease",
              }}
            >
              {submitting ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden /> Recording…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-arrow-rotate-left" aria-hidden /> Record return (
                  {formatMoney(effectiveRefundAmount, currency)})
                </>
              )}
            </button>
          ) : null}
        </div>
      </form>
    </MotionModal>
  );
}
