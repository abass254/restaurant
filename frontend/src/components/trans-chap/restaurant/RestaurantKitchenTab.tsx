"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  KITCHEN_ISSUE_STATUS_LABELS,
  enableKitchenIssuing,
  fetchKitchenIssues,
  fetchKitchenStock,
  fetchStockTakes,
  fetchSupplyItems,
  formatQty,
  recordKitchenUsed,
  returnToStore,
  roundQty,
  startStockTake,
  type KitchenIssue,
  type KitchenItem,
  type KitchenStock,
  type StockTake,
  type SupplyItem,
} from "@/lib/restaurant-supplies";
import {
  isHotelMenuItem,
  updateInventoryActive,
  updateInventoryItem,
} from "@/lib/trans-chap-product";
import type { InventoryItem } from "@/lib/types";
import { formatKsh } from "@/lib/trans-chap-receipt";

function parseQty(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? roundQty(parsed) : null;
}

export function issueStatusTone(status: KitchenIssue["status"]): string {
  if (status === "issued") return "rs-badge--ok";
  if (status === "cancelled") return "rs-badge--bad";
  return "rs-badge--warn";
}

export function RestaurantKitchenTab() {
  const [stock, setStock] = useState<KitchenStock | null>(null);
  const [issues, setIssues] = useState<KitchenIssue[]>([]);
  const [openCount, setOpenCount] = useState<StockTake | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchKitchenStock();
      setStock(next);
      if (next.enabled) {
        const [issueRows, takes] = await Promise.all([fetchKitchenIssues(), fetchStockTakes("kitchen")]);
        setIssues(issueRows);
        setOpenCount(takes.find((take) => take.status === "draft") ?? null);
      }
    } catch (err) {
      await showError("Could not load the kitchen", extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="rs-empty">Loading kitchen…</p>;
  if (!stock) return null;
  if (!stock.enabled) return <KitchenSetup onEnabled={setStock} />;
  return <KitchenBoard stock={stock} issues={issues} openCount={openCount} onStock={setStock} />;
}

function KitchenSetup({ onEnabled }: { onEnabled: (stock: KitchenStock) => void }) {
  const user = useAuthUser();
  const canEnable = isStoreAdmin(user);
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [setup, setSetup] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!setup) return;
    fetchSupplyItems()
      .then((rows) =>
        setItems(rows.filter((row) => row.stock_quantity != null && row.inventory_role !== "for_sale")),
      )
      .catch((err) => void showError("Could not load supplies", extractErrorMessage(err)));
  }, [setup]);

  async function enable() {
    const opening = items
      .map((item) => ({ inventory_item_id: item.id, quantity: parseQty(counts[item.id] ?? "") ?? 0 }))
      .filter((row) => row.quantity > 0);
    const ok = await confirmAction(
      "Turn on store and kitchen?",
      opening.length
        ? `${opening.length} ${opening.length === 1 ? "supply" : "supplies"} will move from the store to the kitchen. From now on, sales use kitchen stock for ingredients.`
        : "The kitchen starts empty. Issue supplies to it before cooking, or sales will show the kitchen running short.",
      "Turn on",
    );
    if (!ok) return;
    setSaving(true);
    try {
      const next = await enableKitchenIssuing(opening);
      await toastSuccess("Store and kitchen turned on");
      onEnabled(next);
    } catch (err) {
      await showError("Could not turn on store and kitchen", extractErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="rs-card">
      <p className="rs-card__title">Run the store and the kitchen separately</p>
      <p className="rs-card__meta">
        Deliveries go into the store. Each day the store issues what the kitchen needs, and the kitchen counts
        what is left at closing. You will see whether a loss happened in the store or in the kitchen, day by day.
        Drinks and other supplies sold as they are still come straight from the store.
      </p>
      {!canEnable ? (
        <p className="rs-card__meta">Ask the shop owner to turn this on.</p>
      ) : !setup ? (
        <div className="rs-row">
          <button type="button" className="rs-btn rs-btn--primary" onClick={() => setSetup(true)}>
            Set up store and kitchen
          </button>
        </div>
      ) : (
        <>
          <h3 className="rs-section-title">What is in the kitchen right now?</h3>
          <p className="rs-card__meta">
            Enter what is already in the kitchen. It moves out of the store figure so nothing is counted twice.
            Leave blank for zero.
          </p>
          <div className="rs-table-wrap">
            <table className="rs-table">
              <thead>
                <tr>
                  <th>Supply</th>
                  <th className="rs-num">In stock</th>
                  <th className="rs-num">In kitchen now</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="rs-num">{formatQty(item.stock_quantity, item.base_unit)}</td>
                    <td className="rs-num">
                      <input
                        className="rs-input rs-input--qty"
                        inputMode="decimal"
                        placeholder="0"
                        value={counts[item.id] ?? ""}
                        aria-label={`${item.name} in kitchen`}
                        onChange={(e) => setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rs-row">
            <button type="button" className="rs-btn" disabled={saving} onClick={() => setSetup(false)}>
              Back
            </button>
            <button type="button" className="rs-btn rs-btn--primary" disabled={saving} onClick={() => void enable()}>
              {saving ? "Turning on…" : "Turn on store and kitchen"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function KitchenBoard({
  stock,
  issues,
  openCount,
  onStock,
}: {
  stock: KitchenStock;
  issues: KitchenIssue[];
  openCount: StockTake | null;
  onStock: (stock: KitchenStock) => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"supplies" | "menu">("supplies");
  const [usingItem, setUsingItem] = useState<KitchenItem | null>(null);
  const [returning, setReturning] = useState(false);
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const pending = issues.filter((issue) => issue.status === "requested");
  const recent = issues.filter((issue) => issue.status !== "requested").slice(0, 10);
  const kitchenValue = stock.items.reduce((sum, item) => sum + Math.max(item.kitchen_value ?? 0, 0), 0);
  const storeValue = stock.items.reduce((sum, item) => sum + Math.max(item.store_value ?? 0, 0), 0);

  // The kitchen should ONLY show items sent to the kitchen from the inventory (kitchen_quantity > 0)
  const kitchenSupplies = useMemo(
    () => stock.items.filter((item) => (item.kitchen_quantity ?? 0) > 0),
    [stock.items],
  );

  const needle = query.trim().toLowerCase();
  const visible = kitchenSupplies.filter(
    (item) => !needle || item.name.toLowerCase().includes(needle),
  );

  async function closeDay() {
    if (openCount) {
      router.push(`/trans-chap/purchases/count?id=${encodeURIComponent(openCount.id)}`);
      return;
    }
    setBusy(true);
    try {
      const take = await startStockTake("kitchen");
      router.push(`/trans-chap/purchases/count?id=${encodeURIComponent(take.id)}`);
    } catch (err) {
      await showError("Could not start the kitchen count", extractErrorMessage(err));
      setBusy(false);
    }
  }

  async function submitReturn() {
    const lines = kitchenSupplies
      .map((item) => ({
        inventory_item_id: item.inventory_item_id,
        quantity: parseQty(returns[item.inventory_item_id] ?? "") ?? 0,
      }))
      .filter((row) => row.quantity > 0);
    if (!lines.length) return;
    setBusy(true);
    try {
      onStock(await returnToStore(lines));
      setReturns({});
      setReturning(false);
      await toastSuccess("Returned to the store");
    } catch (err) {
      await showError("Could not return to the store", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rs-row">
        <Link className="rs-btn rs-btn--primary" href="/trans-chap/purchases/issue?new=1">
          <i className="fa-solid fa-dolly" aria-hidden /> Issue to kitchen
        </Link>
        <button type="button" className="rs-btn" disabled={busy} onClick={() => void closeDay()}>
          {openCount ? "Continue closing count" : "Close kitchen day"}
        </button>
        <Link className="rs-btn" href="/trans-chap/purchases/kitchen-day">
          Kitchen day report
        </Link>
      </div>

      <div className="rs-tab-bar" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className={`rs-tab-btn ${activeTab === "supplies" ? "is-active" : ""}`}
          onClick={() => setActiveTab("supplies")}
        >
          <i className="fa-solid fa-boxes-stacked" aria-hidden /> Kitchen Supplies ({kitchenSupplies.length})
        </button>
        <button
          type="button"
          className={`rs-tab-btn ${activeTab === "menu" ? "is-active" : ""}`}
          onClick={() => setActiveTab("menu")}
        >
          <i className="fa-solid fa-utensils" aria-hidden /> Menu &amp; Production Time
        </button>
      </div>

      {activeTab === "menu" ? (
        <MenuPrepTimeSection />
      ) : (
        <>
          {pending.length ? (
            <>
              <h3 className="rs-section-title">Waiting for the store</h3>
              <ul className="rs-list">
                {pending.map((issue) => (
                  <li key={issue.id}>
                    <IssueCard issue={issue} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="rs-row rs-row--between" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            <h3 className="rs-section-title" style={{ margin: 0 }}>Kitchen Supplies</h3>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <p className="trans-chap-sales__totals" style={{ margin: 0 }}>
                <strong>{formatKsh(kitchenValue)}</strong>
                <span>kitchen stock</span>
              </p>
              <p className="trans-chap-sales__totals" style={{ margin: 0 }}>
                <strong>{formatKsh(storeValue)}</strong>
                <span>main store</span>
              </p>
            </div>
          </div>

          <div className="rs-row">
            <label className="trans-chap-sales__search" style={{ flex: 1 }}>
              <i className="fa-solid fa-magnifying-glass" aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="Search kitchen supplies…"
                aria-label="Search kitchen supplies"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {kitchenSupplies.length > 0 && (
              <button
                type="button"
                className={`trans-chap-sales__chip${returning ? " is-active" : ""}`}
                onClick={() => setReturning((on) => !on)}
              >
                <i className="fa-solid fa-rotate-left" style={{ marginRight: "0.3rem" }} />
                {returning ? "Cancel return" : "Return to store"}
              </button>
            )}
          </div>

          {kitchenSupplies.length === 0 ? (
            <div className="rs-card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
              <i
                className="fa-solid fa-kitchen-set"
                style={{ fontSize: "2.5rem", color: "var(--app-text-secondary)", marginBottom: "0.75rem", display: "block" }}
              />
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>No supplies in the kitchen yet</h4>
              <p
                className="rs-card__meta"
                style={{ margin: "0 0 1.25rem 0", maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}
              >
                The kitchen only holds items sent from the store inventory. Use &ldquo;Issue to kitchen&rdquo; to release ingredients to the kitchen for meal preparation.
              </p>
              <Link href="/trans-chap/purchases/issue?new=1" className="rs-btn rs-btn--primary">
                <i className="fa-solid fa-dolly" aria-hidden /> Issue supplies to kitchen
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <p className="rs-empty">No kitchen supplies match your search.</p>
          ) : (
            <div className="rs-table-wrap">
              <table className="rs-table">
                <thead>
                  <tr>
                    <th>Supply</th>
                    <th className="rs-num">In kitchen</th>
                    <th className="rs-num">Value</th>
                    <th className="rs-num">{returning ? "Return qty" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.inventory_item_id}>
                      <td>
                        <Link
                          href={`/trans-chap/purchases/item?id=${encodeURIComponent(item.inventory_item_id)}`}
                          style={{ fontWeight: 650 }}
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className={`rs-num ${item.kitchen_quantity < 0 ? "rs-neg" : ""}`} style={{ fontWeight: 700 }}>
                        {formatQty(item.kitchen_quantity, item.unit)}
                      </td>
                      <td className="rs-num" style={{ color: "var(--app-text-secondary)", fontSize: "0.85rem" }}>
                        {formatKsh(item.kitchen_value ?? 0)}
                      </td>
                      <td className="rs-num">
                        {returning ? (
                          <input
                            className="rs-input rs-input--qty"
                            inputMode="decimal"
                            placeholder="0"
                            value={returns[item.inventory_item_id] ?? ""}
                            aria-label={`Return ${item.name}`}
                            onChange={(e) =>
                              setReturns((prev) => ({ ...prev, [item.inventory_item_id]: e.target.value }))
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="rs-btn rs-btn--primary rs-btn--small"
                            onClick={() => setUsingItem(item)}
                            title={`Record ${item.name} used in kitchen`}
                          >
                            <i className="fa-solid fa-utensils" aria-hidden /> Used
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {returning && kitchenSupplies.length > 0 ? (
            <div className="rs-row">
              <button type="button" className="rs-btn" disabled={busy} onClick={() => setReturning(false)}>
                Cancel
              </button>
              <button type="button" className="rs-btn rs-btn--primary" disabled={busy} onClick={() => void submitReturn()}>
                {busy ? "Returning…" : "Return to store"}
              </button>
            </div>
          ) : (
            <p className="rs-card__meta">
              Click &ldquo;Used&rdquo; on an ingredient to record what was consumed during cooking or prep.
            </p>
          )}

          {recent.length ? (
            <>
              <h3 className="rs-section-title">Recent issues</h3>
              <ul className="rs-list">
                {recent.map((issue) => (
                  <li key={issue.id}>
                    <IssueCard issue={issue} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      {usingItem && (
        <KitchenUsedModal
          item={usingItem}
          onClose={() => setUsingItem(null)}
          onUsed={(next) => onStock(next)}
        />
      )}
    </>
  );
}

function KitchenUsedModal({
  item,
  onClose,
  onUsed,
}: {
  item: KitchenItem;
  onClose: () => void;
  onUsed: (nextStock: KitchenStock) => void;
}) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<"adjustment" | "wastage">("adjustment");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const available = item.kitchen_quantity;

  const quickAmounts = [
    { label: "0.25", val: 0.25 },
    { label: "0.5", val: 0.5 },
    { label: "1", val: 1 },
    { label: "2", val: 2 },
    { label: `All (${available})`, val: available },
  ].filter((opt) => opt.val <= available && opt.val > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseQty(qty);
    if (!parsed || parsed <= 0) {
      await showError("Invalid quantity", "Please enter a valid quantity greater than zero.");
      return;
    }
    if (parsed > available) {
      await showError("Too much", `The kitchen only has ${available} ${item.unit} of ${item.name}.`);
      return;
    }
    setBusy(true);
    try {
      const next = await recordKitchenUsed(
        [{ inventory_item_id: item.inventory_item_id, quantity: parsed }],
        note || (reason === "wastage" ? "Kitchen wastage / spoilage" : "Used in cooking / meal prep"),
        reason,
      );
      await toastSuccess(`Recorded ${formatQty(parsed, item.unit)} of ${item.name} as used`);
      onUsed(next);
      onClose();
    } catch (err) {
      await showError("Could not record usage", extractErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="rs-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="rs-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--app-border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>Record Used in Kitchen</h3>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--app-text-secondary)" }}>
              {item.name} &middot; <strong>{formatQty(available, item.unit)}</strong> in kitchen
            </p>
          </div>
          <button
            type="button"
            className="rs-btn"
            style={{ minHeight: "auto", padding: "0.3rem 0.55rem", border: "none", background: "transparent", fontSize: "1.2rem" }}
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ padding: "1.25rem 1.5rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.4rem" }}>
              Quantity used ({item.unit}) <span style={{ color: "var(--app-danger)" }}>*</span>
            </label>
            <input
              type="number"
              step="any"
              min="0.001"
              max={available}
              autoFocus
              className="rs-input"
              style={{ width: "100%", fontSize: "1.15rem", fontWeight: 700, padding: "0.55rem 0.75rem" }}
              placeholder="e.g. 1.5"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
            />
            {quickAmounts.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                {quickAmounts.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className="rs-btn rs-btn--small"
                    style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem", minHeight: "28px" }}
                    onClick={() => setQty(String(opt.val))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.4rem" }}>
              Usage Purpose
            </label>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button
                type="button"
                className={`rs-tab-btn ${reason === "adjustment" ? "is-active" : ""}`}
                style={{ flex: 1, justifyContent: "center", border: "1px solid var(--app-border)" }}
                onClick={() => setReason("adjustment")}
              >
                <i className="fa-solid fa-fire-burner" aria-hidden /> Cooking / Prep
              </button>
              <button
                type="button"
                className={`rs-tab-btn ${reason === "wastage" ? "is-active" : ""}`}
                style={{ flex: 1, justifyContent: "center", border: "1px solid var(--app-border)" }}
                onClick={() => setReason("wastage")}
              >
                <i className="fa-solid fa-trash-can" aria-hidden /> Spillage / Waste
              </button>
            </div>
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.4rem" }}>
              Note / Reference (optional)
            </label>
            <input
              type="text"
              className="rs-input"
              style={{ width: "100%", padding: "0.5rem 0.75rem" }}
              placeholder={reason === "wastage" ? "e.g. Spilled / burned batch" : "e.g. Lunch batch prep"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" className="rs-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="rs-btn rs-btn--primary" disabled={busy || !qty}>
              {busy ? "Saving…" : "Record Used"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MenuPrepTimeSection() {
  const [dishes, setDishes] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingPrepDishId, setEditingPrepDishId] = useState<string | null>(null);
  const [customMinutes, setCustomMinutes] = useState("");
  const [savingPrep, setSavingPrep] = useState(false);

  const loadDishes = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: InventoryItem[] }>(apiRoutes.inventory);
      const hotelItems = (res.data || []).filter((item) => isHotelMenuItem(item));
      setDishes(hotelItems);
    } catch (err) {
      await showError("Could not load menu dishes", extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDishes();
  }, [loadDishes]);

  async function handleToggle(dish: InventoryItem) {
    const nextState = !dish.is_active;
    setTogglingId(dish.id);
    // Optimistic update
    setDishes((prev) =>
      prev.map((d) => (d.id === dish.id ? { ...d, is_active: nextState } : d)),
    );
    try {
      await updateInventoryActive(dish.id, nextState);
      await toastSuccess(
        `"${dish.product?.name ?? "Dish"}" is now ${nextState ? "available" : "paused"}`,
      );
    } catch (err) {
      // Revert optimistic update
      setDishes((prev) =>
        prev.map((d) => (d.id === dish.id ? { ...d, is_active: !nextState } : d)),
      );
      await showError("Could not update dish availability", extractErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSavePrepTime(dish: InventoryItem, minutes: number | null) {
    setSavingPrep(true);
    const prevAttrs = (dish.attributes || {}) as Record<string, unknown>;
    const nextAttrs = { ...prevAttrs, prep_time_minutes: minutes };
    // Optimistic update
    setDishes((prev) =>
      prev.map((d) => (d.id === dish.id ? { ...d, attributes: nextAttrs } : d)),
    );
    setEditingPrepDishId(null);
    try {
      await updateInventoryItem(dish.id, { attributes: nextAttrs });
      await toastSuccess(
        minutes != null
          ? `Estimated prep time set to ${minutes} min for "${dish.product?.name}"`
          : `Prep time cleared for "${dish.product?.name}"`,
      );
    } catch (err) {
      setDishes((prev) =>
        prev.map((d) => (d.id === dish.id ? { ...d, attributes: prevAttrs } : d)),
      );
      await showError("Could not save prep time", extractErrorMessage(err));
    } finally {
      setSavingPrep(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = dishes.filter((dish) => {
    const nameMatch = !needle || (dish.product?.name ?? "").toLowerCase().includes(needle);
    if (!nameMatch) return false;
    if (statusFilter === "active") return dish.is_active;
    if (statusFilter === "inactive") return !dish.is_active;
    return true;
  });

  const activeCount = dishes.filter((d) => d.is_active).length;
  const inactiveCount = dishes.filter((d) => !d.is_active).length;

  if (loading) {
    return <p className="rs-empty">Loading menu items…</p>;
  }

  if (dishes.length === 0) {
    return (
      <div className="rs-card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
        <i
          className="fa-solid fa-utensils"
          style={{ fontSize: "2.5rem", color: "var(--app-text-secondary)", marginBottom: "0.75rem", display: "block" }}
        />
        <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>No menu dishes created yet</h4>
        <p
          className="rs-card__meta"
          style={{ margin: "0 0 1.25rem 0", maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}
        >
          Create your dishes, meals, and combos in the Menu section to manage their production times and availability here.
        </p>
        <Link href="/trans-chap/menu" className="rs-btn rs-btn--primary">
          <i className="fa-solid fa-plus" aria-hidden /> Go to Menu
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="rs-card" style={{ marginBottom: "1rem", background: "var(--app-surface-subtle, rgba(0,0,0,0.02))" }}>
        <p className="rs-card__title" style={{ fontSize: "0.95rem" }}>
          <i className="fa-solid fa-stopwatch" style={{ marginRight: "0.4rem", color: "var(--app-primary)" }} />
          Kitchen Production Time &amp; Dish Availability
        </p>
        <p className="rs-card__meta" style={{ margin: 0 }}>
          Enable or disable dishes based on current kitchen capacity and ingredient availability. Set estimated prep times so waitstaff and guests have accurate wait expectations at POS.
        </p>
      </div>

      <div className="rs-row rs-row--between" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <label className="trans-chap-sales__search" style={{ flex: 1, minWidth: 200 }}>
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search menu dishes…"
            aria-label="Search menu dishes"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button
            type="button"
            className={`trans-chap-sales__chip ${statusFilter === "all" ? "is-active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            All ({dishes.length})
          </button>
          <button
            type="button"
            className={`trans-chap-sales__chip ${statusFilter === "active" ? "is-active" : ""}`}
            onClick={() => setStatusFilter("active")}
          >
            Available ({activeCount})
          </button>
          <button
            type="button"
            className={`trans-chap-sales__chip ${statusFilter === "inactive" ? "is-active" : ""}`}
            onClick={() => setStatusFilter("inactive")}
          >
            Paused ({inactiveCount})
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rs-empty">No dishes match your filter.</p>
      ) : (
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>Menu Dish</th>
                <th className="rs-num">Price</th>
                <th>Estimated Prep Time</th>
                <th className="rs-num">Availability</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((dish) => {
                const attrs = (dish.attributes || {}) as Record<string, unknown>;
                const prepTime = typeof attrs.prep_time_minutes === "number" ? attrs.prep_time_minutes : null;
                const isEditingThis = editingPrepDishId === dish.id;

                return (
                  <tr key={dish.id} style={{ opacity: dish.is_active ? 1 : 0.65 }}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                        {dish.product?.name ?? "Dish"}
                      </div>
                      <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.15rem" }}>
                        <span className="rs-badge" style={{ fontSize: "0.68rem" }}>
                          {dish.product?.product_type === "combo" ? "Combo" : "Meal"}
                        </span>
                        {dish.product?.category && (
                          <span style={{ fontSize: "0.72rem", color: "var(--app-text-secondary)" }}>
                            {dish.product.category}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="rs-num" style={{ fontWeight: 600 }}>
                      {formatKsh(dish.selling_price ?? 0)}
                    </td>
                    <td>
                      {isEditingThis ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.3rem 0" }}>
                          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                            {[5, 10, 15, 20, 25, 30, 45, 60].map((mins) => (
                              <button
                                key={mins}
                                type="button"
                                className={`rs-btn rs-btn--small ${prepTime === mins ? "rs-btn--primary" : ""}`}
                                style={{ minHeight: "26px", padding: "0 0.45rem", fontSize: "0.72rem" }}
                                onClick={() => void handleSavePrepTime(dish, mins)}
                                disabled={savingPrep}
                              >
                                {mins}m
                              </button>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                            <input
                              type="number"
                              min="1"
                              max="300"
                              placeholder="Custom min"
                              value={customMinutes}
                              onChange={(e) => setCustomMinutes(e.target.value)}
                              className="rs-input"
                              style={{ width: "90px", padding: "0.2rem 0.4rem", fontSize: "0.78rem" }}
                            />
                            <button
                              type="button"
                              className="rs-btn rs-btn--primary rs-btn--small"
                              style={{ minHeight: "26px", padding: "0 0.5rem", fontSize: "0.72rem" }}
                              disabled={savingPrep || !customMinutes}
                              onClick={() => {
                                const val = parseInt(customMinutes, 10);
                                if (val > 0) void handleSavePrepTime(dish, val);
                              }}
                            >
                              Save
                            </button>
                            {prepTime != null && (
                              <button
                                type="button"
                                className="rs-btn rs-btn--danger rs-btn--small"
                                style={{ minHeight: "26px", padding: "0 0.45rem", fontSize: "0.72rem" }}
                                onClick={() => void handleSavePrepTime(dish, null)}
                                disabled={savingPrep}
                                title="Clear prep time"
                              >
                                Clear
                              </button>
                            )}
                            <button
                              type="button"
                              className="rs-btn rs-btn--small"
                              style={{ minHeight: "26px", padding: "0 0.45rem", fontSize: "0.72rem" }}
                              onClick={() => setEditingPrepDishId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rs-btn rs-btn--small"
                          style={{
                            minHeight: "28px",
                            padding: "0.15rem 0.55rem",
                            fontSize: "0.76rem",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            border: prepTime ? "1px solid var(--app-accent-teal, #0f766e)" : "1px dashed var(--app-border)",
                            background: prepTime ? "var(--app-accent-teal-soft, #dff5ee)" : "transparent",
                            color: prepTime ? "var(--app-accent-teal, #0f766e)" : "inherit",
                          }}
                          onClick={() => {
                            setEditingPrepDishId(dish.id);
                            setCustomMinutes(prepTime ? String(prepTime) : "");
                          }}
                          title="Click to change estimated preparation time"
                        >
                          <i className="fa-solid fa-clock" aria-hidden />
                          {prepTime ? `${prepTime} min prep` : "Set prep time"}
                          <i className="fa-solid fa-pencil" style={{ fontSize: "0.62rem", opacity: 0.7 }} />
                        </button>
                      )}
                    </td>
                    <td className="rs-num">
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                        <button
                          type="button"
                          role="switch"
                          className={`theme-switch ${dish.is_active ? "is-on" : ""}`}
                          aria-checked={dish.is_active}
                          aria-label={dish.is_active ? `Disable ${dish.product?.name}` : `Enable ${dish.product?.name}`}
                          disabled={togglingId === dish.id}
                          onClick={() => void handleToggle(dish)}
                        >
                          <span className="theme-switch__thumb" aria-hidden />
                        </button>
                        <span className={`rs-badge ${dish.is_active ? "rs-badge--ok" : "rs-badge--warn"}`}>
                          {dish.is_active ? "Available" : "Paused"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function IssueCard({ issue }: { issue: KitchenIssue }) {
  return (
    <Link href={`/trans-chap/purchases/issue?id=${encodeURIComponent(issue.id)}`} className="rs-card">
      <div className="rs-row rs-row--between">
        <p className="rs-card__title">
          {issue.issue_date ? `Issue for ${issue.issue_date}` : "Kitchen issue"}
        </p>
        {issue.status === "issued" ? <span className="rs-card__amount">{formatKsh(issue.issued_value)}</span> : null}
      </div>
      <div className="rs-row">
        <em className={`rs-badge ${issueStatusTone(issue.status)}`}>{KITCHEN_ISSUE_STATUS_LABELS[issue.status]}</em>
        <span className="rs-card__meta">
          {issue.line_count} {issue.line_count === 1 ? "supply" : "supplies"}
          {issue.issued_at ? ` · ${formatNairobiStamp24(issue.issued_at)}` : ""}
        </span>
      </div>
    </Link>
  );
}
