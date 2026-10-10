"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  KITCHEN_ISSUE_STATUS_LABELS,
  cancelKitchenIssue,
  createKitchenIssue,
  fetchKitchenIssue,
  fetchKitchenSuggestion,
  formatQty,
  releaseKitchenIssue,
  roundQty,
  type KitchenIssue,
  type KitchenSuggestion,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { issueStatusTone } from "./RestaurantKitchenTab";

function parseQty(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? roundQty(parsed) : null;
}

export function RestaurantKitchenIssue() {
  const params = useSearchParams();
  const id = params.get("id");
  if (id) return <IssueDetail id={id} />;
  return <NewIssue />;
}

function NewIssue() {
  const router = useRouter();
  const [rows, setRows] = useState<KitchenSuggestion[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");

  const params = useSearchParams();
  const preselected = params.get("item");

  useEffect(() => {
    let alive = true;
    fetchKitchenSuggestion()
      .then((data) => {
        if (!alive) return;
        setRows(data);
        const filled: Record<string, string> = {};
        for (const row of data) {
          if (row.suggested_qty > 0) filled[row.inventory_item_id] = String(row.suggested_qty);
        }
        if (preselected && !filled[preselected]) {
          filled[preselected] = "1";
        }
        setQty(filled);
      })
      .catch((err) => {
        if (alive) void showError("Could not load kitchen supplies", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [preselected]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      [...rows]
        .filter(
          (row) =>
            (!needle || row.name.toLowerCase().includes(needle)) &&
            (row.inventory_role === "raw_material" || !row.inventory_role),
        )
        .sort((a, b) => b.daily_usage - a.daily_usage || a.name.localeCompare(b.name)),
    [rows, needle],
  );
  const lines = rows
    .map((row) => ({ row, quantity: parseQty(qty[row.inventory_item_id] ?? "") ?? 0 }))
    .filter((line) => line.quantity > 0);
  const value = lines.reduce((sum, line) => sum + line.quantity * (line.row.average_cost ?? 0), 0);
  const short = lines.filter((line) => line.quantity > line.row.store_quantity);

  async function submit(issueNow: boolean) {
    if (!lines.length) return;
    if (issueNow && short.length) {
      await showError(
        "Not enough in the store",
        short.map((line) => `${line.row.name}: store has ${formatQty(line.row.store_quantity, line.row.unit)}`).join("\n"),
      );
      return;
    }
    setSaving(true);
    try {
      const issue = await createKitchenIssue({
        issue_now: issueNow,
        notes: notes.trim() || null,
        lines: lines.map((line) => ({ inventory_item_id: line.row.inventory_item_id, quantity: line.quantity })),
      });
      await toastSuccess(issueNow ? "Issued to the kitchen" : "Request sent to the store");
      router.replace(`/trans-chap/purchases/issue?id=${encodeURIComponent(issue.id)}`);
    } catch (err) {
      await showError("Could not save the issue", extractErrorMessage(err));
      setSaving(false);
    }
  }

  if (loading) return <div className="rs"><p className="rs-empty">Loading kitchen supplies…</p></div>;

  return (
    <div className="rs">
      <p className="rs-card__meta">
        Only raw materials and ingredients for meal preparation are released to the kitchen. Buy &amp; sell items (drinks, snacks) are sold directly as they are at the counter.
      </p>
      <label className="trans-chap-sales__search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden />
        <input
          type="search"
          value={query}
          placeholder="Search supplies…"
          aria-label="Search supplies"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="rs-table-wrap">
        <table className="rs-table">
          <thead>
            <tr>
              <th>Supply</th>
              <th className="rs-num">Uses / day</th>
              <th className="rs-num">Kitchen</th>
              <th className="rs-num">Store</th>
              <th className="rs-num">Issue</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const wanted = parseQty(qty[row.inventory_item_id] ?? "") ?? 0;
              return (
                <tr key={row.inventory_item_id}>
                  <td>
                    {row.name}
                    <div className="rs-muted">{row.unit}</div>
                  </td>
                  <td className="rs-num">{row.daily_usage ? formatQty(row.daily_usage) : "—"}</td>
                  <td className={`rs-num ${row.kitchen_quantity < 0 ? "rs-neg" : ""}`}>{formatQty(row.kitchen_quantity)}</td>
                  <td className={`rs-num ${wanted > row.store_quantity ? "rs-neg" : ""}`}>{formatQty(row.store_quantity)}</td>
                  <td className="rs-num">
                    <input
                      className="rs-input rs-input--qty"
                      inputMode="decimal"
                      placeholder="0"
                      value={qty[row.inventory_item_id] ?? ""}
                      aria-label={`Issue ${row.name}`}
                      onChange={(e) => setQty((prev) => ({ ...prev, [row.inventory_item_id]: e.target.value }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="rs-field">
        <span>Note (optional)</span>
        <input className="rs-input" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="rs-total-bar">
        <div>
          <p className="rs-card__meta">
            {lines.length} {lines.length === 1 ? "supply" : "supplies"}
          </p>
          <strong className="rs-card__amount">{formatKsh(value)}</strong>
        </div>
        <div className="rs-row">
          <button type="button" className="rs-btn" disabled={!lines.length || saving} onClick={() => void submit(false)}>
            Send request
          </button>
          <button
            type="button"
            className="rs-btn rs-btn--primary"
            disabled={!lines.length || saving}
            onClick={() => void submit(true)}
          >
            {saving ? "Saving…" : "Issue now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueDetail({ id }: { id: string }) {
  const router = useRouter();
  const [issue, setIssue] = useState<KitchenIssue | null>(null);
  const [given, setGiven] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchKitchenIssue(id)
      .then((data) => {
        if (!alive) return;
        setIssue(data);
        const filled: Record<string, string> = {};
        for (const line of data.lines ?? []) filled[line.id] = String(line.requested_qty ?? "");
        setGiven(filled);
      })
      .catch((err) => {
        if (alive) void showError("Could not load the issue", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <div className="rs"><p className="rs-empty">Loading…</p></div>;
  if (!issue) return <div className="rs"><p className="rs-empty">Issue not found.</p></div>;

  const lines = issue.lines ?? [];
  const pending = issue.status === "requested";

  async function release() {
    if (!issue) return;
    setBusy(true);
    try {
      const next = await releaseKitchenIssue(
        issue.id,
        lines.map((line) => ({ line_id: line.id, quantity: parseQty(given[line.id] ?? "") ?? 0 })),
      );
      setIssue(next);
      await toastSuccess("Issued to the kitchen");
    } catch (err) {
      await showError("Could not issue", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!issue) return;
    const ok = await confirmAction("Cancel this request?", "Nothing will move to the kitchen.", "Cancel request");
    if (!ok) return;
    setBusy(true);
    try {
      await cancelKitchenIssue(issue.id);
      router.replace("/trans-chap/kitchen");
    } catch (err) {
      await showError("Could not cancel", extractErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="rs">
      <div className="rs-card">
        <div className="rs-row rs-row--between">
          <div>
            <p className="rs-card__title">{issue.issue_date ? `Kitchen issue for ${issue.issue_date}` : "Kitchen issue"}</p>
            <p className="rs-card__meta">
              Requested {formatNairobiStamp24(issue.created_at)}
              {issue.issued_at ? ` · Issued ${formatNairobiStamp24(issue.issued_at)}` : ""}
            </p>
          </div>
          <div className="rs-row rs-issue-actions">
            <span className={`rs-badge ${issueStatusTone(issue.status)}`}>{KITCHEN_ISSUE_STATUS_LABELS[issue.status]}</span>
            <button
              type="button"
              className="rs-btn rs-btn--small"
              onClick={() => window.print()}
              title="Print issue voucher"
            >
              Print slip
            </button>
          </div>
        </div>
        {issue.notes ? <p className="rs-card__meta">{issue.notes}</p> : null}
        {pending ? (
          <p className="rs-card__meta">
            Store: hand over the supplies, enter what was actually given, then tap Issue. Stock moves from the store to
            the kitchen.
          </p>
        ) : null}
      </div>

      <div className="rs-table-wrap">
        <table className="rs-table">
          <thead>
            <tr>
              <th>Supply</th>
              <th className="rs-num">Requested</th>
              {pending ? <th className="rs-num">Store has</th> : null}
              <th className="rs-num">{pending ? "Give" : "Issued"}</th>
              {!pending ? <th className="rs-num">Value</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const giving = parseQty(given[line.id] ?? "") ?? 0;
              return (
                <tr key={line.id}>
                  <td>
                    <Link href={`/trans-chap/purchases/item?id=${encodeURIComponent(line.inventory_item_id)}`}>
                      {line.item_name}
                    </Link>
                    <div className="rs-muted">{line.unit}</div>
                  </td>
                  <td className="rs-num">{formatQty(line.requested_qty)}</td>
                  {pending ? (
                    <td className={`rs-num ${giving > (line.store_quantity ?? 0) ? "rs-neg" : ""}`}>
                      {formatQty(line.store_quantity)}
                    </td>
                  ) : null}
                  <td className="rs-num">
                    {pending ? (
                      <input
                        className="rs-input rs-input--qty"
                        inputMode="decimal"
                        value={given[line.id] ?? ""}
                        aria-label={`Give ${line.item_name}`}
                        onChange={(e) => setGiven((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      />
                    ) : (
                      <span className={line.issued_qty !== line.requested_qty ? "rs-neg" : undefined}>
                        {formatQty(line.issued_qty)}
                      </span>
                    )}
                  </td>
                  {!pending ? (
                    <td className="rs-num">
                      {line.issued_qty != null && line.unit_cost != null ? formatKsh(line.issued_qty * line.unit_cost) : "—"}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending ? (
        <div className="rs-total-bar">
          <button type="button" className="rs-btn rs-btn--danger" disabled={busy} onClick={() => void cancel()}>
            Cancel request
          </button>
          <button type="button" className="rs-btn rs-btn--primary" disabled={busy} onClick={() => void release()}>
            {busy ? "Issuing…" : "Issue to kitchen"}
          </button>
        </div>
      ) : issue.status === "issued" ? (
        <p className="trans-chap-sales__totals">
          <strong>{formatKsh(issue.issued_value)}</strong>
          <span>moved from store to kitchen</span>
        </p>
      ) : null}

      <div className="rs-print-signatures">
        <div className="rs-print-sig">
          <span>Released by (Storekeeper):</span>
          <div className="rs-print-sig__line" />
        </div>
        <div className="rs-print-sig">
          <span>Received by (Kitchen / Chef):</span>
          <div className="rs-print-sig__line" />
        </div>
      </div>
    </div>
  );
}
