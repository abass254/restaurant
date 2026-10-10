"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { formatNairobiStamp24, nairobiDateKey } from "@/lib/nairobi-time";
import { fetchKitchenDayReport, formatQty, type KitchenDayReport } from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";

function signed(value: number): string {
  if (!value) return "—";
  return `${value > 0 ? "+" : ""}${formatQty(value)}`;
}

export function RestaurantKitchenDayReport() {
  const router = useRouter();
  const params = useSearchParams();
  const day = params.get("date") || nairobiDateKey(new Date());
  const [report, setReport] = useState<KitchenDayReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchKitchenDayReport(day)
      .then((data) => {
        if (alive) setReport(data);
      })
      .catch((err) => {
        if (alive) void showError("Could not load the kitchen day", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [day]);

  const rows = report?.items ?? [];
  const totals = report?.totals ?? {};
  const counted = (report?.close_out_counts.length ?? 0) > 0;
  const varianceValue = rows.reduce((sum, row) => sum + (row.count_variance_value ?? 0), 0);

  return (
    <div className="rs">
      <div className="rs-row rs-row--between">
        <label className="rs-field">
          <span>Day</span>
          <input
            className="rs-input"
            type="date"
            value={day}
            onChange={(e) => {
              if (e.target.value) router.replace(`/trans-chap/purchases/kitchen-day?date=${e.target.value}`);
            }}
          />
        </label>
        <Link className="rs-btn" href="/trans-chap/kitchen">
          Back to kitchen
        </Link>
      </div>

      {loading ? (
        <p className="rs-empty">Loading…</p>
      ) : !report ? null : (
        <>
          <div className="rs-stats">
            <div className="rs-stat">
              <span>Issued to kitchen</span>
              <strong>{formatKsh(totals.issued_value ?? 0)}</strong>
            </div>
            <div className="rs-stat">
              <span>Used by sales</span>
              <strong>{formatKsh(totals.used_in_sales_value ?? 0)}</strong>
            </div>
            <div className="rs-stat">
              <span>Wasted</span>
              <strong className={(totals.wasted_value ?? 0) > 0 ? "rs-neg" : undefined}>
                {formatKsh(totals.wasted_value ?? 0)}
              </strong>
            </div>
            <div className="rs-stat">
              <span>Kitchen variance</span>
              <strong className={varianceValue < 0 ? "rs-neg" : varianceValue > 0 ? "rs-pos" : undefined}>
                {counted ? formatKsh(varianceValue) : "Not counted"}
              </strong>
            </div>
          </div>

          {!counted ? (
            <p className="rs-card__meta">
              No closing count for this day yet. Close the kitchen day on the Kitchen tab to see what is missing.
            </p>
          ) : (
            <p className="rs-card__meta">
              Closed {report.close_out_counts.map((take) => formatNairobiStamp24(take.counted_at)).join(", ")}.
              Variance is what the count found beyond what sales and recorded wastage explain.
            </p>
          )}

          {rows.length === 0 ? (
            <p className="rs-empty">No kitchen activity on this day.</p>
          ) : (
            <div className="rs-table-wrap">
              <table className="rs-table">
                <thead>
                  <tr>
                    <th>Supply</th>
                    <th className="rs-num">Opening</th>
                    <th className="rs-num">Issued</th>
                    <th className="rs-num">Returned</th>
                    <th className="rs-num">Used</th>
                    <th className="rs-num">Wasted</th>
                    <th className="rs-num">Expected</th>
                    <th className="rs-num">Counted</th>
                    <th className="rs-num">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.inventory_item_id}>
                      <td>
                        <Link href={`/trans-chap/purchases/item?id=${encodeURIComponent(row.inventory_item_id)}`}>
                          {row.name}
                        </Link>
                        <div className="rs-muted">{row.unit}</div>
                      </td>
                      <td className="rs-num">{formatQty(row.opening)}</td>
                      <td className="rs-num">{signed(row.issued)}</td>
                      <td className="rs-num">{row.returned ? formatQty(-row.returned) : "—"}</td>
                      <td className="rs-num">{row.used_in_sales ? formatQty(row.used_in_sales) : "—"}</td>
                      <td className="rs-num">{row.wasted ? formatQty(row.wasted) : "—"}</td>
                      <td className="rs-num">{formatQty(row.expected_closing)}</td>
                      <td className="rs-num">{row.counted != null ? formatQty(row.counted) : "—"}</td>
                      <td
                        className={`rs-num ${row.count_variance < 0 ? "rs-neg" : row.count_variance > 0 ? "rs-pos" : ""}`}
                      >
                        {row.count_variance ? (
                          <>
                            {signed(row.count_variance)}
                            {row.count_variance_value ? (
                              <div className="rs-muted">{formatKsh(row.count_variance_value)}</div>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
