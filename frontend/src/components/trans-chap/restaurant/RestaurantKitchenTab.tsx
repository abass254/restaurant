"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { orderHasSuccessfulMpesa, orderUsesPayment } from "@/lib/orders";
import {
  MenuOptionsField,
  TransChapMenuGroupEditor,
  type ModifierSources,
} from "@/components/trans-chap/TransChapMenuGroupEditor";
import {
  clockInKitchenShift,
  clockOutKitchenShift,
  enableKitchenIssuing,
  fetchKitchenShift,
  fetchKitchenEquivalenceUnits,
  fetchKitchenStock,
  fetchSupplyItems,
  formatQty,
  roundQty,
  saveKitchenEquivalenceUnits,
  fetchMenuCosting,
  prepareMenuRecipeBatch,
  type MenuCosting,
  type KitchenIssue,
  type KitchenShiftState,
  type KitchenStock,
  type KitchenItem,
  type SupplyItem,
} from "@/lib/restaurant-supplies";
import {
  createKitchenMeal,
  fetchModifierGroups,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  isSupplyItem,
  saveItemModifierGroups,
  saveRecipe,
  supportsKitchenRecipe,
  updateInventoryActive,
} from "@/lib/trans-chap-product";
import { RestaurantKitchenExtras } from "@/components/trans-chap/restaurant/RestaurantKitchenExtras";
import {
  RecipeField,
  recipeDraftHasMismatchedYield,
  parseRecipeQty,
  recipeDraftHasInvalidPortion,
  recipeDraftLines,
  type RecipeDraft,
} from "@/components/trans-chap/TransChapMenuRecipeField";
import type {
  CatalogProductMutationResponse,
  InventoryItem,
  ModifierGroup,
  Order,
  OrderMutationResponse,
  OrdersListResponse,
} from "@/lib/types";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import { fetchAllPages } from "@/lib/paged-fetch";

function parseQty(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? roundQty(parsed) : null;
}

function recipeDraftFor(dish: InventoryItem): RecipeDraft[] {
  return (dish.product?.recipe ?? []).map((line) => {
    return {
      productId: line.ingredient_product_id,
      portion: String(line.batch_quantity ?? line.quantity),
      yield: String(line.batch_yield ?? 1),
      servingUnit: line.serving_unit || dish.product?.recipe_serving_unit || "servings",
      unit: line.ingredient_unit || line.unit || "",
    };
  });
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
  const [menuDishes, setMenuDishes] = useState<InventoryItem[]>([]);
  const [menuSupplies, setMenuSupplies] = useState<InventoryItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [countUnits, setCountUnits] = useState<Record<string, string>>({});
  const [setup, setSetup] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMenu = useCallback(async (): Promise<InventoryItem[] | null> => {
    try {
      const res = await apiFetch<{ data: InventoryItem[] }>(apiRoutes.inventory);
      const inventory = res.data || [];
      setMenuDishes(inventory.filter((item) => isHotelMenuItem(item)));
      setMenuSupplies(inventory.filter((item) => isSupplyItem(item)));
      return inventory;
    } catch (err) {
      await showError("Could not load current menu", extractErrorMessage(err));
      return null;
    } finally {
      setMenuLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadMenu);
  }, [loadMenu]);

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
      .map((item) => {
        const unit = item.buy_units.find((candidate) => candidate.name === countUnits[item.id]) ?? item.buy_units[0];
        return { inventory_item_id: item.id, quantity: (parseQty(counts[item.id] ?? "") ?? 0) * (unit?.factor || 1) };
      })
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
    <>
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
                        <div className="rs-count-input">
                          <input
                            className="rs-input rs-input--qty"
                            inputMode="decimal"
                            placeholder="0"
                            value={counts[item.id] ?? ""}
                            aria-label={`${item.name} in kitchen`}
                            onChange={(e) => setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                          {item.buy_units.length > 1 ? (
                            <select
                              aria-label={`Unit for ${item.name}`}
                              value={countUnits[item.id] || item.base_unit}
                              onChange={(e) => {
                                const oldUnit = item.buy_units.find((unit) => unit.name === (countUnits[item.id] || item.base_unit)) ?? item.buy_units[0];
                                const nextUnit = item.buy_units.find((unit) => unit.name === e.target.value) ?? item.buy_units[0];
                                const baseAmount = (parseQty(counts[item.id] ?? "") ?? 0) * (oldUnit?.factor || 1);
                                setCountUnits((prev) => ({ ...prev, [item.id]: e.target.value }));
                                setCounts((prev) => ({ ...prev, [item.id]: baseAmount ? String(Math.round((baseAmount / (nextUnit?.factor || 1)) * 1000) / 1000) : prev[item.id] ?? "" }));
                              }}
                            >
                              {item.buy_units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                            </select>
                          ) : <small>{item.base_unit}</small>}
                        </div>
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
      <section className="tc-kitchen-section" aria-label="Menu recipes">
        <CurrentMenuSection
          dishes={menuDishes}
          setDishes={setMenuDishes}
          supplies={menuSupplies}
          reloadDishes={loadMenu}
          loading={menuLoading}
          enableKitchenMeasures={false}
        />
      </section>
    </>
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
  const [activeView, setActiveView] = useState<"menu" | "orders" | "measures">("menu");
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [measureQuery, setMeasureQuery] = useState("");
  const [measureUnitFilter, setMeasureUnitFilter] = useState("all");
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);

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

  const loadOrders = useCallback(async () => {
    try {
      const statuses = ["placed", "awaiting_payment", "payment_received", "being_prepared", "ready"];
      const results = await Promise.all(
        statuses.map((status) =>
          fetchAllPages<OrdersListResponse["data"][number]>(
            (page) => `${apiRoutes.orders}?status=${status}&per_page=100&page=${page}`,
            20,
          ),
        ),
      );
      const unique = new Map<string, Order>();
      for (const result of results) {
        if (result.failed) throw new Error("One or more kitchen order pages could not be loaded.");
        for (const order of result.rows) unique.set(order.id, order);
      }
      setOrders(
        [...unique.values()].sort((a, b) => {
          const aTime = Date.parse(a.placed_at || a.created_at || "") || 0;
          const bTime = Date.parse(b.placed_at || b.created_at || "") || 0;
          return bTime - aTime;
        }),
      );
      setOrdersError(null);
    } catch (err) {
      setOrdersError(extractErrorMessage(err));
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const refreshKitchenSupplies = useCallback(async () => {
    try {
      const next = await fetchKitchenStock();
      onStock(next);
    } catch {
      // ignore silent refresh errors
    }
  }, [onStock]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadOrders();
      void refreshKitchenSupplies();
    }, 0);
    const timer = window.setInterval(() => {
      void loadOrders();
      void refreshKitchenSupplies();
    }, 10_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadOrders, refreshKitchenSupplies]);

  async function startPreparing(order: Order) {
    if (!canStartPreparing(order) || startingOrderId) return;
    setStartingOrderId(order.id);
    try {
      const response = await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
        method: "POST",
        body: JSON.stringify({ to_status: "being_prepared" }),
      });
      setOrders((previous) =>
        previous.map((row) => row.id === response.data.id ? response.data : row),
      );
      await toastSuccess(`Started preparing order #${order.order_number}`);
      await Promise.all([loadOrders(), refreshKitchenSupplies()]);
    } catch (err) {
      await showError("Could not start preparing this order", extractErrorMessage(err));
      await Promise.all([loadOrders(), refreshKitchenSupplies()]);
    } finally {
      setStartingOrderId(null);
    }
  }

  async function markReady(order: Order) {
    if (startingOrderId) return;
    setStartingOrderId(order.id);
    try {
      const response = await apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
        method: "POST",
        body: JSON.stringify({ to_status: "ready" }),
      });
      setOrders((previous) =>
        previous.map((row) => (row.id === response.data.id ? response.data : row)),
      );
      await toastSuccess(`Order #${order.order_number} marked ready for serving`);
      await Promise.all([loadOrders(), refreshKitchenSupplies()]);
    } catch (err) {
      await showError("Could not mark order ready", extractErrorMessage(err));
      await Promise.all([loadOrders(), refreshKitchenSupplies()]);
    } finally {
      setStartingOrderId(null);
    }
  }

  async function confirmHandoff(order: Order) {
    if (startingOrderId) return;
    setStartingOrderId(order.id);
    try {
      const response = await apiFetch<OrderMutationResponse>(apiRoutes.orderConfirmHandoff(order.id), {
        method: "POST",
        body: "{}",
      });
      setOrders((previous) =>
        previous.map((row) => (row.id === response.data.id ? response.data : row)),
      );
      await toastSuccess(`Order #${order.order_number} served to table`);
      await Promise.all([loadOrders(), refreshKitchenSupplies()]);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      if (msg.toLowerCase().includes("already closed")) {
        await toastSuccess(`Order #${order.order_number} served to table`);
        await Promise.all([loadOrders(), refreshKitchenSupplies()]);
        return;
      }
      await showError("Could not confirm handover", msg);
      await Promise.all([loadOrders(), refreshKitchenSupplies()]);
    } finally {
      setStartingOrderId(null);
    }
  }

  function canStartPreparing(order: Order): boolean {
    if (!order.allowed_next_statuses?.includes("being_prepared")) return false;
    if (order.status === "payment_received") return true;
    if (order.status !== "placed") return false;
    return !orderUsesPayment(order, "mpesa") || orderHasSuccessfulMpesa(order);
  }

  // Only items issued/sent to the kitchen from inventory (kitchen_quantity > 0)
  const kitchenSupplies = useMemo(
    () => stock.items.filter((item) => (item.kitchen_quantity ?? 0) > 0),
    [stock.items],
  );
  const needle = inventoryQuery.trim().toLowerCase();
  const visibleSupplies = kitchenSupplies.filter(
    (item) => !needle || item.name.toLowerCase().includes(needle),
  );
  const supplyProductById = useMemo(
    () => new Map(supplies.map((item) => [item.id, item.product_id])),
    [supplies],
  );
  const portionsLeftByProduct = useMemo(() => {
    const byProduct = new Map<string, Map<string, number>>();
    for (const dish of dishes) {
      for (const line of dish.product?.recipe ?? []) {
        if (!line.ingredient_product_id || !(line.quantity > 0)) continue;
        const unit = (line.serving_unit || "portions").trim() || "portions";
        const units = byProduct.get(line.ingredient_product_id) ?? new Map<string, number>();
        const previous = units.get(unit);
        units.set(unit, previous == null ? line.quantity : Math.max(previous, line.quantity));
        byProduct.set(line.ingredient_product_id, units);
      }
    }
    return byProduct;
  }, [dishes]);
  const recipeMeasures = useMemo(
    () =>
      dishes.flatMap((dish) => {
        if (!supportsKitchenRecipe(dish) || !dish.product?.recipe?.length) return [];
        const byServingUnit = new Map<string, typeof dish.product.recipe>();
        for (const line of dish.product.recipe) {
          const servingUnit = (line.serving_unit || dish.product.recipe_serving_unit || "servings").trim();
          const lines = byServingUnit.get(servingUnit) ?? [];
          lines.push(line);
          byServingUnit.set(servingUnit, lines);
        }
        return [...byServingUnit.entries()].map(([servingUnit, lines]) => {
          const batchYield = lines[0]?.batch_yield ?? 1;
          return {
            id: `${dish.id}:${servingUnit}`,
            dishId: dish.id,
            dishName: inventoryProductName(dish),
            dishPrice: dish.selling_price,
            servingUnit,
            yield: batchYield,
            ingredients: lines.map((line) => {
              const batchQty = line.batch_quantity ?? line.quantity;
              const perPortion = batchYield > 0 ? batchQty / batchYield : batchQty;
              return {
                name: line.name || "Supply",
                quantity: batchQty,
                perPortion,
                unit: line.unit || "",
              };
            }),
          };
        });
      }),
    [dishes],
  );

  const availableUnits = useMemo(() => {
    const units = new Set<string>();
    for (const m of recipeMeasures) {
      if (m.servingUnit) units.add(m.servingUnit);
    }
    return Array.from(units);
  }, [recipeMeasures]);

  const visibleRecipeMeasures = recipeMeasures.filter((measure) => {
    if (measureUnitFilter !== "all" && measure.servingUnit !== measureUnitFilter) {
      return false;
    }
    const query = measureQuery.trim().toLowerCase();
    return (
      !query ||
      measure.dishName.toLowerCase().includes(query) ||
      measure.servingUnit.toLowerCase().includes(query) ||
      measure.ingredients.some((line) => line.name.toLowerCase().includes(query))
    );
  });

  function portionsRemaining(item: KitchenItem): string | null {
    const productId = supplyProductById.get(item.inventory_item_id);
    const units = productId ? portionsLeftByProduct.get(productId) : undefined;
    if (!units?.size || item.kitchen_quantity <= 0) return null;
    return [...units.entries()]
      .map(([unit, perPortion]) => `${Math.floor(item.kitchen_quantity / perPortion)} ${unit}`)
      .join(" · ");
  }

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
      <details className="tc-kitchen-shift-tools">
        <summary>
          <span><i className="fa-solid fa-clock" aria-hidden /> Shift tools</span>
          <span className="rs-badge rs-badge--ok">On duty</span>
        </summary>
        <KitchenShiftPanel shift={shift} onShift={(next) => void refreshShift(next)} />
      </details>

      <section className="tc-kitchen-section" aria-label="Released kitchen supplies">
          <div className="tc-kitchen-section__head">
            <div>
              <h3 className="tc-kitchen-section__title">
                <i className="fa-solid fa-boxes-stacked" aria-hidden />
                <span>Released to kitchen</span>
                <span className="rs-badge" style={{ fontSize: "0.75rem" }}>{kitchenSupplies.length}</span>
              </h3>
              <p className="tc-kitchen-section__subtitle">
                Remaining supplies and the portions each can support.
              </p>
            </div>
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
            <div className="tc-kitchen-empty">
              <i className="fa-solid fa-kitchen-set" aria-hidden />
              <h4>No items from inventory in the kitchen yet</h4>
              <p>Order supplies from your inventory store to bring ingredients to the kitchen for meal preparation.</p>
              <Link href="/trans-chap/purchases/issue?new=1&from=kitchen" className="tc-kitchen-btn tc-kitchen-btn--primary">
                <i className="fa-solid fa-cart-flatbed" aria-hidden /> Order items from the inventory
              </Link>
            </div>
          ) : visibleSupplies.length === 0 ? (
            <p className="rs-empty">No items match &quot;{inventoryQuery}&quot;.</p>
          ) : (
            <ul className="tc-kitchen-supply-grid">
              {visibleSupplies.map((item) => {
                const portions = portionsRemaining(item);
                const qtyVal = Number(item.kitchen_quantity) || 0;
                const isLow = qtyVal <= 2;
                return (
                  <li key={item.inventory_item_id} className="tc-kitchen-supply-card">
                    <Link
                      href={`/trans-chap/purchases/item?id=${encodeURIComponent(item.inventory_item_id)}`}
                      className="tc-kitchen-supply-card__link"
                    >
                      <div className="tc-kitchen-supply-card__head">
                        <div className="tc-kitchen-supply-card__icon">
                          <i className="fa-solid fa-boxes-stacked" aria-hidden />
                        </div>
                        <div className="tc-kitchen-supply-card__info">
                          <strong className="tc-kitchen-supply-card__title" title={item.name}>
                            {item.name}
                          </strong>
                          <span className={`tc-kitchen-supply-card__badge ${isLow ? "is-low" : "is-ok"}`}>
                            {isLow ? "Low stock" : "In kitchen"}
                          </span>
                        </div>
                      </div>

                      <div className="tc-kitchen-supply-card__metrics">
                        <div className="tc-kitchen-supply-card__qty-row">
                          <span className="tc-kitchen-supply-card__qty">{formatQty(item.kitchen_quantity)}</span>
                          <span className="tc-kitchen-supply-card__unit">{item.unit} left</span>
                        </div>
                        {portions ? (
                          <div className="tc-kitchen-supply-card__portions" title={`${portions} possible with available stock`}>
                            <i className="fa-solid fa-utensils" aria-hidden />
                            <span>{portions} possible</span>
                          </div>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      <div className="tc-kitchen-tabs" role="tablist" aria-label="Kitchen workspace">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "menu"}
          className={`tc-kitchen-tab-btn ${activeView === "menu" ? "is-active" : ""}`}
          onClick={() => setActiveView("menu")}
        >
          <i className="fa-solid fa-utensils" aria-hidden />
          <span>Menu</span>
          <span className="tc-kitchen-tab-pill">{dishes.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "orders"}
          className={`tc-kitchen-tab-btn ${activeView === "orders" ? "is-active" : ""}`}
          onClick={() => setActiveView("orders")}
        >
          <i className="fa-solid fa-bell" aria-hidden />
          <span>Orders</span>
          <span className={`tc-kitchen-tab-pill${orders.some((order) => order.status === "placed" || order.status === "awaiting_payment" || order.status === "payment_received") ? " is-pulsing" : ""}`}>
            {orders.length}
          </span>
          {orders.some((order) => order.status === "placed" || order.status === "awaiting_payment" || order.status === "payment_received") ? (
            <span className="tc-kitchen-new-dot" aria-hidden />
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "measures"}
          className={`tc-kitchen-tab-btn ${activeView === "measures" ? "is-active" : ""}`}
          onClick={() => setActiveView("measures")}
        >
          <i className="fa-solid fa-ruler-combined" aria-hidden />
          <span>Measures</span>
          <span className="tc-kitchen-tab-pill">{recipeMeasures.length}</span>
        </button>
      </div>

      {/* 5. Section 2: Current Menu */}
      {activeView === "menu" && (
        <section className="tc-kitchen-section" aria-label="Current Menu">
          <CurrentMenuSection
            dishes={dishes}
            setDishes={setDishes}
            supplies={supplies}
            reloadDishes={loadDishes}
            reloadKitchen={async () => {
              onStock(await fetchKitchenStock());
            }}
            loading={dishesLoading}
          />
        </section>
      )}

      {activeView === "menu" && !dishesLoading && (
        <section className="tc-kitchen-section" aria-label="Extras">
          <RestaurantKitchenExtras
            dishes={dishes}
            supplies={supplies}
            onDishesChange={setDishes}
          />
        </section>
      )}

      {activeView === "orders" && (
        <KitchenOrderQueue
          orders={orders}
          loading={ordersLoading}
          error={ordersError}
          startingOrderId={startingOrderId}
          onRefresh={() => {
            void loadOrders();
            void refreshKitchenSupplies();
          }}
          onStartPreparing={(order) => void startPreparing(order)}
          onMarkReady={(order) => void markReady(order)}
          onConfirmHandoff={(order) => void confirmHandoff(order)}
          canStartPreparing={canStartPreparing}
        />
      )}

      {activeView === "measures" && (
        <section className="tc-kitchen-section" aria-label="Recipe measures and batch sizes">
          <div className="tc-kitchen-section__head">
            <div>
              <h3 className="tc-kitchen-section__title">
                <i className="fa-solid fa-ruler-combined" aria-hidden />
                <span>Measures &amp; batch sizes</span>
                <span className="rs-badge" style={{ fontSize: "0.75rem" }}>{recipeMeasures.length}</span>
              </h3>
              <p className="tc-kitchen-section__subtitle">
                Each row shows the supply amount used and how many plates, sticks, or other portions that batch makes.
              </p>
            </div>
          </div>
          <div className="tc-kitchen-measure-toolbar">
            <div className="tc-kitchen-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden />
              <input
                type="search"
                value={measureQuery}
                placeholder="Search meals, supplies, or portion units…"
                aria-label="Search recipe measures"
                onChange={(event) => setMeasureQuery(event.target.value)}
              />
              {measureQuery ? (
                <button
                  type="button"
                  className="tc-kitchen-search__clear"
                  onClick={() => setMeasureQuery("")}
                  aria-label="Clear search"
                >
                  <i className="fa-solid fa-xmark" aria-hidden />
                </button>
              ) : null}
            </div>
            {availableUnits.length > 1 ? (
              <div className="tc-kitchen-measure-chips">
                <button
                  type="button"
                  className={`tc-kitchen-measure-chip${measureUnitFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setMeasureUnitFilter("all")}
                >
                  All ({recipeMeasures.length})
                </button>
                {availableUnits.map((u) => {
                  const count = recipeMeasures.filter((m) => m.servingUnit === u).length;
                  return (
                    <button
                      key={u}
                      type="button"
                      className={`tc-kitchen-measure-chip${measureUnitFilter === u ? " is-active" : ""}`}
                      onClick={() => setMeasureUnitFilter(u)}
                    >
                      {u} ({count})
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {dishesLoading ? (
            <p className="rs-empty">Loading recipe measures…</p>
          ) : !visibleRecipeMeasures.length ? (
            <div className="tc-kitchen-empty">
              <i className="fa-solid fa-ruler-combined" aria-hidden />
              <h4>{recipeMeasures.length ? "No measures match this search" : "No recipe measures defined yet"}</h4>
              <p>
                {recipeMeasures.length
                  ? "Try another meal, supply, or portion unit."
                  : "Set up a meal recipe in Kitchen to see its supply sizes and portion yield here."}
              </p>
              {measureQuery || measureUnitFilter !== "all" ? (
                <button
                  type="button"
                  className="rs-btn rs-btn--secondary"
                  onClick={() => {
                    setMeasureQuery("");
                    setMeasureUnitFilter("all");
                  }}
                  style={{ marginTop: "0.5rem" }}
                >
                  Clear search &amp; filters
                </button>
              ) : null}
            </div>
          ) : (
            <div className="tc-kitchen-measure-grid">
              {visibleRecipeMeasures.map((measure) => (
                <div key={measure.id} className="tc-kitchen-measure-card">
                  <div className="tc-kitchen-measure-card__head">
                    <div className="tc-kitchen-measure-card__title-box">
                      <span className="tc-kitchen-measure-card__icon" aria-hidden>
                        <i className="fa-solid fa-bowl-food" />
                      </span>
                      <div>
                        <h4 className="tc-kitchen-measure-card__title">{measure.dishName}</h4>
                        <span className="tc-kitchen-measure-card__count">
                          {measure.ingredients.length} {measure.ingredients.length === 1 ? "supply item" : "supply items"}
                        </span>
                      </div>
                    </div>
                    <div className="tc-kitchen-measure-card__badge">
                      <i className="fa-solid fa-layer-group" aria-hidden />
                      <span>
                        <strong>{formatQty(measure.yield)}</strong> {measure.servingUnit} / batch
                      </span>
                    </div>
                  </div>

                  <div className="tc-kitchen-measure-card__body">
                    <div className="tc-kitchen-measure-card__table-header">
                      <span>Supply Ingredient</span>
                      <div className="tc-kitchen-measure-card__col-amounts">
                        <span>Batch Total</span>
                        <span>Per {measure.servingUnit}</span>
                      </div>
                    </div>
                    <ul className="tc-kitchen-measure-card__ingredients">
                      {measure.ingredients.map((ingredient, index) => (
                        <li key={`${measure.id}:${ingredient.name}:${index}`} className="tc-kitchen-measure-card__row">
                          <div className="tc-kitchen-measure-card__supply-name">
                            <span className="tc-kitchen-measure-card__dot" aria-hidden />
                            <span>{ingredient.name}</span>
                          </div>
                          <div className="tc-kitchen-measure-card__amounts">
                            <span className="tc-kitchen-measure-card__batch-val">
                              {formatQty(ingredient.quantity, ingredient.unit)}
                            </span>
                            <span className="tc-kitchen-measure-card__portion-val">
                              {formatQty(ingredient.perPortion, ingredient.unit)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="tc-kitchen-measure-card__foot">
                    <span className="tc-kitchen-measure-card__ratio">
                      <i className="fa-solid fa-scale-balanced" aria-hidden />
                      <span>
                        1 batch makes <strong>{formatQty(measure.yield)} {measure.servingUnit}</strong>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="tc-kitchen-measure-card__action"
                      onClick={() => setActiveView("menu")}
                      title="View or modify recipe in Menu tab"
                    >
                      <span>Menu recipe</span>
                      <i className="fa-solid fa-chevron-right" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function KitchenOrderQueue({
  orders,
  loading,
  error,
  startingOrderId,
  onRefresh,
  onStartPreparing,
  onMarkReady,
  onConfirmHandoff,
  canStartPreparing,
}: {
  orders: Order[];
  loading: boolean;
  error: string | null;
  startingOrderId: string | null;
  onRefresh: () => void;
  onStartPreparing: (order: Order) => void;
  onMarkReady: (order: Order) => void;
  onConfirmHandoff: (order: Order) => void;
  canStartPreparing: (order: Order) => boolean;
}) {
  const newOrders = orders.filter(
    (order) =>
      order.status === "placed" ||
      order.status === "awaiting_payment" ||
      order.status === "payment_received",
  ).length;

  return (
    <section className="tc-kitchen-section tc-kitchen-orders" aria-label="Kitchen order queue">
      <div className="tc-kitchen-section__head">
        <div>
          <h3 className="tc-kitchen-section__title">
            <i className="fa-solid fa-bell" aria-hidden />
            <span>Kitchen orders</span>
            {newOrders > 0 ? <span className="tc-kitchen-orders__new">{newOrders} new</span> : null}
          </h3>
          <p className="tc-kitchen-section__subtitle">
            New orders appear here automatically. Start preparing, mark ready when cooked, and serve to tables.
          </p>
        </div>
        <button type="button" className="rs-btn rs-btn--small" onClick={onRefresh} disabled={loading}>
          <i className="fa-solid fa-rotate" aria-hidden /> Refresh
        </button>
      </div>

      {error ? (
        <p className="tc-kitchen-orders__error" role="alert">
          Could not refresh kitchen orders: {error}
        </p>
      ) : null}

      {loading ? (
        <p className="rs-empty">Loading kitchen orders…</p>
      ) : orders.length === 0 ? (
        <div className="tc-kitchen-empty">
          <i className="fa-solid fa-bell-slash" aria-hidden />
          <h4>No active orders</h4>
          <p>New orders will show here while the kitchen is open.</p>
        </div>
      ) : (
        <ul className="tc-kitchen-order-list">
          {orders.map((order) => {
            const isNew =
              order.status === "placed" ||
              order.status === "awaiting_payment" ||
              order.status === "payment_received";
            const canStart = canStartPreparing(order);
            const tableLabel = order.table_number
              ? order.table_number.trim().toLowerCase().startsWith("table")
                ? order.table_number.trim()
                : `Table ${order.table_number.trim()}`
              : null;
            return (
              <li
                key={order.id}
                className={`tc-kitchen-order${isNew ? " is-new" : ""}`}
              >
                <div className="tc-kitchen-order__header">
                  <div>
                    <strong>Order {order.order_number}</strong>
                    {tableLabel ? <span>{tableLabel}</span> : null}
                    {order.customer_name ? <span>{order.customer_name}</span> : null}
                  </div>
                  <span
                    className={`rs-badge ${order.status === "ready" ? "rs-badge--ok" : order.status === "being_prepared" ? "rs-badge--ok" : "rs-badge--warn"}`}
                    style={order.status === "ready" ? { background: "rgba(34, 197, 94, 0.15)", color: "#15803d" } : undefined}
                  >
                    {order.status === "ready"
                      ? "Ready to serve"
                      : order.status === "being_prepared"
                        ? "Preparing"
                        : order.status === "payment_received"
                          ? "New · paid"
                          : order.status === "awaiting_payment"
                            ? "Awaiting payment"
                            : orderUsesPayment(order, "mpesa") && !orderHasSuccessfulMpesa(order)
                              ? "New · payment needed"
                              : "New order"}
                  </span>
                </div>
                <ul className="tc-kitchen-order__items">
                  {(order.items ?? []).map((item) => (
                    <li key={item.id}>
                      <strong className={isNew ? "tc-kitchen-order__item-new" : ""}>
                        {item.quantity} × {item.product_name}
                        {item.serving_unit ? ` · ${item.serving_unit}` : ""}
                      </strong>
                      {item.modifiers?.length ? (
                        <small>{item.modifiers.map((modifier) => modifier.name).join(", ")}</small>
                      ) : null}
                      {item.notes ? <small>Note: {item.notes}</small> : null}
                    </li>
                  ))}
                </ul>
                <div className="tc-kitchen-order__footer">
                  <span>
                    {order.placed_at
                      ? `Placed ${new Date(order.placed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </span>
                  {canStart ? (
                    <button
                      type="button"
                      className="rs-btn rs-btn--primary"
                      disabled={startingOrderId != null}
                      onClick={() => onStartPreparing(order)}
                    >
                      {startingOrderId === order.id ? "Starting…" : "Start preparing"}
                    </button>
                  ) : order.status === "being_prepared" ? (
                    <button
                      type="button"
                      className="rs-btn rs-btn--primary"
                      style={{ background: "#2563eb", color: "#fff", border: "none" }}
                      disabled={startingOrderId != null}
                      onClick={() => onMarkReady(order)}
                    >
                      {startingOrderId === order.id ? "Updating…" : "Mark ready"}
                    </button>
                  ) : order.status === "ready" ? (
                    <button
                      type="button"
                      className="rs-btn rs-btn--success"
                      style={{ background: "#16a34a", color: "#fff", border: "none" }}
                      disabled={startingOrderId != null}
                      onClick={() => onConfirmHandoff(order)}
                    >
                      {startingOrderId === order.id ? "Updating…" : "Serve to table"}
                    </button>
                  ) : (
                    <span className="tc-kitchen-order__progress">Waiting for payment confirmation</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  const [countUnits, setCountUnits] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [ordersCleared, setOrdersCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const session = shift.session;
  const countUnitFor = (item: KitchenItem) =>
    item.units.find((unit) => unit.name === countUnits[item.inventory_item_id]) ?? item.units[0] ?? { name: item.unit, factor: 1 };
  const countBase = (item: KitchenItem, value: string) => {
    const qty = parseQty(value);
    return qty == null ? null : roundQty(qty * (countUnitFor(item).factor || 1));
  };

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
      quantity: countBase(item, counts[item.inventory_item_id] ?? ""),
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
      setCountUnits({});
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
                            <div className="rs-count-input">
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
                              {item.units.length > 1 ? (
                                <select
                                  aria-label={`Count unit for ${item.name}`}
                                  value={countUnitFor(item).name}
                                  onChange={(event) => {
                                    const oldFactor = countUnitFor(item).factor || 1;
                                    const nextFactor = item.units.find((unit) => unit.name === event.target.value)?.factor || 1;
                                    const baseAmount = (parseQty(counts[item.inventory_item_id] ?? "") ?? 0) * oldFactor;
                                    setCountUnits((previous) => ({ ...previous, [item.inventory_item_id]: event.target.value }));
                                    setCounts((previous) => ({ ...previous, [item.inventory_item_id]: baseAmount ? String(roundQty(baseAmount / nextFactor)) : previous[item.inventory_item_id] ?? "" }));
                                  }}
                                >
                                  {item.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                                </select>
                              ) : <small>{item.unit}</small>}
                            </div>
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
  reloadDishes,
  reloadKitchen,
  loading,
  enableKitchenMeasures = true,
}: {
  dishes: InventoryItem[];
  setDishes: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  supplies: InventoryItem[];
  reloadDishes: () => Promise<InventoryItem[] | null>;
  reloadKitchen?: () => Promise<void>;
  loading: boolean;
  enableKitchenMeasures?: boolean;
}) {
  const user = useAuthUser();
  const accountId = (user.active_account ?? user.account)?.id ?? null;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [selectedServingUnitByDish, setSelectedServingUnitByDish] = useState<Record<string, string>>({});
  const [batchCountByDish, setBatchCountByDish] = useState<Record<string, string>>({});
  const [recipeEditor, setRecipeEditor] = useState<InventoryItem | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft[]>([]);
  const [recipeMealName, setRecipeMealName] = useState("");
  const [recipeServingUnit, setRecipeServingUnit] = useState("servings");
  const [loadingRecipeStock, setLoadingRecipeStock] = useState(false);
  const [recipeStockLoadFailed, setRecipeStockLoadFailed] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [costing, setCosting] = useState<Map<string, MenuCosting>>(new Map());
  const [equivalenceUnits, setEquivalenceUnits] = useState<string[]>([]);
  const [costingLoading, setCostingLoading] = useState(true);
  const [costingLoadFailed, setCostingLoadFailed] = useState(false);
  const [showNewMeal, setShowNewMeal] = useState(false);
  const [newMealName, setNewMealName] = useState("");
  const [creatingMeal, setCreatingMeal] = useState(false);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>([]);
  const [groupEditor, setGroupEditor] = useState<{ group: ModifierGroup | null; attach: boolean } | null>(null);

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
    if (!enableKitchenMeasures) return;
    fetchKitchenEquivalenceUnits()
      .then(setEquivalenceUnits)
      .catch((err) => void showError("Could not load portion names", extractErrorMessage(err)));
  }, [enableKitchenMeasures]);

  useEffect(() => {
    fetchModifierGroups()
      .then(setModifierGroups)
      .catch((err) => void showError("Could not load meal modifiers", extractErrorMessage(err)));
  }, []);

  const regularModifierGroups = useMemo(
    () => modifierGroups.filter((group) => !group.is_extra),
    [modifierGroups],
  );
  const modifierSources = useMemo<ModifierSources>(
    () => ({
      storeItems: supplies
        .filter((item) => isSaleableRole(inventoryRole(item)) && !isHotelMenuItem(item))
        .map((item) => ({ id: item.product_id, name: inventoryProductName(item) })),
      menuItems: dishes
        .filter((item) => item.product?.product_type !== "addon")
        .map((item) => ({ id: item.product_id, name: inventoryProductName(item) })),
      extras: modifierGroups
        .filter((group) => group.is_extra)
        .flatMap((group) => group.options.map((option) => ({ id: option.id, name: option.name }))),
    }),
    [dishes, modifierGroups, supplies],
  );

  async function updateEquivalenceUnits(units: string[]) {
    try {
      setEquivalenceUnits(await saveKitchenEquivalenceUnits(units));
    } catch (err) {
      await showError("Could not save portion names", extractErrorMessage(err));
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

  async function handlePrepareBatch(dish: InventoryItem) {
    const meal = costing.get(dish.id);
    const requestedServingUnit = selectedServingUnitByDish[dish.id];
    const servingUnit =
      meal?.equivalences?.some((entry) => entry.serving_unit === requestedServingUnit)
        ? requestedServingUnit
        : meal?.serving_unit || "servings";
    const equivalence = meal?.equivalences?.find((entry) => entry.serving_unit === servingUnit);
    const batchCount = Number(batchCountByDish[dish.id] || "1");
    if (
      !meal ||
      equivalence?.prepared_quantity == null ||
      !Number.isInteger(batchCount) ||
      batchCount < 1 ||
      equivalence.batches_producible == null ||
      batchCount > equivalence.batches_producible ||
      preparingId
    ) return;
    setPreparingId(dish.id);
    try {
      const result = await prepareMenuRecipeBatch(dish.id, servingUnit, batchCount);
      const portionCount = Number.isInteger(result.portions_added)
        ? String(result.portions_added)
        : result.portions_added.toFixed(3).replace(/\.?0+$/, "");
      await toastSuccess(
        `Prepared ${portionCount} ${servingUnit} of ${dish.product?.name ?? "this meal"}`,
      );
      await reloadDishes();
      await refreshCosting();
      if (reloadKitchen) {
        try {
          await reloadKitchen();
        } catch (err) {
          await showError("Batch prepared, but kitchen stock did not refresh", extractErrorMessage(err));
        }
      }
    } catch (err) {
      await showError("Could not prepare recipe batch", extractErrorMessage(err));
    } finally {
      setPreparingId(null);
    }
  }

  async function openRecipeEditor(dish: InventoryItem) {
    setRecipeEditor(dish);
    setRecipeMealName(inventoryProductName(dish));
    const initialUnit =
      dish.product?.recipe_serving_unit ||
      dish.product?.serving_options?.[0] ||
      dish.product?.recipe?.[0]?.serving_unit ||
      "servings";
    setRecipeServingUnit(initialUnit);
    setRecipeDraft(recipeDraftFor(dish));
    setSelectedModifierGroupIds((dish.product?.modifier_groups ?? []).map((group) => group.id));
    setLoadingRecipeStock(true);
    setRecipeStockLoadFailed(false);
    const latestItems = await reloadDishes();
    setRecipeStockLoadFailed(latestItems == null);
    const latestDish = latestItems?.find((item) => item.id === dish.id);
    if (latestItems && latestDish) {
      setRecipeEditor(latestDish);
      setRecipeMealName(inventoryProductName(latestDish));
      const latestUnit =
        latestDish.product?.recipe_serving_unit ||
        latestDish.product?.serving_options?.[0] ||
        latestDish.product?.recipe?.[0]?.serving_unit ||
        "servings";
      setRecipeServingUnit(latestUnit);
      setRecipeDraft(recipeDraftFor(latestDish));
      setSelectedModifierGroupIds((latestDish.product?.modifier_groups ?? []).map((group) => group.id));
    }
    setLoadingRecipeStock(false);
  }

  async function createMeal() {
    const name = newMealName.trim();
    if (!name || creatingMeal) return;
    if (dishes.some((dish) => inventoryProductName(dish).toLowerCase() === name.toLowerCase())) {
      await showError("Meal already exists", `“${name}” is already in your Kitchen menu.`);
      return;
    }
    setCreatingMeal(true);
    try {
      const created = await createKitchenMeal(name);
      setDishes((previous) => [created, ...previous]);
      setNewMealName("");
      setShowNewMeal(false);
      await toastSuccess(`“${name}” created in Kitchen. Add its recipe before pricing it in Menu.`);
      await openRecipeEditor(created);
    } catch (err) {
      await showError("Could not create meal", extractErrorMessage(err));
    } finally {
      setCreatingMeal(false);
    }
  }

  async function handleSaveRecipe() {
    if (!recipeEditor || savingRecipe) return;
    const nextMealName = recipeMealName.trim();
    if (!nextMealName) {
      await showError("Enter a meal name", "A Kitchen meal needs a name.");
      return;
    }
    const duplicate = dishes.find(
      (dish) =>
        dish.id !== recipeEditor.id &&
        inventoryProductName(dish).toLowerCase() === nextMealName.toLowerCase(),
    );
    if (duplicate) {
      await showError("Meal already exists", `“${nextMealName}” is already in your Kitchen menu.`);
      return;
    }
    if (!recipeServingUnit.trim()) {
      await showError("Enter a serving unit", "Name what one unit of this menu item is called, such as plates or sticks.");
      return;
    }
    if (recipeDraft.some((row) => row.productId && parseRecipeQty(row.yield) == null)) {
      await showError("Check recipe yield", "Enter how many menu portions the selected supply amount will make.");
      return;
    }
    if (recipeDraftHasMismatchedYield(recipeDraft)) {
      await showError("Check recipe yields", "Use the same menu portion count for every supply that makes the same portion.");
      return;
    }
    if (recipeDraftHasInvalidPortion(recipeDraft)) {
      await showError("Enter recipe batch amounts", "Enter the supply amount used for each recipe batch.");
      return;
    }
    setSavingRecipe(true);
    const savedParts: string[] = [];
    try {
      let updatedProduct = recipeEditor.product;
      if (
        updatedProduct &&
        updatedProduct.name !== nextMealName &&
        updatedProduct.created_by_account_id === accountId
      ) {
        const response = await apiFetch<CatalogProductMutationResponse>(
          apiRoutes.product(recipeEditor.product_id),
          {
            method: "PATCH",
            body: JSON.stringify({ name: nextMealName }),
          },
        );
        updatedProduct = response.data;
        savedParts.push("Meal name");
      }
      const saved = await saveRecipe(
        recipeEditor.product_id,
        recipeDraftLines(recipeDraft, supplies).map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          batch_quantity: line.batchQuantity,
          batch_yield: line.batchYield,
          serving_unit: line.servingUnit?.trim() || null,
          ingredient_unit: line.ingredientUnit?.trim() || null,
        })),
        recipeServingUnit.trim(),
      );
      savedParts.push("Recipe");
      const previousGroups = recipeEditor.product?.modifier_groups ?? [];
      const previousIds = previousGroups.map((group) => group.id);
      const groupsChanged =
        previousIds.length !== selectedModifierGroupIds.length ||
        previousIds.some((id, index) => id !== selectedModifierGroupIds[index]);
      const attachedGroups = groupsChanged
        ? await saveItemModifierGroups(recipeEditor.product_id, selectedModifierGroupIds)
        : previousGroups;
      if (groupsChanged) savedParts.push("Modifiers");
      setDishes((previous) =>
        previous.map((dish) =>
          dish.id === recipeEditor.id && dish.product
            ? {
                ...dish,
                product: {
                  ...dish.product,
                  ...updatedProduct,
                  name: nextMealName,
                  recipe: saved.lines,
                  recipe_serving_unit: saved.servingUnit,
                  modifier_groups: attachedGroups,
                },
              }
            : dish,
        ),
      );
      setRecipeEditor(null);
      await toastSuccess(`Kitchen meal "${nextMealName}" saved`);
      await refreshCosting();
    } catch (err) {
      if (savedParts.length) {
        await reloadDishes();
        await refreshCosting();
        await showError(
          "Some meal changes were saved",
          `${savedParts.join(", ")} saved. Other changes could not be saved: ${extractErrorMessage(err)}`,
        );
      } else {
        await showError("Could not save Kitchen meal", extractErrorMessage(err));
      }
    } finally {
      setSavingRecipe(false);
    }
  }

  function handleGroupSaved(saved: ModifierGroup) {
    const attach = groupEditor?.attach && !groupEditor.group;
    setModifierGroups((previous) =>
      previous.some((group) => group.id === saved.id)
        ? previous.map((group) => (group.id === saved.id ? { ...saved, item_count: group.item_count } : group))
        : [...previous, saved],
    );
    if (attach) {
      setSelectedModifierGroupIds((previous) =>
        previous.includes(saved.id) ? previous : [...previous, saved.id],
      );
    }
    setGroupEditor(null);
  }

  function handleGroupDeleted(groupId: string) {
    setModifierGroups((previous) => previous.filter((group) => group.id !== groupId));
    setSelectedModifierGroupIds((previous) => previous.filter((id) => id !== groupId));
    setGroupEditor(null);
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
            Define each recipe batch, then prepare it to deduct supplies from kitchen stock and add ready menu portions.
            Sales deduct prepared portions.
          </p>
        </div>
        <div className="tc-kitchen-section__actions">
          <button
            type="button"
            className="rs-btn rs-btn--small rs-btn--primary"
            onClick={() => setShowNewMeal(true)}
          >
            <i className="fa-solid fa-plus" aria-hidden /> New meal
          </button>
          <button
            type="button"
            className="rs-btn rs-btn--small"
            onClick={() => void refreshCosting()}
            disabled={costingLoading}
          >
            <i className="fa-solid fa-rotate" aria-hidden /> Refresh portions
          </button>
          <span className="rs-badge rs-badge--ok">{activeCount} Available</span>
          {inactiveCount > 0 && (
            <span className="rs-badge rs-badge--warn">{inactiveCount} Paused</span>
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
        <div className="tc-kitchen-empty">
          <i className="fa-solid fa-utensils" aria-hidden />
          <h4>No meals created yet</h4>
          <p>Create a meal here, add its recipe, then assign its price in Menu.</p>
          <button type="button" className="tc-kitchen-btn tc-kitchen-btn--primary" onClick={() => setShowNewMeal(true)}>
            <i className="fa-solid fa-plus" aria-hidden /> Create first meal
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rs-empty">No dishes match &quot;{query}&quot;.</p>
      ) : (
        <ul className="tc-kitchen-meals">
          {visible.map((dish) => {
            const meal = costing.get(dish.id);
            const requestedServingUnit = selectedServingUnitByDish[dish.id];
            const servingUnit =
              meal?.equivalences?.some((entry) => entry.serving_unit === requestedServingUnit)
                ? requestedServingUnit
                : meal?.serving_unit || "servings";
            const equivalence = meal?.equivalences?.find(
              (entry) => entry.serving_unit === servingUnit,
            );
            const batchCount = Number(batchCountByDish[dish.id] || "1");
            const batchLimit = equivalence?.batches_producible ?? 0;
            return (
              <li key={dish.id} className={`tc-kitchen-meal${dish.is_active ? "" : " is-paused"}`}>
                <div className="tc-kitchen-meal__main">
                  <div className="tc-kitchen-meal__name">{dish.product?.name ?? "Dish"}</div>
                  <div className="tc-kitchen-meal__meta">
                    <span className="rs-badge">
                      {dish.product?.product_type === "combo" ? "Combo" : "Meal"}
                    </span>
                    {dish.product?.category ? <span>{dish.product.category}</span> : null}
                  </div>
                  {supportsKitchenRecipe(dish) ? (
                    <button
                      type="button"
                      className="tc-kitchen-meal__icon-btn"
                      onClick={() => openRecipeEditor(dish)}
                      title={meal?.has_recipe ? "Edit meal" : "Set recipe"}
                      aria-label={meal?.has_recipe ? "Edit meal" : "Set recipe"}
                    >
                      <i className="fa-solid fa-list-check" aria-hidden="true" />
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
                </div>
                <div className="tc-kitchen-meal__portions">
                  {costingLoading ? (
                    <span className="rs-muted">Loading…</span>
                  ) : costingLoadFailed ? (
                    <span className="rs-badge rs-badge--warn">Unavailable</span>
                  ) : !meal?.has_recipe ? (
                    <span className="rs-badge rs-badge--warn">Recipe not set</span>
                  ) : (equivalence?.portions_available ?? meal.portions_available) == null ? (
                    <span className="rs-badge rs-badge--warn">Stock not tracked</span>
                  ) : (
                    <>
                      {meal.equivalences?.length > 1 ? (
                        <label>
                          <span className="sr-only">Serving option for {dish.product?.name ?? "meal"}</span>
                          <select
                            aria-label={`Serving option for ${dish.product?.name ?? "meal"}`}
                            value={servingUnit}
                            onChange={(event) => {
                              setSelectedServingUnitByDish((prev) => ({
                                ...prev,
                                [dish.id]: event.target.value,
                              }));
                              setBatchCountByDish((prev) => ({ ...prev, [dish.id]: "1" }));
                            }}
                          >
                            {meal.equivalences.map((entry) => (
                              <option key={entry.serving_unit} value={entry.serving_unit}>
                                {entry.serving_unit}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <strong>{equivalence?.portions_available ?? meal.portions_available}</strong>
                      <span>{servingUnit} ready</span>
                      {equivalence?.prepared_quantity != null ? (
                        <>
                          <small>
                            {batchLimit > 0
                              ? `${batchLimit} batch${batchLimit === 1 ? "" : "es"} can be made${
                                  equivalence.limiting_ingredient
                                    ? `; limited by ${equivalence.limiting_ingredient}`
                                    : ""
                                }`
                              : `Limited by ${equivalence.limiting_ingredient || "available supplies"}`}
                          </small>
                          <label>
                            <span className="sr-only">Batches to prepare for {dish.product?.name ?? "meal"}</span>
                            <input
                              type="number"
                              min={1}
                              max={batchLimit || undefined}
                              step={1}
                              value={batchCountByDish[dish.id] ?? "1"}
                              onChange={(event) =>
                                setBatchCountByDish((prev) => ({
                                  ...prev,
                                  [dish.id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="rs-btn rs-btn--small"
                            disabled={
                              preparingId != null ||
                              batchLimit < 1 ||
                              !Number.isInteger(batchCount) ||
                              batchCount < 1 ||
                              batchCount > batchLimit
                            }
                            onClick={() => void handlePrepareBatch(dish)}
                          >
                            {preparingId === dish.id ? "Preparing…" : `Prepare ${batchCount} batch${batchCount === 1 ? "" : "es"}`}
                          </button>
                        </>
                      ) : meal.limiting_ingredient ? (
                        <small>Limited by {meal.limiting_ingredient}</small>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="tc-kitchen-meal__status">
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
              </li>
            );
          })}
        </ul>
      )}
      {showNewMeal ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => !creatingMeal && setShowNewMeal(false)}
          role="presentation"
        >
          <div
            className="pos-menu-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-new-meal-title"
          >
            <div className="pos-menu-modal__drag-handle" />
            <header className="pos-menu-modal__header">
              <div className="pos-menu-modal__title-row">
                <h2 id="kitchen-new-meal-title" className="pos-menu-modal__title">Create a Kitchen meal</h2>
                <button
                  type="button"
                  className="pos-menu-modal__close-btn"
                  onClick={() => setShowNewMeal(false)}
                  disabled={creatingMeal}
                  aria-label="Close"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="pos-menu-modal__body">
              <div className="pos-menu-modal__field">
                <label htmlFor="kitchen-new-meal-name">Meal name</label>
                <input
                  id="kitchen-new-meal-name"
                  autoFocus
                  type="text"
                  maxLength={255}
                  value={newMealName}
                  onChange={(event) => setNewMealName(event.target.value)}
                  placeholder="e.g. Boneless chicken"
                  className="pos-menu-modal__text-input"
                />
              </div>
              <p className="rs-card__meta">
                Set the recipe and portion sizes in Kitchen. The meal will appear in Menu for pricing after its recipe is saved.
              </p>
              <footer className="pos-menu-modal__footer">
                <button
                  type="button"
                  className="rs-btn"
                  disabled={creatingMeal}
                  onClick={() => setShowNewMeal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pos-menu-modal__submit-btn"
                  disabled={creatingMeal || !newMealName.trim()}
                  onClick={() => void createMeal()}
                >
                  {creatingMeal ? "Creating…" : "Create meal"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ) : null}
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
                  <h2 id="kitchen-recipe-editor-title" className="pos-menu-modal__title">
                    {recipeEditor.product?.recipe?.length ? "Edit Kitchen meal" : "Set up Kitchen meal"}
                  </h2>
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
                <>
                  <div className="pos-menu-modal__field">
                    <label htmlFor="kitchen-meal-name">Meal name</label>
                    <input
                      id="kitchen-meal-name"
                      type="text"
                      maxLength={255}
                      value={recipeMealName}
                      readOnly={recipeEditor.product?.created_by_account_id !== accountId}
                      onChange={(event) => setRecipeMealName(event.target.value)}
                      className="pos-menu-modal__text-input"
                    />
                    {recipeEditor.product?.created_by_account_id !== accountId ? (
                      <span className="pos-menu-modal__label-hint">
                        This shared meal name can only be changed by its owner.
                      </span>
                    ) : null}
                  </div>
                  <RecipeField
                    label="Recipe batch"
                    supplies={supplies}
                    equivalenceUnits={enableKitchenMeasures ? equivalenceUnits : undefined}
                    onSaveEquivalenceUnits={enableKitchenMeasures ? updateEquivalenceUnits : undefined}
                    rows={recipeDraft}
                    price={recipeEditor.selling_price}
                    showMoney={false}
                    servingUnit={recipeServingUnit}
                    onServingUnitChange={setRecipeServingUnit}
                    onChange={setRecipeDraft}
                  />
                </>
              )}
              {!loadingRecipeStock && !recipeStockLoadFailed ? (
                recipeEditor.product?.recipe?.length || recipeDraft.some((row) => row.productId) ? (
                  <MenuOptionsField
                    label="Meal modifiers"
                    hint="Portion-wise options configured with the meal recipe"
                    groups={regularModifierGroups}
                    attachedIds={selectedModifierGroupIds}
                    onChange={setSelectedModifierGroupIds}
                    onNewGroup={() => setGroupEditor({ group: null, attach: true })}
                    onEditGroup={(group) => setGroupEditor({ group, attach: false })}
                    showMoney={false}
                  />
                ) : (
                  <div className="pos-menu-modal__field">
                    <label>Meal modifiers</label>
                    <p>Add a recipe portion before attaching modifiers.</p>
                  </div>
                )
              ) : null}
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
                    recipeDraft.some((row) => row.productId && parseRecipeQty(row.yield) == null) ||
                    recipeDraftHasInvalidPortion(recipeDraft)
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
                        : "Save meal"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ) : null}
      {groupEditor ? (
        (() => {
          const mealDefinedUnits = Array.from(
            new Set(
              [
                recipeServingUnit,
                ...(recipeEditor?.product?.serving_options ?? []),
                ...recipeDraft.map((row) => row.servingUnit),
                ...equivalenceUnits,
              ]
                .filter((u): u is string => typeof u === "string" && Boolean(u.trim()))
                .map((u) => u.trim()),
            ),
          );
          return (
            <TransChapMenuGroupEditor
              key={groupEditor.group?.id ?? "new-kitchen-modifier"}
              group={groupEditor.group}
              sources={modifierSources}
              isKitchen={true}
              defaultPortionUnit={recipeServingUnit || "portion"}
              availableUnits={mealDefinedUnits}
              onClose={() => setGroupEditor(null)}
              onSaved={handleGroupSaved}
              onDeleted={handleGroupDeleted}
            />
          );
        })()
      ) : null}
    </>
  );
}
