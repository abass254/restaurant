"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import type { AdminOrderDetailResponse, Order } from "@/lib/types";
import { formatNairobiDate, formatNairobiDateTime } from "@/lib/nairobi-time";

const transitionTargets = [
  "placed",
  "awaiting_payment",
  "payment_received",
  "being_prepared",
  "ready",
  "out_for_delivery",
  "cancelled",
  "refunded",
] as const;

type TransitionTarget = (typeof transitionTargets)[number];

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDateTime(value) || value;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDate(value) || value;
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetStatus, setTargetStatus] = useState<TransitionTarget>("awaiting_payment");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState("");
  const [moving, setMoving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<AdminOrderDetailResponse>(apiRoutes.adminOrder(orderId))
      .then((res) => {
        if (cancelled) return;
        setOrder(res.data);
        setMerchantName(res.merchant_name);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load order details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    if (!order) return;
    if (order.status === "placed") setTargetStatus("awaiting_payment");
    else if (order.status === "awaiting_payment") setTargetStatus("payment_received");
    else if (order.status === "payment_received") setTargetStatus("being_prepared");
    else if (order.status === "being_prepared") setTargetStatus("ready");
    else if (order.status === "ready") setTargetStatus("out_for_delivery");
    else setTargetStatus("awaiting_payment");
  }, [order?.status]);

  async function moveOrder() {
    if (!order) return;
    if (targetStatus === "cancelled" && !note.trim()) {
      setActionMessage("Enter a rejection reason before cancelling this order.");
      return;
    }
    setMoving(true);
    setActionMessage(null);
    try {
      const response = await apiFetch<{ message: string; data: Order }>(
        apiRoutes.adminOrderTransition(order.id),
        {
          method: "POST",
          body: JSON.stringify({
            to_status: targetStatus,
            note: note.trim() || undefined,
            mpesa_receipt_number: receipt.trim() || undefined,
          }),
        },
      );
      setOrder(response.data);
      setActionMessage(response.message || `Order moved to ${targetStatus}.`);
      setNote("");
      if (targetStatus !== "payment_received") setReceipt("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not move order.";
      setActionMessage(message);
    } finally {
      setMoving(false);
    }
  }

  return (
    <section className="admin-page">
      <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
        <Link href="/admin/orders">
          <i className="fas fa-arrow-left" aria-hidden="true" /> Orders
        </Link>
      </nav>

      {loading ? (
        <div className="admin-section">
          <Skeleton variant="text" width={260} height={24} />
          <div style={{ height: 12 }} />
          <Skeleton variant="text" width={420} height={14} />
          <div style={{ height: 20 }} />
          <Skeleton variant="rect" width="100%" height={220} />
        </div>
      ) : error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : !order ? (
        <MotionFade>
          <p className="admin-muted">Order not found.</p>
        </MotionFade>
      ) : (
        <MotionFade>
          <header className="admin-page__header">
            <div>
              <h1 className="admin-page__title">Order {order.order_number}</h1>
              <p className="admin-page__lead">
                {merchantName || "Unknown merchant"} · {order.status.replaceAll("_", " ")}
              </p>
            </div>
            <div className="admin-page__header-meta">
              <span className="admin-chip">
                <i className="fas fa-calendar-plus" aria-hidden="true" />
                {formatDate(order.placed_at || order.created_at)}
              </span>
            </div>
          </header>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">Order details</h2>
            </header>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <label>
                <div className="admin-muted" style={{ marginBottom: 6 }}>Move to stage</div>
                <select
                  className="admin-input"
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as TransitionTarget)}
                  disabled={moving}
                >
                  {transitionTargets.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div className="admin-muted" style={{ marginBottom: 6 }}>M-PESA receipt (optional)</div>
                <input
                  className="admin-input"
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  placeholder="e.g. QGH7X2ABCD"
                  disabled={moving}
                />
              </label>
              <label>
                <div className="admin-muted" style={{ marginBottom: 6 }}>
                  {targetStatus === "cancelled"
                    ? "Rejection reason (required)"
                    : "Note (optional)"}
                </div>
                <input
                  className="admin-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    targetStatus === "cancelled"
                      ? "Why is this order being rejected?"
                      : "Reason for this admin move"
                  }
                  disabled={moving}
                  required={targetStatus === "cancelled"}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => void moveOrder()}
                disabled={moving}
              >
                {moving ? "Moving..." : "Move order"}
              </button>
              {actionMessage ? <span className="admin-muted">{actionMessage}</span> : null}
            </div>
            <div className="admin-kv">
              <div><strong>Status:</strong> {order.status.replaceAll("_", " ")}</div>
              <div><strong>Source:</strong> {order.source}</div>
              <div><strong>Fulfillment:</strong> {order.fulfillment_type}</div>
              <div><strong>Payment:</strong> {order.payment_method || "—"}</div>
              <div><strong>Customer:</strong> {order.customer_name || "—"}</div>
              <div><strong>Phone:</strong> {order.customer_phone || "—"}</div>
              <div><strong>Total:</strong> {order.currency} {Number(order.total || 0).toFixed(2)}</div>
              <div><strong>Created:</strong> {formatDateTime(order.created_at)}</div>
            </div>
          </section>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">Line items</h2>
            </header>
            {!order.items || order.items.length === 0 ? (
              <p className="admin-muted">No line items recorded.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{order.currency} {Number(item.unit_price || 0).toFixed(2)}</td>
                        <td>{order.currency} {Number(item.line_total || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </MotionFade>
      )}
    </section>
  );
}
