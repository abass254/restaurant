"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  cancelStockTake,
  completeStockTake,
  fetchStockTake,
  formatQty,
  saveStockTakeCounts,
  type StockTake,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";

type Counts = Record<string, string>;

function countsFor(take: StockTake): Counts {
  const counts: Counts = {};
  for (const line of take.lines ?? []) {
    counts[line.id] = line.counted_qty != null ? String(line.counted_qty) : "";
  }
  return counts;
}

function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) / 1000 : null;
}

export function RestaurantStockTake() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") || "";
  const user = useAuthUser();
  const canApply = isStoreAdmin(user);
  const [take, setTake] = useState<StockTake | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchStockTake(id)
      .then((data) => {
        if (!alive) return;
        setTake(data);
        setCounts(countsFor(data));
      })
      .catch((err) => {
        if (alive) void showError("Could not load stock count", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const lines = useMemo(() => take?.lines ?? [], [take]);
  const needle = search.trim().toLowerCase();
  const visible = needle ? lines.filter((line) => line.item_name.toLowerCase().includes(needle)) : lines;
  const dirty = lines.some((line) => (line.counted_qty != null ? String(line.counted_qty) : "") !== (counts[line.id] ?? ""));
  const counted = lines.filter((line) => parseCount(counts[line.id] ?? "") != null).length;
  const draft = take?.status === "draft";

  const liveVariance = lines.reduce((sum, line) => {
    const qty = parseCount(counts[line.id] ?? "");
    if (qty == null || line.current_qty == null || line.unit_cost == null) return sum;
    return sum + (qty - line.current_qty) * line.unit_cost;
  }, 0);

  async function save(): Promise<StockTake | null> {
    if (!take) return null;
    setBusy(true);
    try {
      const next = await saveStockTakeCounts(
        take.id,
        lines.map((line) => ({ line_id: line.id, counted_qty: parseCount(counts[line.id] ?? "") })),
      );
      setTake(next);
      setCounts(countsFor(next));
      return next;
    } catch (err) {
      await showError("Could not save counts", extractErrorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!take) return;
    const ok = await confirmAction(
      "Apply this stock count?",
      `Stock will be set to what you counted for ${counted} ${counted === 1 ? "supply" : "supplies"}. Differences are recorded as stock count variance and cannot be edited later.`,
      "Apply count",
    );
    if (!ok) return;
    const saved = dirty ? await save() : take;
    if (!saved) return;
    setBusy(true);
    try {
      const next = await completeStockTake(saved.id);
      setTake(next);
      setCounts(countsFor(next));
      await toastSuccess("Stock count applied");
    } catch (err) {
      await showError("Could not apply stock count", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!take) return;
    const ok = await confirmAction("Discard this stock count?", "Your counts will not change stock.", "Discard");
    if (!ok) return;
    setBusy(true);
    try {
      await cancelStockTake(take.id);
      router.replace(`/trans-chap/purchases?tab=${take.location === "kitchen" ? "kitchen" : "counts"}`);
    } catch (err) {
      await showError("Could not discard stock count", extractErrorMessage(err));
      setBusy(false);
    }
  }

  if (!id) return <div className="rs"><p className="rs-empty">No stock count selected.</p></div>;
  if (loading) return <div className="rs"><p className="rs-empty">Loading…</p></div>;
  if (!take) return <div className="rs"><p className="rs-empty">Stock count not found.</p></div>;

  const kitchen = take.location === "kitchen";

  return (
    <div className="rs">
      <div className="rs-card">
        <div className="rs-row rs-row--between">
          <div>
            <p className="rs-card__title">{kitchen ? "Kitchen close-out count" : "Stock count"}</p>
            <p className="rs-card__meta">
              Started {formatNairobiStamp24(take.created_at)}
              {take.counted_at ? ` · Applied ${formatNairobiStamp24(take.counted_at)}` : ""}
            </p>
          </div>
          <span
            className={`rs-badge rs-badge--${take.status === "completed" ? "ok" : take.status === "cancelled" ? "bad" : "info"}`}
          >
            {take.status === "completed" ? "Applied" : take.status === "cancelled" ? "Discarded" : "In progress"}
          </span>
        </div>
        {draft ? (
          <p className="rs-card__meta">
            {kitchen
              ? "Count what is left in the kitchen at the end of the day. Leave a supply blank to skip it."
              : "Count what you physically have in stock. Leave a supply blank to skip it."}
          </p>
        ) : null}
      </div>

      <div className="rs-stats">
        <div className="rs-stat">
          <span>Counted</span>
          <strong>
            {draft ? counted : take.counted_count} / {lines.length}
          </strong>
        </div>
        <div className="rs-stat">
          <span>{draft ? "Difference so far" : "Variance value"}</span>
          <strong className={(draft ? liveVariance : take.variance_value) < 0 ? "rs-neg" : "rs-pos"}>
            {formatKsh(draft ? liveVariance : take.variance_value)}
          </strong>
        </div>
      </div>

      <label className="trans-chap-sales__search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden />
        <input
          type="search"
          value={search}
          placeholder="Find a supply"
          aria-label="Find a supply"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <div className="rs-table-wrap">
        <table className="rs-table">
          <thead>
            <tr>
              <th>Supply</th>
              <th className="rs-num">System</th>
              <th className="rs-num">Counted</th>
              <th className="rs-num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const qty = draft ? parseCount(counts[line.id] ?? "") : line.counted_qty;
              const system = draft ? line.current_qty : line.expected_qty;
              const diff = draft ? (qty != null && system != null ? qty - system : null) : line.variance_qty;
              return (
                <tr key={line.id}>
                  <td>
                    {line.item_name}
                    <div className="rs-muted">{line.unit}</div>
                  </td>
                  <td className="rs-num">{formatQty(system)}</td>
                  <td className="rs-num">
                    {draft ? (
                      <input
                        className="rs-input rs-input--qty"
                        inputMode="decimal"
                        value={counts[line.id] ?? ""}
                        placeholder="—"
                        aria-label={`Counted ${line.item_name}`}
                        onChange={(e) => setCounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      />
                    ) : (
                      formatQty(qty)
                    )}
                  </td>
                  <td className={`rs-num ${diff == null || diff === 0 ? "" : diff < 0 ? "rs-neg" : "rs-pos"}`}>
                    {diff == null ? "—" : `${diff > 0 ? "+" : ""}${formatQty(diff)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="rs-total-bar">
          <button type="button" className="rs-btn rs-btn--danger" disabled={busy} onClick={() => void discard()}>
            Discard
          </button>
          <div className="rs-row">
            <button
              type="button"
              className="rs-btn"
              disabled={busy || !dirty}
              onClick={() =>
                void save().then((next) => {
                  if (next) void toastSuccess("Counts saved");
                })
              }
            >
              Save progress
            </button>
            {canApply ? (
              <button
                type="button"
                className="rs-btn rs-btn--primary"
                disabled={busy || counted === 0}
                onClick={() => void complete()}
              >
                Apply count
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {draft && !canApply ? (
        <p className="rs-card__meta">Save your counts. The shop owner or admin applies them to stock.</p>
      ) : null}
    </div>
  );
}
