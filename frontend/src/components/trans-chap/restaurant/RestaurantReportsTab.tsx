"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { nairobiDateKey } from "@/lib/nairobi-time";
import {
  LOCATION_LABELS,
  fetchKitchenStock,
  fetchProfitReport,
  fetchUsageReport,
  formatQty,
  type ProfitReport,
  type StockLocation,
  type UsageReport,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return nairobiDateKey(new Date(Date.now() - days * DAY_MS));
}

function percent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

export function RestaurantReportsTab() {
  const [start, setStart] = useState(() => daysAgo(6));
  const [end, setEnd] = useState(() => daysAgo(0));
  const [where, setWhere] = useState<"all" | StockLocation>("all");
  const [kitchenOn, setKitchenOn] = useState(false);
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchKitchenStock()
      .then((data) => {
        if (alive) setKitchenOn(data.enabled);
      })
      .catch(() => {
        /* location filter stays hidden */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!start || !end || start > end) return;
    let alive = true;
    setLoading(true);
    Promise.all([fetchProfitReport(start, end), fetchUsageReport(start, end, where === "all" ? undefined : where)])
      .then(([profitData, usageData]) => {
        if (!alive) return;
        setProfit(profitData);
        setUsage(usageData);
      })
      .catch((err) => {
        if (alive) void showError("Could not load reports", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [start, end, where]);

  const totals = profit?.totals;
  const usageRows = (usage?.items ?? []).filter(
    (row) => row.used_in_sales || row.wasted || row.purchased || row.count_variance || row.issued || row.returned,
  );
  const showMoves = kitchenOn && where !== "all";

  return (
    <div className="rs">
      <div className="rs-row">
        <label className="rs-field">
          <span>From</span>
          <input className="rs-input" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="rs-field">
          <span>To</span>
          <input className="rs-input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
        {kitchenOn ? (
          <label className="rs-field">
            <span>Stock in</span>
            <select
              className="rs-input"
              value={where}
              onChange={(e) => setWhere(e.target.value as "all" | StockLocation)}
            >
              <option value="all">Store and kitchen</option>
              <option value="store">{LOCATION_LABELS.store}</option>
              <option value="kitchen">{LOCATION_LABELS.kitchen}</option>
            </select>
          </label>
        ) : null}
      </div>

      {loading && !profit ? <p className="rs-empty">Loading…</p> : null}

      {totals ? (
        <>
          <p className="rs-section-title">Food profit</p>
          <div className="rs-stats">
            <div className="rs-stat">
              <span>Sales</span>
              <strong>{formatKsh(totals.revenue)}</strong>
            </div>
            <div className="rs-stat">
              <span>Food cost</span>
              <strong>{formatKsh(totals.cost)}</strong>
            </div>
            <div className="rs-stat">
              <span>Gross profit</span>
              <strong className={totals.gross_profit < 0 ? "rs-neg" : "rs-pos"}>{formatKsh(totals.gross_profit)}</strong>
            </div>
            <div className="rs-stat">
              <span>Margin</span>
              <strong>{percent(totals.margin_percent)}</strong>
            </div>
          </div>
          {totals.uncosted_lines ? (
            <p className="rs-card__meta">
              {totals.uncosted_lines} sold {totals.uncosted_lines === 1 ? "line has" : "lines have"} no recipe cost, so
              profit is overstated. Add recipes on the menu.
            </p>
          ) : null}
          {profit && profit.items.length ? (
            <div className="rs-table-wrap">
              <table className="rs-table">
                <thead>
                  <tr>
                    <th>Meal</th>
                    <th className="rs-num">Sold</th>
                    <th className="rs-num">Sales</th>
                    <th className="rs-num">Cost</th>
                    <th className="rs-num">Profit</th>
                    <th className="rs-num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.items.map((row) => (
                    <tr key={row.name}>
                      <td>
                        {row.name}
                        {row.uncosted_lines ? <div className="rs-muted">No recipe cost</div> : null}
                      </td>
                      <td className="rs-num">{formatQty(row.quantity)}</td>
                      <td className="rs-num">{formatKsh(row.revenue)}</td>
                      <td className="rs-num">{formatKsh(row.cost)}</td>
                      <td className={`rs-num ${row.gross_profit < 0 ? "rs-neg" : ""}`}>{formatKsh(row.gross_profit)}</td>
                      <td className="rs-num">{percent(row.margin_percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rs-empty">No sales in this period.</p>
          )}
        </>
      ) : null}

      {usage ? (
        <>
          <p className="rs-section-title">Supply usage</p>
          <div className="rs-stats">
            <div className="rs-stat">
              <span>Bought</span>
              <strong>{formatKsh(usage.totals.purchased_value ?? 0)}</strong>
            </div>
            <div className="rs-stat">
              <span>Used by sales</span>
              <strong>{formatKsh(usage.totals.used_in_sales_value ?? 0)}</strong>
            </div>
            <div className="rs-stat">
              <span>Wasted</span>
              <strong className={(usage.totals.wasted_value ?? 0) > 0 ? "rs-neg" : undefined}>
                {formatKsh(usage.totals.wasted_value ?? 0)}
              </strong>
            </div>
            <div className="rs-stat">
              <span>Count variance</span>
              <strong className={(usage.totals.count_variance_value ?? 0) < 0 ? "rs-neg" : undefined}>
                {formatKsh(usage.totals.count_variance_value ?? 0)}
              </strong>
            </div>
          </div>
          {usageRows.length ? (
            <div className="rs-table-wrap">
              <table className="rs-table">
                <thead>
                  <tr>
                    <th>Supply</th>
                    <th className="rs-num">Opening</th>
                    <th className="rs-num">Bought</th>
                    {showMoves ? <th className="rs-num">Issued</th> : null}
                    {showMoves ? <th className="rs-num">Returned</th> : null}
                    <th className="rs-num">Used</th>
                    <th className="rs-num">Wasted</th>
                    <th className="rs-num">Variance</th>
                    <th className="rs-num">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRows.map((row) => (
                    <tr key={row.inventory_item_id}>
                      <td>
                        <Link href={`/trans-chap/purchases/item?id=${encodeURIComponent(row.inventory_item_id)}`}>
                          {row.name}
                        </Link>
                        <div className="rs-muted">{row.unit}</div>
                      </td>
                      <td className="rs-num">{formatQty(row.opening)}</td>
                      <td className="rs-num">{row.purchased ? formatQty(row.purchased) : "—"}</td>
                      {showMoves ? <td className="rs-num">{row.issued ? formatQty(row.issued) : "—"}</td> : null}
                      {showMoves ? <td className="rs-num">{row.returned ? formatQty(row.returned) : "—"}</td> : null}
                      <td className="rs-num">{row.used_in_sales ? formatQty(row.used_in_sales) : "—"}</td>
                      <td className="rs-num">{row.wasted ? formatQty(row.wasted) : "—"}</td>
                      <td className={`rs-num ${row.count_variance < 0 ? "rs-neg" : ""}`}>
                        {row.count_variance ? formatQty(row.count_variance) : "—"}
                      </td>
                      <td className={`rs-num ${row.closing < 0 ? "rs-neg" : ""}`}>{formatQty(row.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rs-empty">No supply movements in this period.</p>
          )}
          {showMoves ? (
            <p className="rs-card__meta">
              Issued and returned are signed for the {LOCATION_LABELS[where as StockLocation].toLowerCase()}: stock
              coming in is positive, stock going out is negative.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
