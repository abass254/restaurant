"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import {
  extractErrorMessage,
  promptVoidReason,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  PAYMENT_STATUS_LABELS,
  PO_STATUS_LABELS,
  cancelPurchaseOrder,
  fetchPurchaseOrder,
  formatQty,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  recordPurchaseOrderPayment,
  voidPurchaseOrderReceipt,
  type PurchaseOrder,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { paymentTone, poStatusTone } from "./RestaurantSuppliesHub";

type ReceiveDraft = Record<string, { qty: string; cost: string }>;

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function receiveDraftFor(po: PurchaseOrder): ReceiveDraft {
  const draft: ReceiveDraft = {};
  for (const line of po.lines) {
    draft[line.id] = {
      qty: line.quantity_outstanding > 0 ? String(line.quantity_outstanding) : "",
      cost: String(line.unit_cost),
    };
  }
  return draft;
}

export function RestaurantPurchaseOrderDetail() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const user = useAuthUser();
  const canVoid = isStoreAdmin(user);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [draft, setDraft] = useState<ReceiveDraft>({});
  const [receiveNote, setReceiveNote] = useState("");
  const [payment, setPayment] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setPo(await fetchPurchaseOrder(id));
    } catch (err) {
      await showError("Could not load purchase order", extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<PurchaseOrder>, success: string) {
    setBusy(true);
    try {
      const next = await action();
      setPo(next);
      await toastSuccess(success);
      return true;
    } catch (err) {
      await showError("Something went wrong", extractErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <div className="rs"><p className="rs-empty">No purchase order selected.</p></div>;
  if (loading) return <div className="rs"><p className="rs-empty">Loading…</p></div>;
  if (!po) return <div className="rs"><p className="rs-empty">Purchase order not found.</p></div>;

  const open = po.status === "draft" || po.status === "ordered" || po.status === "partially_received";
  const anyReceived = po.lines.some((line) => line.quantity_received > 0);

  function startReceiving() {
    if (!po) return;
    setDraft(receiveDraftFor(po));
    setReceiveNote("");
    setReceiving(true);
  }

  async function submitReceive() {
    if (!po) return;
    const lines = po.lines
      .map((line) => {
        const row = draft[line.id];
        const qty = Math.round((parseNumber(row?.qty ?? "") ?? 0) * 1000) / 1000;
        const raw = parseNumber(row?.cost ?? "");
        const cost = raw != null ? Math.round(raw * 100) / 100 : null;
        return { line_id: line.id, quantity: qty, unit_cost: cost != null && cost !== line.unit_cost ? cost : null };
      })
      .filter((line) => line.quantity > 0);
    if (!lines.length) {
      await showError("Nothing to receive", "Enter how much of each supply arrived.");
      return;
    }
    const ok = await run(() => receivePurchaseOrder(po.id, lines, receiveNote.trim() || null), "Stock updated");
    if (ok) setReceiving(false);
  }

  async function submitPayment() {
    if (!po) return;
    const parsed = parseNumber(payment);
    if (!parsed || parsed <= 0) return;
    const amount = Math.round(parsed * 100) / 100;
    const ok = await run(() => recordPurchaseOrderPayment(po.id, amount), `${formatKsh(amount)} payment recorded`);
    if (ok) setPayment("");
  }

  async function cancel() {
    if (!po) return;
    const reason = await promptVoidReason(
      `Cancel ${po.reference}?`,
      "Nothing has been received on this order. It will be kept for your records.",
      "Cancel order",
    );
    if (!reason) return;
    await run(() => cancelPurchaseOrder(po.id, reason), `${po.reference} cancelled`);
  }

  async function voidReceipt(receiptId: string, label: string) {
    const reason = await promptVoidReason(
      "Undo this delivery?",
      `${label} will be taken back out of stock. Use this when a delivery was entered by mistake.`,
      "Undo delivery",
    );
    if (!reason) return;
    await run(() => voidPurchaseOrderReceipt(receiptId, reason), "Delivery undone");
  }

  return (
    <div className="rs">
      <div className="rs-card">
        <div className="rs-row rs-row--between">
          <div>
            <p className="rs-card__title">{po.reference}</p>
            <p className="rs-card__meta">
              {po.supplier_id ? (
                <Link href={`/trans-chap/purchases?supplier=${encodeURIComponent(po.supplier_id)}`}>
                  {po.supplier_name || "Supplier"}
                </Link>
              ) : (
                po.supplier_name || "No supplier"
              )}
              {po.supplier_invoice_no ? ` · Invoice ${po.supplier_invoice_no}` : ""}
            </p>
          </div>
          <div className="rs-row">
            <span className={`rs-badge ${poStatusTone(po.status)}`}>{PO_STATUS_LABELS[po.status]}</span>
            {po.status !== "cancelled" ? (
              <span className={`rs-badge ${paymentTone(po.payment_status)}`}>
                {PAYMENT_STATUS_LABELS[po.payment_status]}
              </span>
            ) : null}
          </div>
        </div>
        <p className="rs-card__meta">
          {po.order_date ? `Ordered ${po.order_date}` : ""}
          {po.expected_date && open ? ` · Expected ${po.expected_date}` : ""}
          {po.received_at ? ` · Last delivery ${formatNairobiStamp24(po.received_at)}` : ""}
        </p>
        {po.notes ? <p className="rs-card__meta">{po.notes}</p> : null}
        {po.cancelled_reason ? <p className="rs-card__meta">Cancelled: {po.cancelled_reason}</p> : null}
      </div>

      <div className="rs-stats">
        <div className="rs-stat">
          <span>Total</span>
          <strong>{formatKsh(po.total)}</strong>
        </div>
        <div className="rs-stat">
          <span>Paid</span>
          <strong>{formatKsh(po.amount_paid)}</strong>
        </div>
        <div className="rs-stat">
          <span>Balance</span>
          <strong className={po.balance > 0 ? "rs-neg" : undefined}>{formatKsh(po.balance)}</strong>
        </div>
      </div>

      <h3 className="rs-section-title">Supplies</h3>
      {receiving ? (
        <ul className="rs-list">
          {po.lines.map((line) => (
            <li key={line.id} className="rs-line">
              <div>
                <p className="rs-card__title">{line.item_name}</p>
                <p className="rs-card__meta">
                  {formatQty(line.quantity_received, line.purchase_unit)} of{" "}
                  {formatQty(line.quantity_ordered, line.purchase_unit)} received
                </p>
              </div>
              <span />
              <div className="rs-line__inputs">
                <label className="rs-field">
                  <span>Arrived ({line.purchase_unit})</span>
                  <input
                    className="rs-input"
                    inputMode="decimal"
                    value={draft[line.id]?.qty ?? ""}
                    placeholder="0"
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [line.id]: { ...prev[line.id], qty: e.target.value } }))
                    }
                  />
                </label>
                <label className="rs-field">
                  <span>Cost per {line.purchase_unit}</span>
                  <input
                    className="rs-input"
                    inputMode="decimal"
                    value={draft[line.id]?.cost ?? ""}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [line.id]: { ...prev[line.id], cost: e.target.value } }))
                    }
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>Supply</th>
                <th className="rs-num">Ordered</th>
                <th className="rs-num">Received</th>
                <th className="rs-num">Cost</th>
                <th className="rs-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <Link href={`/trans-chap/purchases/item?id=${encodeURIComponent(line.inventory_item_id)}`}>
                      {line.item_name}
                    </Link>
                    {line.unit_factor !== 1 ? (
                      <div className="rs-muted">
                        1 {line.purchase_unit} = {formatQty(line.unit_factor, line.base_unit)}
                      </div>
                    ) : null}
                  </td>
                  <td className="rs-num">{formatQty(line.quantity_ordered, line.purchase_unit)}</td>
                  <td className={`rs-num ${line.quantity_outstanding > 0 && po.status !== "cancelled" ? "rs-neg" : ""}`}>
                    {formatQty(line.quantity_received)}
                  </td>
                  <td className="rs-num">{formatKsh(line.unit_cost)}</td>
                  <td className="rs-num">{formatKsh(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {po.discount > 0 ? <p className="rs-card__meta">Discount {formatKsh(po.discount)}</p> : null}

      {receiving ? (
        <div className="rs-card">
          <label className="rs-field">
            <span>Delivery note (optional)</span>
            <input className="rs-input" value={receiveNote} maxLength={500} onChange={(e) => setReceiveNote(e.target.value)} />
          </label>
          <div className="rs-row">
            <button type="button" className="rs-btn" disabled={busy} onClick={() => setReceiving(false)}>
              Back
            </button>
            <button type="button" className="rs-btn rs-btn--primary" disabled={busy} onClick={() => void submitReceive()}>
              {busy ? "Saving…" : "Add to stock"}
            </button>
          </div>
        </div>
      ) : open ? (
        <div className="rs-row">
          {po.status === "draft" ? (
            <button
              type="button"
              className="rs-btn"
              disabled={busy}
              onClick={() => void run(() => markPurchaseOrderOrdered(po.id), `${po.reference} ordered`)}
            >
              Mark as ordered
            </button>
          ) : null}
          <button type="button" className="rs-btn rs-btn--primary" disabled={busy} onClick={startReceiving}>
            <i className="fa-solid fa-truck-ramp-box" aria-hidden /> Receive delivery
          </button>
          {!anyReceived ? (
            <button type="button" className="rs-btn rs-btn--danger" disabled={busy} onClick={() => void cancel()}>
              Cancel order
            </button>
          ) : null}
        </div>
      ) : null}

      {po.status !== "cancelled" && po.balance > 0 ? (
        <div className="rs-card">
          <h3 className="rs-section-title">Pay supplier</h3>
          <div className="rs-row">
            <input
              className="rs-input"
              inputMode="decimal"
              value={payment}
              placeholder={String(po.balance)}
              aria-label="Payment amount"
              onChange={(e) => setPayment(e.target.value)}
            />
            <button
              type="button"
              className="rs-btn"
              disabled={busy}
              onClick={() => setPayment(String(po.balance))}
            >
              Full balance
            </button>
            <button
              type="button"
              className="rs-btn rs-btn--primary"
              disabled={busy || !(parseNumber(payment) ?? 0)}
              onClick={() => void submitPayment()}
            >
              Record payment
            </button>
          </div>
        </div>
      ) : null}

      {(po.receipts ?? []).length ? (
        <>
          <h3 className="rs-section-title">Deliveries</h3>
          <ul className="rs-list">
            {(po.receipts ?? []).map((receipt) => (
              <li key={receipt.id} className={`rs-card ${receipt.voided_at ? "rs-muted" : ""}`}>
                <div className="rs-row rs-row--between">
                  <div>
                    <p className="rs-card__title">
                      {receipt.item_name} · {formatQty(receipt.quantity)}
                    </p>
                    <p className="rs-card__meta">
                      {formatNairobiStamp24(receipt.created_at)}
                      {receipt.total_cost != null ? ` · ${formatKsh(receipt.total_cost)}` : ""}
                      {receipt.voided_at ? ` · Undone${receipt.void_reason ? `: ${receipt.void_reason}` : ""}` : ""}
                    </p>
                  </div>
                  {canVoid && !receipt.voided_at ? (
                    <button
                      type="button"
                      className="rs-btn rs-btn--small rs-btn--danger"
                      disabled={busy}
                      onClick={() => void voidReceipt(receipt.id, `${formatQty(receipt.quantity)} of ${receipt.item_name}`)}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {po.status === "draft" ? (
        <p className="rs-card__meta">
          Draft orders do not change stock. Receive the delivery when the supplies arrive.
        </p>
      ) : null}
    </div>
  );
}
