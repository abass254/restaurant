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
  fetchKitchenStock,
  fetchKitchenSuggestion,
  formatQty,
  isKitchenIssuableRole,
  releaseKitchenIssue,
  roundQty,
  type KitchenIssue,
  type KitchenSuggestion,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { KitchenSetup, issueStatusTone } from "./RestaurantKitchenTab";

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

type Filter = "needed" | "selected" | "all";

function NewIssue() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<KitchenSuggestion[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<Filter>("needed");
  const [reloadKey, setReloadKey] = useState(0);

  const params = useSearchParams();
  const preselected = [params.get("items"), params.get("item")]
    .filter(Boolean)
    .join(",");
  const from = params.get("from");
  const canRequest = from !== "store";
  const canIssueNow = from !== "kitchen";
  const picks = useMemo(
    () => new Set(preselected.split(",").map((value) => value.trim()).filter(Boolean)),
    [preselected],
  );

  useEffect(() => {
    let alive = true;
    const isPicked = (row: KitchenSuggestion) => picks.has(row.inventory_item_id) || picks.has(row.name);
    fetchKitchenStock()
      .then(async (stock) => {
        if (!alive) return;
        setEnabled(stock.enabled);
        if (!stock.enabled) return;
        const data = await fetchKitchenSuggestion();
        if (!alive) return;
        setRows(data);
        setUnits(Object.fromEntries(data.map((row) => [row.inventory_item_id, row.unit])));
        const filled: Record<string, string> = {};
        for (const row of data) {
          if (picks.size) {
            if (!isPicked(row)) continue;
            filled[row.inventory_item_id] = String(row.suggested_qty > 0 ? row.suggested_qty : 1);
          } else if (row.suggested_qty > 0) {
            filled[row.inventory_item_id] = String(row.suggested_qty);
          }
        }
        setQty(filled);
        const needed = data.some(
          (row) => isKitchenIssuableRole(row.inventory_role) && (row.suggested_qty > 0 || isPicked(row)),
        );
        setFilter(needed ? "needed" : "all");
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
  }, [picks, reloadKey]);

  const issuable = useMemo(() => rows.filter((row) => isKitchenIssuableRole(row.inventory_role)), [rows]);
  const selectedUnit = (row: KitchenSuggestion) => row.units.find((unit) => unit.name === units[row.inventory_item_id]) ?? row.units[0] ?? { name: row.unit, factor: 1 };
  const wantedInputOf = (row: KitchenSuggestion) => parseQty(qty[row.inventory_item_id] ?? "") ?? 0;
  const wantedOf = (row: KitchenSuggestion) => roundQty(wantedInputOf(row) * selectedUnit(row).factor);
  const isPicked = (row: KitchenSuggestion) => picks.has(row.inventory_item_id) || picks.has(row.name);
  const isNeeded = (row: KitchenSuggestion) => row.suggested_qty > 0 || isPicked(row);

  const lines = issuable
    .map((row) => ({ row, quantity: wantedOf(row) }))
    .filter((line) => line.quantity > 0);
  const short = lines.filter((line) => line.quantity > line.row.store_quantity);
  const neededCount = issuable.filter(isNeeded).length;
  const suggestedRows = issuable.filter((row) => row.suggested_qty > 0);

  const needle = query.trim().toLowerCase();
  const visible = issuable
    .filter((row) => {
      if (needle) return row.name.toLowerCase().includes(needle);
      if (filter === "needed") return isNeeded(row) || wantedOf(row) > 0;
      if (filter === "selected") return wantedOf(row) > 0;
      return true;
    })
    .sort(
      (a, b) =>
        Number(isPicked(b)) - Number(isPicked(a)) ||
        b.daily_usage - a.daily_usage ||
        a.name.localeCompare(b.name),
    );

  function setRowQty(row: KitchenSuggestion, value: string) {
    setQty((prev) => ({ ...prev, [row.inventory_item_id]: value }));
  }

  function changeUnit(row: KitchenSuggestion, nextName: string) {
    const oldFactor = selectedUnit(row).factor || 1;
    const nextFactor = row.units.find((unit) => unit.name === nextName)?.factor || 1;
    const baseQty = wantedInputOf(row) * oldFactor;
    setUnits((prev) => ({ ...prev, [row.inventory_item_id]: nextName }));
    setRowQty(row, baseQty ? String(roundQty(baseQty / nextFactor)) : "");
  }

  function stepRow(row: KitchenSuggestion, delta: number) {
    setRowQty(row, String(Math.max(0, roundQty(wantedInputOf(row) + delta))));
  }

  function fillSuggested() {
    setQty((prev) => {
      const next = { ...prev };
      for (const row of suggestedRows) next[row.inventory_item_id] = String(roundQty(row.suggested_qty / (selectedUnit(row).factor || 1)));
      return next;
    });
  }

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
      router.replace(
        `/trans-chap/purchases/issue?id=${encodeURIComponent(issue.id)}${from ? `&from=${encodeURIComponent(from)}` : ""}`,
      );
    } catch (err) {
      await showError("Could not save the issue", extractErrorMessage(err));
      setSaving(false);
    }
  }

  if (loading) return <div className="rs"><p className="rs-empty">Loading kitchen supplies…</p></div>;
  if (enabled === false) {
    return (
      <div className="rs">
        <KitchenSetup
          onEnabled={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
        />
      </div>
    );
  }

  const title =
    from === "kitchen"
      ? "Request supplies from the store"
      : from === "store"
        ? "Issue supplies to the kitchen"
        : "Issue to kitchen";
  const intro =
    from === "kitchen"
      ? "Enter what the kitchen needs. The store sees your request and issues what it hands over."
      : from === "store"
        ? "Enter what you are handing over. Stock moves from the store to the kitchen when you tap Issue now."
        : "Issue now if you are handing supplies over, or send a request for the store to fill.";
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "needed", label: "Needed today", count: neededCount },
    { id: "selected", label: "Selected", count: lines.length },
    { id: "all", label: "All", count: issuable.length },
  ];

  return (
    <div className="rs">
      <div className="rs-card">
        <p className="rs-card__title">{title}</p>
        <p className="rs-card__meta">{intro}</p>
      </div>

      <div className="rs-issue-toolbar">
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
        <div className="rs-issue-filters" role="tablist" aria-label="Show supplies">
          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={!needle && filter === option.id}
              className={`trans-chap-sales__chip${!needle && filter === option.id ? " is-active" : ""}`}
              onClick={() => {
                setQuery("");
                setFilter(option.id);
              }}
            >
              {option.label} <span className="rs-issue-filters__count">{option.count}</span>
            </button>
          ))}
        </div>
        <div className="rs-row">
          {suggestedRows.length ? (
            <button type="button" className="rs-btn rs-btn--small" onClick={fillSuggested}>
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
              Fill suggested
            </button>
          ) : null}
          {lines.length ? (
            <button type="button" className="rs-btn rs-btn--small" onClick={() => setQty({})}>
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      {!issuable.length ? (
        <div className="rs-empty">
          No ingredients to issue yet. Mark supplies as raw materials in Inventory, or buy them through a purchase
          order.
        </div>
      ) : !visible.length ? (
        <div className="rs-empty">
          {needle
            ? `No supply matches “${query.trim()}”.`
            : filter === "needed"
              ? "Nothing is running low in the kitchen. Use All to issue something else."
              : "Nothing selected yet. Set a quantity on a supply to add it."}
        </div>
      ) : (
        <ul className="rs-issue-list">
          {visible.map((row) => {
            const wanted = wantedOf(row);
            const shortRow = wanted > row.store_quantity;
            return (
              <li key={row.inventory_item_id} className={`rs-issue-row${wanted > 0 ? " is-picked" : ""}`}>
                <div className="rs-issue-row__main">
                  <p className="rs-issue-row__name">{row.name}</p>
                  <p className="rs-issue-row__meta">
                    <span>
                      Kitchen{" "}
                      <strong className={row.kitchen_quantity < 0 ? "rs-neg" : undefined}>
                        {formatQty(row.kitchen_quantity, row.unit)}
                      </strong>
                    </span>
                    <span>
                      Store{" "}
                      <strong className={shortRow ? "rs-neg" : undefined}>
                        {formatQty(row.store_quantity, row.unit)}
                      </strong>
                    </span>
                    {row.daily_usage ? <span>Uses about {formatQty(row.daily_usage, row.unit)} a day</span> : null}
                  </p>
                  {shortRow ? (
                    <p className="rs-issue-row__warn">
                      The store only has {formatQty(row.store_quantity, row.unit)}.
                    </p>
                  ) : row.suggested_qty > 0 && wanted !== row.suggested_qty ? (
                    <button
                      type="button"
                      className="rs-issue-row__suggest"
                      onClick={() => setRowQty(row, String(row.suggested_qty))}
                    >
                      Suggested {formatQty(row.suggested_qty, row.unit)} · use it
                    </button>
                  ) : null}
                </div>
                <div className="rs-issue-stepper" role="group" aria-label={`${row.name} quantity`}>
                  <button type="button" aria-label="Less" disabled={wanted <= 0} onClick={() => stepRow(row, -1)}>
                    <i className="fa-solid fa-minus" aria-hidden />
                  </button>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={qty[row.inventory_item_id] ?? ""}
                    aria-label={`${canIssueNow ? "Issue" : "Request"} ${row.name}`}
                    onChange={(e) => setRowQty(row, e.target.value)}
                  />
                  <button type="button" aria-label="More" onClick={() => stepRow(row, 1)}>
                    <i className="fa-solid fa-plus" aria-hidden />
                  </button>
                  {row.units.length > 1 ? (
                    <select
                      className="rs-issue-stepper__unit-select"
                      aria-label={`Unit for ${row.name}`}
                      value={selectedUnit(row).name}
                      onChange={(event) => changeUnit(row, event.target.value)}
                    >
                      {row.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                    </select>
                  ) : <span className="rs-issue-stepper__unit">{row.unit}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rs-card__meta">
        Only ingredients are listed. Buy &amp; sell items (drinks, snacks) are sold straight from the store.
      </p>

      <label className="rs-field">
        <span>Note (optional)</span>
        <input
          className="rs-input"
          value={notes}
          maxLength={2000}
          placeholder="e.g. For the evening shift"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className="rs-total-bar">
        <div>
          <p className="rs-card__meta">{canIssueNow ? "To issue" : "To request"}</p>
          <strong className="rs-card__amount">
            {lines.length} {lines.length === 1 ? "supply" : "supplies"}
          </strong>
          {short.length && canIssueNow ? (
            <p className="rs-issue-row__warn">
              {short.length} {short.length === 1 ? "is" : "are"} more than the store has
            </p>
          ) : null}
        </div>
        <div className="rs-row">
          {canRequest ? (
            <button
              type="button"
              className={`rs-btn${canIssueNow ? "" : " rs-btn--primary"}`}
              disabled={!lines.length || saving}
              onClick={() => void submit(false)}
            >
              {saving && !canIssueNow ? "Sending…" : "Send request"}
            </button>
          ) : null}
          {canIssueNow ? (
            <button
              type="button"
              className="rs-btn rs-btn--primary"
              disabled={!lines.length || saving}
              onClick={() => void submit(true)}
            >
              {saving ? "Saving…" : "Issue now"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IssueDetail({ id }: { id: string }) {
  const router = useRouter();
  const [issue, setIssue] = useState<KitchenIssue | null>(null);
  const [given, setGiven] = useState<Record<string, string>>({});
  const [givenUnits, setGivenUnits] = useState<Record<string, string>>({});
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
        setGivenUnits(Object.fromEntries((data.lines ?? []).map((line) => [line.id, line.unit])));
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
  const givenUnitFor = (line: NonNullable<KitchenIssue["lines"]>[number]) =>
    line.units.find((unit) => unit.name === givenUnits[line.id]) ?? line.units[0] ?? { name: line.unit, factor: 1 };
  const givingBase = (line: NonNullable<KitchenIssue["lines"]>[number]) =>
    roundQty((parseQty(given[line.id] ?? "") ?? 0) * (givenUnitFor(line).factor || 1));

  async function release() {
    if (!issue) return;
    setBusy(true);
    try {
      const next = await releaseKitchenIssue(
        issue.id,
        lines.map((line) => ({ line_id: line.id, quantity: givingBase(line) })),
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
              const giving = givingBase(line);
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
                      <div className="rs-count-input">
                        <input
                          className="rs-input rs-input--qty"
                          inputMode="decimal"
                          value={given[line.id] ?? ""}
                          aria-label={`Give ${line.item_name}`}
                          onChange={(e) => setGiven((prev) => ({ ...prev, [line.id]: e.target.value }))}
                        />
                        {line.units.length > 1 ? (
                          <select
                            aria-label={`Unit for ${line.item_name}`}
                            value={givenUnitFor(line).name}
                            onChange={(e) => {
                              const oldFactor = givenUnitFor(line).factor || 1;
                              const nextFactor = line.units.find((unit) => unit.name === e.target.value)?.factor || 1;
                              const baseAmount = (parseQty(given[line.id] ?? "") ?? 0) * oldFactor;
                              setGivenUnits((prev) => ({ ...prev, [line.id]: e.target.value }));
                              setGiven((prev) => ({ ...prev, [line.id]: baseAmount ? String(roundQty(baseAmount / nextFactor)) : prev[line.id] ?? "" }));
                            }}
                          >
                            {line.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                          </select>
                        ) : <small>{line.unit}</small>}
                      </div>
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
