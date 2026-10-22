"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import {
  clockInKitchenShift,
  clockOutKitchenShift,
  enableKitchenIssuing,
  fetchKitchenShift,
  fetchKitchenEquivalenceUnits,
  fetchKitchenStock,
  fetchSupplyItems,
  formatQty,
  recordKitchenUsed,
  roundQty,
  saveKitchenEquivalenceUnits,
  fetchMenuCosting,
  type MenuCosting,
  type KitchenIssue,
  type KitchenItem,
  type KitchenShiftState,
  type KitchenStock,
  type SupplyItem,
} from "@/lib/restaurant-supplies";
import {
  inventoryProductName,
  isHotelMenuItem,
  isSupplyItem,
  saveRecipe,
  supportsKitchenRecipe,
  updateInventoryActive,
} from "@/lib/trans-chap-product";
import { RestaurantKitchenModifiers } from "@/components/trans-chap/restaurant/RestaurantKitchenModifiers";
import {
  RecipeField,
  parseRecipeQty,
  recipeDraftLines,
  type RecipeDraft,
} from "@/components/trans-chap/TransChapMenuRecipeField";
import type { InventoryItem } from "@/lib/types";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";

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
  const [shift, setShift] = useState<KitchenShiftState | null>(null);
  const [shiftLoadFailed, setShiftLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchKitchenStock();
      setStock(next);
      if (next.enabled) {
        setShift(await fetchKitchenShift());
      }
      setShiftLoadFailed(false);
    } catch (err) {
      setShiftLoadFailed(true);
      await showError("Could not load the kitchen", extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onEnabled(next: KitchenStock) {
    setStock(next);
    try {
      setShift(await fetchKitchenShift());
      setShiftLoadFailed(false);
    } catch (err) {
      setShiftLoadFailed(true);
      await showError("Could not load the kitchen shift", extractErrorMessage(err));
    }
  }

  if (loading) return <p className="rs-empty">Loading kitchen…</p>;
  if (!stock) return null;
  if (!stock.enabled) return <KitchenSetup onEnabled={(next) => void onEnabled(next)} />;
  if (!shift) {
    return (
      <p className="rs-empty">
        {shiftLoadFailed ? "Kitchen shift could not be loaded. Refresh the page to try again." : "Loading kitchen shift…"}
      </p>
    );
  }
  return (
    <KitchenBoard
      stock={stock}
      onStock={setStock}
      shift={shift}
      onShift={setShift}
    />
  );
}

export function KitchenSetup({ onEnabled }: { onEnabled: (stock: KitchenStock) => void }) {
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
        : "The kitchen starts empty. Order supplies from inventory before cooking, or sales will show the kitchen running short.",
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
  onStock,
  shift,
  onShift,
}: {
  stock: KitchenStock;
  onStock: (stock: KitchenStock) => void;
  shift: KitchenShiftState;
  onShift: (shift: KitchenShiftState) => void;
}) {
  const [activeView, setActiveView] = useState<"all" | "inventory" | "menu">("all");
  const [usingItem, setUsingItem] = useState<KitchenItem | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState("");

  const [dishes, setDishes] = useState<InventoryItem[]>([]);
  const [supplies, setSupplies] = useState<InventoryItem[]>([]);
  const [dishesLoading, setDishesLoading] = useState(true);

  const loadDishes = useCallback(async (): Promise<InventoryItem[] | null> => {
    try {
      const res = await apiFetch<{ data: InventoryItem[] }>(apiRoutes.inventory);
      const hotelItems = (res.data || []).filter((item) => isHotelMenuItem(item));
      setSupplies((res.data || []).filter((item) => isSupplyItem(item)));
      setDishes(hotelItems);
      return res.data;
    } catch (err) {
      await showError("Could not load current menu", extractErrorMessage(err));
      return null;
    } finally {
      setDishesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDishes();
  }, [loadDishes]);

  // Only items issued/sent to the kitchen from inventory (kitchen_quantity > 0)
  const kitchenSupplies = useMemo(
    () => stock.items.filter((item) => (item.kitchen_quantity ?? 0) > 0),
    [stock.items],
  );
  const kitchenSupplyProductIds = useMemo(() => {
    const kitchenInventoryIds = new Set(stock.items.map((item) => item.inventory_item_id));
    return new Set(
      supplies
        .filter((item) => item.is_active && kitchenInventoryIds.has(item.id))
        .map((item) => item.product_id),
    );
  }, [stock.items, supplies]);

  const totalKitchenValue = useMemo(
    () => kitchenSupplies.reduce((sum, item) => sum + (item.kitchen_value ?? 0), 0),
    [kitchenSupplies],
  );

  const activeDishesCount = useMemo(
    () => dishes.filter((d) => d.is_active).length,
    [dishes],
  );
  const inactiveDishesCount = dishes.length - activeDishesCount;

  const needle = inventoryQuery.trim().toLowerCase();
  const visibleSupplies = kitchenSupplies.filter(
    (item) => !needle || item.name.toLowerCase().includes(needle),
  );

  async function refreshShift(next: KitchenShiftState) {
    onShift(next);
    try {
      onStock(await fetchKitchenStock());
    } catch (err) {
      await showError("Shift updated, but kitchen stock could not be refreshed", extractErrorMessage(err));
    }
  }

  if (!shift.session) {
    return (
      <div className="tc-kitchen-page">
        <KitchenShiftPanel shift={shift} onShift={(next) => void refreshShift(next)} />
        <p className="rs-empty">Confirm the store handover and clock in to access the kitchen order queue.</p>
      </div>
    );
  }

  return (
    <div className="tc-kitchen-page">
      <KitchenShiftPanel shift={shift} onShift={(next) => void refreshShift(next)} />
      {/* 1. Header with Title, Badge, and Action Buttons */}
      <header className="tc-kitchen-header">
        <div className="tc-kitchen-header__info">
          <div className="tc-kitchen-header__badge">
            <i className="fa-solid fa-fire-burner" aria-hidden />
            <span>Kitchen Live</span>
          </div>
          <h1 className="tc-kitchen-header__title">Kitchen Operations</h1>
          <p className="tc-kitchen-header__subtitle">
            Manage inventory items in the kitchen and live meal availability.
          </p>
        </div>

        <div className="tc-kitchen-header__actions">
          <Link
            className="tc-kitchen-action tc-kitchen-action--primary"
            href="/trans-chap/purchases/issue?new=1&from=kitchen"
          >
            <span className="tc-kitchen-action__icon" aria-hidden>
              <i className="fa-solid fa-cart-flatbed" />
            </span>
            <span className="tc-kitchen-action__text">
              <strong>Order from inventory</strong>
              <small>Request supplies from the store</small>
            </span>
          </Link>
          <Link className="tc-kitchen-action" href="/trans-chap/sales">
            <span className="tc-kitchen-action__icon" aria-hidden>
              <i className="fa-solid fa-clipboard-list" />
            </span>
            <span className="tc-kitchen-action__text">
              <strong>Open order queue</strong>
              <small>View and manage kitchen orders</small>
            </span>
          </Link>
        </div>
      </header>

      {/* 2. Quick KPI Summary Cards */}
      <div className="tc-kitchen-stats" aria-label="Kitchen summary">
        <div className="tc-kitchen-stat-card">
          <div className="tc-kitchen-stat-icon tc-kitchen-stat-icon--teal" aria-hidden>
            <i className="fa-solid fa-boxes-stacked" />
          </div>
          <div className="tc-kitchen-stat-info">
            <span className="tc-kitchen-stat-label">Items from inventory</span>
            <strong className="tc-kitchen-stat-val">
              {kitchenSupplies.length} {kitchenSupplies.length === 1 ? "item" : "items"}
            </strong>
            <span className="tc-kitchen-stat-sub">Value: {formatKsh(totalKitchenValue)}</span>
          </div>
        </div>

        <div className="tc-kitchen-stat-card">
          <div className="tc-kitchen-stat-icon tc-kitchen-stat-icon--amber" aria-hidden>
            <i className="fa-solid fa-utensils" />
          </div>
          <div className="tc-kitchen-stat-info">
            <span className="tc-kitchen-stat-label">Current Menu Dishes</span>
            <strong className="tc-kitchen-stat-val">
              {activeDishesCount} / {dishes.length} Available
            </strong>
            <span className="tc-kitchen-stat-sub">
              {inactiveDishesCount > 0 ? `${inactiveDishesCount} paused dishes` : "All dishes active"}
            </span>
          </div>
        </div>

        <div className="tc-kitchen-stat-card">
          <div className="tc-kitchen-stat-icon tc-kitchen-stat-icon--indigo" aria-hidden>
            <i className="fa-solid fa-clock-rotate-left" />
          </div>
          <div className="tc-kitchen-stat-info">
            <span className="tc-kitchen-stat-label">Daily Session</span>
            <strong className="tc-kitchen-stat-val">
              Session Active
            </strong>
            <span className="tc-kitchen-stat-sub">
              Since {formatNairobiStamp24(shift.session.clocked_in_at)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. View Switcher Tabs */}
      <div className="tc-kitchen-tabs" role="tablist" aria-label="Kitchen Sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "all"}
          className={`tc-kitchen-tab-btn ${activeView === "all" ? "is-active" : ""}`}
          onClick={() => setActiveView("all")}
        >
          <i className="fa-solid fa-layer-group" aria-hidden />
          <span>All Sections</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "inventory"}
          className={`tc-kitchen-tab-btn ${activeView === "inventory" ? "is-active" : ""}`}
          onClick={() => setActiveView("inventory")}
        >
          <i className="fa-solid fa-boxes-stacked" aria-hidden />
          <span>Items from inventory</span>
          <span className="tc-kitchen-tab-pill">{kitchenSupplies.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "menu"}
          className={`tc-kitchen-tab-btn ${activeView === "menu" ? "is-active" : ""}`}
          onClick={() => setActiveView("menu")}
        >
          <i className="fa-solid fa-utensils" aria-hidden />
          <span>Current Menu</span>
          <span className="tc-kitchen-tab-pill">{dishes.length}</span>
        </button>
      </div>

      {/* 4. Section 1: Items from inventory */}
      {(activeView === "all" || activeView === "inventory") && (
        <section className="tc-kitchen-section" aria-label="Items from inventory">
          <div className="tc-kitchen-section__head">
            <div>
              <h3 className="tc-kitchen-section__title">
                <i className="fa-solid fa-boxes-stacked" aria-hidden />
                <span>Items from inventory</span>
                <span className="rs-badge" style={{ fontSize: "0.75rem" }}>{kitchenSupplies.length}</span>
              </h3>
              <p className="tc-kitchen-section__subtitle">
                Supplies issued from main store inventory for cooking and food preparation.
              </p>
            </div>
            {kitchenSupplies.length > 0 && (
              <span className="rs-badge rs-badge--ok" style={{ fontSize: "0.78rem" }}>
                Total: <strong>{formatKsh(totalKitchenValue)}</strong>
              </span>
            )}
          </div>

          <div className="tc-kitchen-toolbar">
            <div className="tc-kitchen-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden />
              <input
                type="search"
                value={inventoryQuery}
                placeholder="Search items in kitchen…"
                aria-label="Search items from inventory"
                onChange={(e) => setInventoryQuery(e.target.value)}
              />
              {inventoryQuery ? (
                <button
                  type="button"
                  className="tc-kitchen-search__clear"
                  onClick={() => setInventoryQuery("")}
                  aria-label="Clear search"
                >
                  <i className="fa-solid fa-xmark" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          {kitchenSupplies.length === 0 ? (
            <div className="rs-card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
              <i
                className="fa-solid fa-kitchen-set"
                style={{ fontSize: "2.5rem", color: "var(--app-text-secondary)", marginBottom: "0.75rem", display: "block" }}
              />
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>No items from inventory in the kitchen yet</h4>
              <p
                className="rs-card__meta"
                style={{ margin: "0 0 1.25rem 0", maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}
              >
                Order supplies from your inventory store to bring ingredients to the kitchen for meal preparation.
              </p>
              <Link href="/trans-chap/purchases/issue?new=1&from=kitchen" className="tc-kitchen-btn tc-kitchen-btn--primary">
                <i className="fa-solid fa-cart-flatbed" aria-hidden /> Order items from the inventory
              </Link>
            </div>
          ) : visibleSupplies.length === 0 ? (
            <p className="rs-empty">No items match &quot;{inventoryQuery}&quot;.</p>
          ) : (
            <div className="rs-table-wrap">
              <table className="rs-table tc-kitchen-table">
                <thead>
                  <tr>
                    <th>Item from inventory</th>
                    <th className="rs-num">In kitchen</th>
                    <th className="rs-num">Value</th>
                    <th className="rs-num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSupplies.map((item) => (
                    <tr key={item.inventory_item_id}>
                      <td>
                        <Link
                          href={`/trans-chap/purchases/item?id=${encodeURIComponent(item.inventory_item_id)}`}
                          style={{ fontWeight: 700, color: "var(--app-text)" }}
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className={`rs-num ${item.kitchen_quantity < 0 ? "rs-neg" : ""}`} style={{ fontWeight: 800, fontSize: "0.95rem" }}>
                        {formatQty(item.kitchen_quantity, item.unit)}
                      </td>
                      <td className="rs-num" style={{ color: "var(--app-text-secondary)", fontSize: "0.85rem", fontWeight: 650 }}>
                        {formatKsh(item.kitchen_value ?? 0)}
                      </td>
                      <td className="rs-num">
                        <button
                          type="button"
                          className="rs-btn rs-btn--primary rs-btn--small"
                          onClick={() => setUsingItem(item)}
                          title={`Record ${item.name} used in kitchen`}
                          style={{ minHeight: "34px", fontWeight: 750 }}
                        >
                          <i className="fa-solid fa-utensils" aria-hidden />{" "}
                          <span className="tc-kitchen-table__action-label">Record Used</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 5. Section 2: Current Menu */}
      {(activeView === "all" || activeView === "menu") && (
        <section className="tc-kitchen-section" aria-label="Current Menu">
          <CurrentMenuSection
            dishes={dishes}
            setDishes={setDishes}
            supplies={supplies}
            kitchenSupplyProductIds={kitchenSupplyProductIds}
            reloadDishes={loadDishes}
            loading={dishesLoading}
          />
        </section>
      )}

      {(activeView === "all" || activeView === "menu") && !dishesLoading && (
        <section className="tc-kitchen-section" aria-label="Modifier options">
          <RestaurantKitchenModifiers dishes={dishes} />
        </section>
      )}

      {usingItem && (
        <KitchenUsedModal
          item={usingItem}
          onClose={() => setUsingItem(null)}
          onUsed={(next) => onStock(next)}
        />
      )}

    </div>
  );
}

function KitchenShiftPanel({
  shift,
  onShift,
}: {
  shift: KitchenShiftState;
  onShift: (shift: KitchenShiftState) => void;
}) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [clockOut, setClockOut] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [ordersCleared, setOrdersCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const session = shift.session;

  async function startShift() {
    if (!shift.items.length) {
      await showError("No kitchen stock to confirm", "Ask the store to issue supplies before clocking in.");
      return;
    }
    if (shift.items.some((item) => !confirmed[item.inventory_item_id])) {
      await showError("Confirm every item", "Review and confirm each issued quantity before clocking in.");
      return;
    }
    setBusy(true);
    try {
      const next = await clockInKitchenShift(
        shift.items.map((item) => ({
          inventory_item_id: item.inventory_item_id,
          quantity: item.kitchen_quantity,
        })),
      );
      onShift(next);
      await toastSuccess("Kitchen shift started");
    } catch (err) {
      await showError("Could not clock in", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function finishShift() {
    const parsed = shift.items.map((item) => ({
      inventory_item_id: item.inventory_item_id,
      quantity: parseQty(counts[item.inventory_item_id] ?? ""),
    }));
    if (parsed.some((item) => item.quantity == null)) {
      await showError("Complete every count", "Enter the physical closing count for every kitchen item.");
      return;
    }
    const hasVariance = parsed.some((row, index) => row.quantity !== shift.items[index].kitchen_quantity);
    if (hasVariance && !note.trim()) {
      await showError("Explain the difference", "Add a note describing the stock difference before clocking out.");
      return;
    }
    setBusy(true);
    try {
      const validCounts = parsed.flatMap((item) =>
        item.quantity == null
          ? []
          : [{ inventory_item_id: item.inventory_item_id, quantity: item.quantity }],
      );
      if (validCounts.length !== parsed.length) return;
      const next = await clockOutKitchenShift(validCounts, note, ordersCleared);
      onShift(next);
      setClockOut(false);
      setConfirmed({});
      setCounts({});
      setNote("");
      setOrdersCleared(false);
      await toastSuccess("Kitchen shift closed and stock reconciled");
    } catch (err) {
      await showError("Could not clock out", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rs-card" aria-label="Kitchen shift handover">
      <div className="rs-row rs-row--between">
        <div>
          <p className="rs-card__title">{session ? "Kitchen shift in progress" : "Confirm stock to clock in"}</p>
          <p className="rs-card__meta">
            {session
              ? `Clocked in ${formatNairobiStamp24(session.clocked_in_at)}. Confirm closing counts before signing out.`
              : "Check the quantities handed over by the store. You can only start the order queue after confirming all items."}
          </p>
        </div>
        <span className={`rs-badge ${session ? "rs-badge--ok" : "rs-badge--warn"}`}>
          {session ? "On duty" : "Awaiting handover"}
        </span>
      </div>

      {!session ? (
        <>
          {shift.items.length ? (
            <div className="rs-table-wrap">
              <table className="rs-table">
                <thead>
                  <tr><th>Issued supply</th><th className="rs-num">Quantity to confirm</th><th className="rs-num">Confirmed</th></tr>
                </thead>
                <tbody>
                  {shift.items.map((item) => (
                    <tr key={item.inventory_item_id}>
                      <td>{item.name}<div className="rs-muted">{item.unit}</div></td>
                      <td className="rs-num"><strong>{formatQty(item.kitchen_quantity, item.unit)}</strong></td>
                      <td className="rs-num">
                        <input
                          type="checkbox"
                          checked={Boolean(confirmed[item.inventory_item_id])}
                          aria-label={`Confirm ${item.name} handover`}
                          onChange={(event) =>
                            setConfirmed((previous) => ({
                              ...previous,
                              [item.inventory_item_id]: event.target.checked,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="rs-empty">The store has not issued any stock to the kitchen yet.</p>}
          <div className="rs-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="rs-btn rs-btn--primary" disabled={busy || !shift.items.length} onClick={() => void startShift()}>
              {busy ? "Starting shift…" : "Confirm handover & clock in"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="rs-card__meta">
            Current kitchen stock is reconciled from sales, recorded use, and store issues. Count what is physically left at the end of the shift.
          </p>
          {clockOut ? (
            <>
              {shift.items.length ? (
                <div className="rs-table-wrap">
                  <table className="rs-table">
                    <thead><tr><th>Supply</th><th className="rs-num">System quantity</th><th className="rs-num">Physical count</th></tr></thead>
                    <tbody>
                      {shift.items.map((item) => (
                        <tr key={item.inventory_item_id}>
                          <td>{item.name}<div className="rs-muted">{item.unit}</div></td>
                          <td className="rs-num">{formatQty(item.kitchen_quantity, item.unit)}</td>
                          <td className="rs-num">
                            <input
                              className="rs-input rs-input--qty"
                              inputMode="decimal"
                              value={counts[item.inventory_item_id] ?? ""}
                              aria-label={`Closing count for ${item.name}`}
                              placeholder="Enter count"
                              onChange={(event) =>
                                setCounts((previous) => ({
                                  ...previous,
                                  [item.inventory_item_id]: event.target.value,
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="rs-empty">No stock lines to count for this shift.</p>}
              <label style={{ display: "block", marginTop: "1rem" }}>
                <span className="rs-card__meta">Variance note (required if counts differ)</span>
                <textarea
                  className="rs-input"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Explain any missing, damaged, or wasted stock"
                  style={{ display: "block", width: "100%", marginTop: "0.4rem" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "0.55rem", marginTop: "0.8rem" }}>
                <input
                  type="checkbox"
                  checked={ordersCleared}
                  onChange={(event) => setOrdersCleared(event.target.checked)}
                />
                <span className="rs-card__meta">
                  I have completed or handed over every active order.{" "}
                  <Link href="/trans-chap/sales" target="_blank" rel="noreferrer">
                    Review the order queue
                  </Link>{" "}
                  before closing this shift.
                </span>
              </label>
              <div className="rs-row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="rs-btn" disabled={busy} onClick={() => setClockOut(false)}>Back</button>
                <button
                  type="button"
                  className="rs-btn rs-btn--primary"
                  disabled={busy || !ordersCleared}
                  onClick={() => void finishShift()}
                >
                  {busy ? "Reconciling…" : "Confirm counts & clock out"}
                </button>
              </div>
            </>
          ) : (
            <div className="rs-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="rs-btn rs-btn--danger" onClick={() => setClockOut(true)}>
                Count stock &amp; clock out
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CurrentMenuSection({
  dishes,
  setDishes,
  supplies,
  kitchenSupplyProductIds,
  reloadDishes,
  loading,
}: {
  dishes: InventoryItem[];
  setDishes: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  supplies: InventoryItem[];
  kitchenSupplyProductIds: ReadonlySet<string>;
  reloadDishes: () => Promise<InventoryItem[] | null>;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [recipeEditor, setRecipeEditor] = useState<InventoryItem | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft[]>([]);
  const [recipeServingUnit, setRecipeServingUnit] = useState("servings");
  const [loadingRecipeStock, setLoadingRecipeStock] = useState(false);
  const [recipeStockLoadFailed, setRecipeStockLoadFailed] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [costing, setCosting] = useState<Map<string, MenuCosting>>(new Map());
  const [equivalenceUnits, setEquivalenceUnits] = useState<string[]>([]);
  const [costingLoading, setCostingLoading] = useState(true);
  const [costingLoadFailed, setCostingLoadFailed] = useState(false);

  const refreshCosting = useCallback(async () => {
    setCostingLoading(true);
    setCostingLoadFailed(false);
    try {
      const rows = await fetchMenuCosting();
      setCosting(new Map(rows.map((row) => [row.inventory_item_id, row])));
    } catch (err) {
      setCostingLoadFailed(true);
      await showError("Could not load meal portions", extractErrorMessage(err));
    } finally {
      setCostingLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchMenuCosting()
      .then((rows) => {
        if (active) {
          setCosting(new Map(rows.map((row) => [row.inventory_item_id, row])));
          setCostingLoadFailed(false);
        }
      })
      .catch((err) => {
        if (active) {
          setCostingLoadFailed(true);
          void showError("Could not load meal portions", extractErrorMessage(err));
        }
      })
      .finally(() => {
        if (active) setCostingLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetchKitchenEquivalenceUnits()
      .then(setEquivalenceUnits)
      .catch((err) => void showError("Could not load equivalence measures", extractErrorMessage(err)));
  }, []);

  async function updateEquivalenceUnits(units: string[]) {
    try {
      setEquivalenceUnits(await saveKitchenEquivalenceUnits(units));
    } catch (err) {
      await showError("Could not save equivalence measures", extractErrorMessage(err));
      throw err;
    }
  }

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
        `"${dish.product?.name ?? "Dish"}" is now ${nextState ? "enabled (available)" : "disabled (paused)"}`,
      );
    } catch (err) {
      // Revert optimistic update
      setDishes((prev) =>
        prev.map((d) => (d.id === dish.id ? { ...d, is_active: !nextState } : d)),
      );
      await showError("Could not update menu dish availability", extractErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function openRecipeEditor(dish: InventoryItem) {
    setRecipeEditor(dish);
    setRecipeServingUnit(dish.product?.recipe_serving_unit || "servings");
    setRecipeDraft(
      (dish.product?.recipe ?? []).map((line) => ({
        productId: line.ingredient_product_id,
        qty: String(line.quantity),
      })),
    );
    setLoadingRecipeStock(true);
    setRecipeStockLoadFailed(false);
    const latestItems = await reloadDishes();
    setRecipeStockLoadFailed(latestItems == null);
    const latestDish = latestItems?.find((item) => item.id === dish.id);
    if (latestDish) {
      setRecipeEditor(latestDish);
      setRecipeServingUnit(latestDish.product?.recipe_serving_unit || "servings");
      setRecipeDraft(
        (latestDish.product?.recipe ?? []).map((line) => ({
          productId: line.ingredient_product_id,
          qty: String(line.quantity),
        })),
      );
    }
    setLoadingRecipeStock(false);
  }

  async function handleSaveRecipe() {
    if (!recipeEditor || savingRecipe) return;
    if (!recipeServingUnit.trim()) {
      await showError("Enter a serving unit", "Name what one unit of this menu item is called, such as plates or sticks.");
      return;
    }
    if (recipeDraft.some((row) => row.productId && parseRecipeQty(row.qty) == null)) {
      await showError("Check recipe quantities", "Enter a valid amount greater than zero for each selected supply.");
      return;
    }
    setSavingRecipe(true);
    try {
      const saved = await saveRecipe(
        recipeEditor.product_id,
        recipeDraftLines(recipeDraft).map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
        })),
        recipeServingUnit.trim(),
      );
      setDishes((previous) =>
        previous.map((dish) =>
          dish.id === recipeEditor.id && dish.product
            ? {
                ...dish,
                product: {
                  ...dish.product,
                  recipe: saved.lines,
                  recipe_serving_unit: saved.servingUnit,
                },
              }
            : dish,
        ),
      );
      setRecipeEditor(null);
      await toastSuccess(`Recipe saved for "${inventoryProductName(recipeEditor)}"`);
      await refreshCosting();
    } catch (err) {
      await showError("Could not save recipe", extractErrorMessage(err));
    } finally {
      setSavingRecipe(false);
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
    return <p className="rs-empty">Loading current menu…</p>;
  }

  return (
    <>
      <div className="tc-kitchen-section__head">
        <div>
          <h3 className="tc-kitchen-section__title">
            <i className="fa-solid fa-utensils" aria-hidden />
            <span>Current Menu</span>
            <span className="rs-badge" style={{ fontSize: "0.75rem" }}>{dishes.length}</span>
          </h3>
          <p className="tc-kitchen-section__subtitle">
            Set each meal&apos;s recipe in base units per serving. Portion estimates use kitchen stock and the ingredient
            that runs out first; sales deduct recipe ingredients automatically.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.45rem" }}>
          <button
            type="button"
            className="rs-btn rs-btn--small"
            onClick={() => void refreshCosting()}
            disabled={costingLoading}
          >
            <i className="fa-solid fa-rotate" aria-hidden /> Refresh portions
          </button>
          <span className="rs-badge rs-badge--ok" style={{ fontSize: "0.75rem" }}>
            {activeCount} Available
          </span>
          {inactiveCount > 0 && (
            <span className="rs-badge rs-badge--warn" style={{ fontSize: "0.75rem" }}>
              {inactiveCount} Paused
            </span>
          )}
        </div>
      </div>

      <div className="tc-kitchen-toolbar">
        <div className="tc-kitchen-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search menu dishes…"
            aria-label="Search menu dishes"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="tc-kitchen-search__clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <i className="fa-solid fa-xmark" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="tc-kitchen-chips">
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

      {dishes.length === 0 ? (
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
            Create your dishes, meals, and combos in the Menu section to enable or disable them here.
          </p>
          <Link href="/trans-chap/menus" className="tc-kitchen-btn tc-kitchen-btn--primary">
            <i className="fa-solid fa-plus" aria-hidden /> Go to Menus
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <p className="rs-empty">No dishes match &quot;{query}&quot;.</p>
      ) : (
        <div className="rs-table-wrap">
          <table className="rs-table tc-kitchen-table">
            <thead>
              <tr>
                <th>Meal</th>
                <th className="rs-num">Price</th>
                <th className="rs-num">Portions ready</th>
                <th className="rs-num">Menu status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((dish) => (
                <tr key={dish.id} style={{ opacity: dish.is_active ? 1 : 0.65 }}>
                  <td>
                    <div style={{ fontWeight: 750, fontSize: "0.92rem", color: "var(--app-text)" }}>
                      {dish.product?.name ?? "Dish"}
                    </div>
                    <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.2rem" }}>
                      <span className="rs-badge" style={{ fontSize: "0.68rem" }}>
                        {dish.product?.product_type === "combo" ? "Combo" : "Meal"}
                      </span>
                      {dish.product?.category && (
                        <span style={{ fontSize: "0.74rem", color: "var(--app-text-secondary)" }}>
                          {dish.product.category}
                        </span>
                      )}
                    </div>
                    {supportsKitchenRecipe(dish) ? (
                      <button
                        type="button"
                        className="tc-menu__recipe-action"
                        onClick={() => openRecipeEditor(dish)}
                      >
                        <i className="fa-solid fa-list-check" aria-hidden="true" />
                        {costing.get(dish.id)?.has_recipe ? "Edit recipe" : "Set recipe"}
                      </button>
                    ) : (
                      <span className="tc-kitchen-table__recipe-note">
                        {dish.product?.product_type === "combo"
                          ? "Availability comes from included meal recipes"
                          : dish.product?.product_type === "addon"
                            ? "Add-on stock tracked separately"
                            : "Recipe setup not available for this item"}
                      </span>
                    )}
                  </td>
                  <td className="rs-num" style={{ fontWeight: 700, fontSize: "0.92rem" }}>
                    {formatKsh(dish.selling_price ?? 0)}
                  </td>
                  <td className="rs-num">
                    {costingLoading ? (
                      <span className="rs-muted">Loading…</span>
                    ) : costingLoadFailed ? (
                      <span className="rs-badge rs-badge--warn">Unavailable</span>
                    ) : (() => {
                      const meal = costing.get(dish.id);
                      if (!meal?.has_recipe) return <span className="rs-badge rs-badge--warn">Recipe not set</span>;
                      if (meal.portions_available == null) {
                        return <span className="rs-badge rs-badge--warn">Stock not tracked</span>;
                      }
                      return (
                        <>
                          <strong>{meal.portions_available}</strong>{" "}
                          {meal.serving_unit || "servings"}
                          {meal.limiting_ingredient ? (
                            <div className="rs-muted">Limited by {meal.limiting_ingredient}</div>
                          ) : null}
                        </>
                      );
                    })()}
                  </td>
                  <td className="rs-num">
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.65rem", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        role="switch"
                        className={`theme-switch ${dish.is_active ? "is-on" : ""}`}
                        aria-checked={dish.is_active}
                        aria-label={dish.is_active ? `Disable ${dish.product?.name}` : `Enable ${dish.product?.name}`}
                        disabled={togglingId === dish.id}
                        onClick={() => void handleToggle(dish)}
                        style={{ cursor: togglingId === dish.id ? "wait" : "pointer" }}
                      >
                        <span className="theme-switch__thumb" aria-hidden />
                      </button>
                      <span
                        className={`rs-badge ${dish.is_active ? "rs-badge--ok" : "rs-badge--warn"}`}
                        style={{ minWidth: 68, textAlign: "center", justifyContent: "center" }}
                      >
                        {dish.is_active ? "Available" : "Paused"}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recipeEditor ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => !savingRecipe && !loadingRecipeStock && setRecipeEditor(null)}
          role="presentation"
        >
          <div
            className="pos-menu-modal tc-menu__recipe-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-recipe-editor-title"
          >
            <div className="pos-menu-modal__drag-handle" />
            <header className="pos-menu-modal__header">
              <div className="pos-menu-modal__title-row">
                <div>
                  <h2 id="kitchen-recipe-editor-title" className="pos-menu-modal__title">Recipe setup</h2>
                  <p className="pos-menu-modal__label-hint">{inventoryProductName(recipeEditor)}</p>
                </div>
                <button
                  type="button"
                  className="pos-menu-modal__close-btn"
                  onClick={() => setRecipeEditor(null)}
                  disabled={savingRecipe || loadingRecipeStock}
                  aria-label="Close recipe setup"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="pos-menu-modal__body">
              {loadingRecipeStock ? (
                <p className="rs-empty">Refreshing current kitchen quantities…</p>
              ) : recipeStockLoadFailed ? (
                <p className="rs-empty">Current kitchen stock could not be refreshed. Close and reopen recipe setup to try again.</p>
              ) : (
                <RecipeField
                  label="Ingredients per serving"
                  supplies={supplies}
                  selectableSupplyProductIds={kitchenSupplyProductIds}
                  equivalenceUnits={equivalenceUnits}
                  onSaveEquivalenceUnits={updateEquivalenceUnits}
                  rows={recipeDraft}
                  price={recipeEditor.selling_price}
                  servingUnit={recipeServingUnit}
                  onServingUnitChange={setRecipeServingUnit}
                  onChange={setRecipeDraft}
                />
              )}
              <footer className="pos-menu-modal__footer tc-menu__footer tc-menu__recipe-footer">
                <button
                  type="button"
                  className="rs-btn"
                  onClick={() => setRecipeEditor(null)}
                  disabled={savingRecipe || loadingRecipeStock}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    savingRecipe ||
                    loadingRecipeStock ||
                    recipeStockLoadFailed ||
                    !recipeServingUnit.trim() ||
                    recipeDraft.some((row) => row.productId && parseRecipeQty(row.qty) == null)
                  }
                  className="pos-menu-modal__submit-btn"
                  onClick={() => void handleSaveRecipe()}
                >
                  {loadingRecipeStock
                    ? "Refreshing stock…"
                    : recipeStockLoadFailed
                      ? "Stock unavailable"
                      : savingRecipe
                        ? "Saving…"
                        : "Save recipe"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ) : null}
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
              maxLength={500}
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
