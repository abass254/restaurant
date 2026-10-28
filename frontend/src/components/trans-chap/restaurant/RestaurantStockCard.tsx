"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  LOCATION_LABELS,
  MOVEMENT_REASON_LABELS,
  fetchStockCard,
  formatQty,
  type StockCard,
  type StockLocation,
  type StockMovementRow,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";

function movementLink(row: StockMovementRow) {
  if (row.purchase_order_id) {
    return (
      <Link href={`/trans-chap/purchases/po?id=${encodeURIComponent(row.purchase_order_id)}`}>
        {row.purchase_order_reference || "Purchase order"}
      </Link>
    );
  }
  if (row.stock_take_id) {
    return (
      <Link
        href={`/trans-chap/purchases/count?id=${encodeURIComponent(row.stock_take_id)}${row.location === "kitchen" ? "&from=kitchen" : ""}`}
      >
        Stock count
      </Link>
    );
  }
  if (row.kitchen_issue_id) {
    return (
      <Link href={`/trans-chap/purchases/issue?id=${encodeURIComponent(row.kitchen_issue_id)}`}>Kitchen issue</Link>
    );
  }
  if (row.order_number) return <span>Order #{row.order_number}</span>;
  return null;
}

type LocationFilter = "all" | StockLocation;

export function RestaurantStockCard() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const [card, setCard] = useState<StockCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [where, setWhere] = useState<LocationFilter>("all");

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchStockCard(id)
      .then((data) => {
        if (alive) setCard(data);
      })
      .catch((err) => {
        if (alive) void showError("Could not load stock history", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!id) return <div className="rs"><p className="rs-empty">No supply selected.</p></div>;
  if (loading) return <div className="rs"><p className="rs-empty">Loading…</p></div>;
  if (!card) return <div className="rs"><p className="rs-empty">Supply not found.</p></div>;

  const { item } = card;
  const split = item.kitchen_quantity != null;
  const movements = split && where !== "all" ? card.movements.filter((row) => row.location === where) : card.movements;

  return (
    <div className="rs">
      <div className="rs-card">
        <p className="rs-card__title">{item.name}</p>
        <p className="rs-card__meta">Every change to this supply&apos;s stock, newest first.</p>
      </div>
      <div className="rs-stats">
        {split ? (
          <>
            <div className="rs-stat">
              <span>In the store</span>
              <strong>{formatQty(item.stock_quantity, item.unit)}</strong>
            </div>
            <div className="rs-stat">
              <span>In the kitchen</span>
              <strong className={(item.kitchen_quantity ?? 0) < 0 ? "rs-neg" : undefined}>
                {formatQty(item.kitchen_quantity, item.unit)}
              </strong>
            </div>
          </>
        ) : (
          <div className="rs-stat">
            <span>In stock</span>
            <strong>{formatQty(item.stock_quantity, item.unit)}</strong>
          </div>
        )}
        {item.prepared_quantity != null && (
          <div className="rs-stat">
            <span>Prepared portions</span>
            <strong>{formatQty(item.prepared_quantity, "portions")}</strong>
          </div>
        )}
        <div className="rs-stat">
          <span>Average cost</span>
          <strong>{item.average_cost != null ? `${formatKsh(item.average_cost)} / ${item.unit}` : "—"}</strong>
        </div>
        <div className="rs-stat">
          <span>Stock value</span>
          <strong>{item.stock_value != null ? formatKsh(item.stock_value) : "—"}</strong>
        </div>
      </div>
      <div className="rs-row">
        <Link className="rs-btn rs-btn--primary" href={`/trans-chap/purchases/po/new?items=${encodeURIComponent(item.id)}`}>
          Buy more
        </Link>
        {split ? (
          <select
            className="rs-input"
            value={where}
            aria-label="Show movements for"
            onChange={(e) => setWhere(e.target.value as LocationFilter)}
          >
            <option value="all">Store and kitchen</option>
            <option value="store">{LOCATION_LABELS.store} only</option>
            <option value="kitchen">{LOCATION_LABELS.kitchen} only</option>
          </select>
        ) : null}
      </div>

      {movements.length === 0 ? (
        <p className="rs-empty">No stock movements recorded yet.</p>
      ) : (
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th className="rs-num">Change</th>
                <th className="rs-num">Balance</th>
                <th className="rs-num">Value</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((row) => (
                <tr key={row.id} className={row.voided_at ? "is-muted" : undefined}>
                  <td>{formatNairobiStamp24(row.created_at)}</td>
                  <td>
                    {MOVEMENT_REASON_LABELS[row.reason] ?? row.reason}
                    {row.voided_at ? " (undone)" : ""}
                    {split ? (
                      <span className={`rs-badge ${row.location === "kitchen" ? "rs-badge--info" : ""}`}>
                        {LOCATION_LABELS[row.location ?? "store"]}
                      </span>
                    ) : null}
                    <div className="rs-muted">
                      {movementLink(row)}
                      {row.note ? <> {row.note}</> : null}
                    </div>
                  </td>
                  <td className={`rs-num ${row.signed_quantity >= 0 ? "rs-pos" : "rs-neg"}`}>
                    {row.signed_quantity > 0 ? "+" : ""}
                    {formatQty(row.signed_quantity)}
                  </td>
                  <td className="rs-num">{formatQty(row.quantity_after)}</td>
                  <td className="rs-num">{row.total_cost != null ? formatKsh(row.total_cost) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
