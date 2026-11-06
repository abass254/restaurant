"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch, DATA_CHANGED_EVENT } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { orderHasSuccessfulMpesa, orderUsesPayment } from "@/lib/orders";
import { itemDefinedUnits } from "@/lib/sell-units";
import {
  MenuOptionsField,
  TransChapMenuGroupEditor,
  type ModifierSources,
} from "@/components/trans-chap/TransChapMenuGroupEditor";
import {
  fetchKitchenEquivalenceUnits,
  fetchKitchenStock,
  formatQty,
  saveKitchenEquivalenceUnits,
  fetchMenuCosting,
  type MenuCosting,
  type KitchenIssue,
  type KitchenStock,
  type KitchenItem,
} from "@/lib/restaurant-supplies";
import {
  createKitchenMeal,
  deleteInventoryItem,
  fetchModifierGroups,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  isSupplyItem,
  modifierOptionInput,
  saveItemModifierGroups,
  saveModifierGroup,
  saveRecipe,
  supportsKitchenRecipe,
  updateInventoryActive,
} from "@/lib/trans-chap-product";
import { RestaurantKitchenExtras } from "@/components/trans-chap/restaurant/RestaurantKitchenExtras";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
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
import { fetchAllPages } from "@/lib/paged-fetch";

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchKitchenStock();
      setStock(next);
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
  if (!stock.enabled) return <KitchenSetup />;

  return (
    <KitchenBoard
      stock={stock}
      onStock={setStock}
    />
  );
}

export function KitchenSetup() {
  const [menuDishes, setMenuDishes] = useState<InventoryItem[]>([]);
  const [menuSupplies, setMenuSupplies] = useState<InventoryItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [orderStageFilter, setOrderStageFilter] = useState<"all" | "new" | "preparing" | "ready">("all");
  const loadMenu = useCallback(async (silent = false): Promise<InventoryItem[] | null> => {
    try {
      const res = await apiFetch<{ data: InventoryItem[] }>(apiRoutes.inventory);
      const inventory = res.data || [];
      setMenuDishes(inventory.filter((item) => isHotelMenuItem(item)));
      setMenuSupplies(inventory.filter((item) => isSupplyItem(item)));
      return inventory;
    } catch (err) {
      if (!silent) await showError("Could not load current menu", extractErrorMessage(err));
      return null;
    } finally {
      setMenuLoading(false);
    }
  }, []);

  const refreshMenuSilently = useCallback(async () => {
    await loadMenu(true);
  }, [loadMenu]);

  const {
    orders,
    ordersLoading,
    ordersError,
    startingOrderId,
    loadOrders,
    startPreparing,
    markReady,
    confirmHandoff,
  } = useKitchenOrders(refreshMenuSilently);

  return (
    <div className="tc-kitchen-page">
      <KitchenStageSummaryBar
        orders={orders}
        loading={ordersLoading}
        activeStage={orderStageFilter}
        onSelectStage={setOrderStageFilter}
        onRefresh={() => void loadOrders()}
        onStartPreparing={(order) => void startPreparing(order)}
        onMarkReady={(order) => void markReady(order)}
        onConfirmHandoff={(order) => void confirmHandoff(order)}
        canStartPreparing={canStartPreparing}
        startingOrderId={startingOrderId}
      />
      <KitchenOrderQueue
        orders={orders}
        loading={ordersLoading}
        error={ordersError}
        startingOrderId={startingOrderId}
        activeFilter={orderStageFilter}
        onFilterChange={setOrderStageFilter}
        onRefresh={() => void loadOrders()}
        onStartPreparing={(order) => void startPreparing(order)}
        onMarkReady={(order) => void markReady(order)}
        onConfirmHandoff={(order) => void confirmHandoff(order)}
        canStartPreparing={canStartPreparing}
      />
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
    </div>
  );
}

const KITCHEN_ORDER_STATUSES = ["placed", "awaiting_payment", "payment_received", "being_prepared", "ready"];

function canStartPreparing(order: Order): boolean {
  if (!order.allowed_next_statuses?.includes("being_prepared")) return false;
  if (order.status === "payment_received") return true;
  if (order.status !== "placed") return false;
  return !orderUsesPayment(order, "mpesa") || orderHasSuccessfulMpesa(order);
}

function useKitchenOrders(onRefresh?: () => Promise<void>) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const loadOrders = useCallback(async () => {
    try {
      const results = await Promise.all(
        KITCHEN_ORDER_STATUSES.map((status) =>
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

  const refreshAll = useCallback(async () => {
    await Promise.all([loadOrders(), onRefreshRef.current?.()]);
  }, [loadOrders]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refreshAll(), 0);
    const timer = window.setInterval(() => void refreshAll(), 10_000);
    const onEvent = () => void refreshAll();
    window.addEventListener("trans-chap:refresh-counts", onEvent);
    window.addEventListener("TransChap:notification", onEvent);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
      window.removeEventListener("trans-chap:refresh-counts", onEvent);
      window.removeEventListener("TransChap:notification", onEvent);
    };
  }, [refreshAll]);

  async function runTransition(
    order: Order,
    request: () => Promise<OrderMutationResponse>,
    success: string,
    failure: string,
    closedMeansDone = false,
  ) {
    if (startingOrderId) return;
    setStartingOrderId(order.id);
    try {
      const response = await request();
      setOrders((previous) =>
        previous.map((row) => (row.id === response.data.id ? response.data : row)),
      );
      await toastSuccess(success);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      if (closedMeansDone && msg.toLowerCase().includes("already closed")) {
        await toastSuccess(success);
      } else {
        await showError(failure, msg);
      }
    } finally {
      await refreshAll();
      setStartingOrderId(null);
    }
  }

  function startPreparing(order: Order) {
    if (!canStartPreparing(order)) return Promise.resolve();
    return runTransition(
      order,
      () =>
        apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
          method: "POST",
          body: JSON.stringify({ to_status: "being_prepared" }),
        }),
      `Started preparing order #${order.order_number}`,
      "Could not start preparing this order",
    );
  }

  function markReady(order: Order) {
    return runTransition(
      order,
      () =>
        apiFetch<OrderMutationResponse>(apiRoutes.orderTransition(order.id), {
          method: "POST",
          body: JSON.stringify({ to_status: "ready" }),
        }),
      `Order #${order.order_number} marked ready for serving`,
      "Could not mark order ready",
    );
  }

  function confirmHandoff(order: Order) {
    return runTransition(
      order,
      () =>
        apiFetch<OrderMutationResponse>(apiRoutes.orderConfirmHandoff(order.id), {
          method: "POST",
          body: "{}",
        }),
      `Order #${order.order_number} served to table`,
      "Could not confirm handover",
      true,
    );
  }

  return {
    orders,
    ordersLoading,
    ordersError,
    startingOrderId,
    loadOrders,
    startPreparing,
    markReady,
    confirmHandoff,
  };
}

function KitchenBoard({
  stock,
  onStock,
}: {
  stock: KitchenStock;
  onStock: (stock: KitchenStock) => void;
}) {
  const [activeView, setActiveView] = useState<"menu" | "orders" | "measures">("menu");
  const [orderStageFilter, setOrderStageFilter] = useState<"all" | "new" | "preparing" | "ready">("all");
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [measureQuery, setMeasureQuery] = useState("");
  const [measureUnitFilter, setMeasureUnitFilter] = useState("all");

  const [dishes, setDishes] = useState<InventoryItem[]>([]);
  const [supplies, setSupplies] = useState<InventoryItem[]>([]);
  const [dishesLoading, setDishesLoading] = useState(true);

  const loadDishes = useCallback(async (silent = false): Promise<InventoryItem[] | null> => {
    try {
      const res = await apiFetch<{ data: InventoryItem[] }>(apiRoutes.inventory);
      const hotelItems = (res.data || []).filter((item) => isHotelMenuItem(item));
      setSupplies((res.data || []).filter((item) => isSupplyItem(item)));
      setDishes(hotelItems);
      return res.data;
    } catch (err) {
      if (!silent) await showError("Could not load current menu", extractErrorMessage(err));
      return null;
    } finally {
      setDishesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDishes();
  }, [loadDishes]);

  const refreshKitchenSupplies = useCallback(async () => {
    try {
      const [next] = await Promise.all([fetchKitchenStock(), loadDishes(true)]);
      onStock(next);
    } catch {
      // ignore silent refresh errors
    }
  }, [onStock, loadDishes]);

  const {
    orders,
    ordersLoading,
    ordersError,
    startingOrderId,
    loadOrders,
    startPreparing,
    markReady,
    confirmHandoff,
  } = useKitchenOrders(refreshKitchenSupplies);

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

  return (
    <div className="tc-kitchen-page">

      {/* ── Order Preparation Stages Bar ── */}
      <KitchenStageSummaryBar
        orders={orders}
        loading={ordersLoading}
        activeStage={activeView === "orders" ? orderStageFilter : undefined}
        onSelectStage={(stage) => {
          setOrderStageFilter(stage);
        }}
        onRefresh={() => void loadOrders()}
        onStartPreparing={(order) => void startPreparing(order)}
        onMarkReady={(order) => void markReady(order)}
        onConfirmHandoff={(order) => void confirmHandoff(order)}
        canStartPreparing={canStartPreparing}
        startingOrderId={startingOrderId}
      />

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
          activeFilter={orderStageFilter}
          onFilterChange={setOrderStageFilter}
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

export function KitchenStageSummaryBar({
  orders,
  loading = false,
  activeStage,
  onSelectStage,
  onRefresh,
  onStartPreparing,
  onMarkReady,
  onConfirmHandoff,
  canStartPreparing,
  startingOrderId,
}: {
  orders: Order[];
  loading?: boolean;
  activeStage?: "all" | "new" | "preparing" | "ready";
  onSelectStage?: (stage: "all" | "new" | "preparing" | "ready") => void;
  onRefresh?: () => void;
  onStartPreparing?: (order: Order) => void;
  onMarkReady?: (order: Order) => void;
  onConfirmHandoff?: (order: Order) => void;
  canStartPreparing?: (order: Order) => boolean;
  startingOrderId?: string | null;
}) {
  const [dropdownStage, setDropdownStage] = useState<"all" | "new" | "preparing" | "ready" | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dropdownStage) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownStage(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dropdownStage]);

  const newOrders = orders.filter(
    (order) =>
      order.status === "placed" ||
      order.status === "awaiting_payment" ||
      order.status === "payment_received",
  );
  const preparingOrders = orders.filter((order) => order.status === "being_prepared");
  const readyOrders = orders.filter((order) => order.status === "ready");
  const newCount = newOrders.length;
  const preparingCount = preparingOrders.length;
  const readyCount = readyOrders.length;
  const totalCount = orders.length;

  const stages: {
    id: "all" | "new" | "preparing" | "ready";
    label: string;
    sublabel: string;
    count: number;
    icon: string;
    tone: "new" | "preparing" | "ready" | "total";
    pulsing?: boolean;
  }[] = [
    {
      id: "new",
      label: "New",
      sublabel: "Waiting to start",
      count: newCount,
      icon: "fa-solid fa-bell",
      tone: "new",
      pulsing: newCount > 0,
    },
    {
      id: "preparing",
      label: "In preparation",
      sublabel: "Currently cooking",
      count: preparingCount,
      icon: "fa-solid fa-fire-burner",
      tone: "preparing",
    },
    {
      id: "ready",
      label: "Ready to serve",
      sublabel: "Ready for tables",
      count: readyCount,
      icon: "fa-solid fa-bell-concierge",
      tone: "ready",
    },
    {
      id: "all",
      label: "All active",
      sublabel: "Live in kitchen",
      count: totalCount,
      icon: "fa-solid fa-receipt",
      tone: "total",
    },
  ];

  const activeStageDef = stages.find((s) => s.id === dropdownStage);
  const dropdownOrders =
    dropdownStage === "new"
      ? newOrders
      : dropdownStage === "preparing"
        ? preparingOrders
        : dropdownStage === "ready"
          ? readyOrders
          : orders;

  function handleCardClick(stageId: "all" | "new" | "preparing" | "ready") {
    if (dropdownStage === stageId) {
      setDropdownStage(null);
    } else {
      setDropdownStage(stageId);
    }
    onSelectStage?.(stageId);
  }

  return (
    <div className="tc-kitchen-stage-bar" role="region" aria-label="Order preparation stages" ref={dropdownRef}>
      <div className="tc-kitchen-stage-grid">
        {stages.map((stage) => {
          const isOpen = dropdownStage === stage.id;
          const isActive = activeStage === stage.id || isOpen;
          return (
            <button
              key={stage.id}
              type="button"
              className={`tc-kitchen-stage-card tc-kitchen-stage-card--${stage.tone}${isActive ? " is-active" : ""}${isOpen ? " is-open" : ""}`}
              onClick={() => handleCardClick(stage.id)}
              aria-expanded={isOpen}
              aria-label={`${stage.label}: ${stage.count} orders (${stage.sublabel}). Click to open orders dropdown.`}
            >
              <div className="tc-kitchen-stage-card__head">
                <span className="tc-kitchen-stage-card__icon" aria-hidden>
                  <i className={stage.icon} />
                </span>
                <span className="tc-kitchen-stage-card__count">
                  {loading ? "…" : stage.count}
                  {stage.pulsing ? <span className="tc-kitchen-new-dot" aria-hidden /> : null}
                </span>
                <span className="tc-kitchen-stage-card__toggle-hint" aria-hidden>
                  <i className={`fa-solid ${isOpen ? "fa-chevron-up" : "fa-chevron-down"}`} />
                </span>
              </div>
              <div className="tc-kitchen-stage-card__body">
                <span className="tc-kitchen-stage-card__label">{stage.label}</span>
                <span className="tc-kitchen-stage-card__sublabel">{stage.sublabel}</span>
              </div>
            </button>
          );
        })}
      </div>

      {dropdownStage ? (
        <div className="tc-kitchen-stage-dropdown" role="dialog" aria-label={`${activeStageDef?.label} orders dropdown`}>
          <div className="tc-kitchen-stage-dropdown__head">
            <div className="tc-kitchen-stage-dropdown__title">
              <span className={`tc-kitchen-stage-card__icon tc-kitchen-stage-card--${activeStageDef?.tone} tc-kitchen-stage-card__icon--dropdown`} aria-hidden>
                <i className={activeStageDef?.icon || "fa-solid fa-bell"} />
              </span>
              <div>
                <h4>{activeStageDef?.label} orders ({dropdownOrders.length})</h4>
                <p>{activeStageDef?.sublabel}</p>
              </div>
            </div>
            <div className="tc-kitchen-stage-dropdown__actions">
              {onRefresh ? (
                <button
                  type="button"
                  className="rs-btn rs-btn--small"
                  onClick={onRefresh}
                  disabled={loading}
                  title="Refresh orders"
                >
                  <i className={`fa-solid fa-rotate${loading ? " fa-spin" : ""}`} aria-hidden /> Refresh
                </button>
              ) : null}
              <button
                type="button"
                className="tc-kitchen-stage-dropdown__close"
                onClick={() => setDropdownStage(null)}
                aria-label="Close orders dropdown"
              >
                <i className="fa-solid fa-xmark" aria-hidden />
              </button>
            </div>
          </div>

          <div className="tc-kitchen-stage-dropdown__chips">
            {stages.map((st) => (
              <button
                key={st.id}
                type="button"
                className={`tc-kitchen-filter-chip tc-kitchen-filter-chip--${st.tone}${dropdownStage === st.id ? " is-active" : ""}`}
                onClick={() => setDropdownStage(st.id)}
              >
                <i className={st.icon} aria-hidden />
                <span>{st.label}</span>
                <span className="tc-kitchen-filter-count">{st.count}</span>
              </button>
            ))}
          </div>

          {dropdownOrders.length === 0 ? (
            <div className="tc-kitchen-stage-dropdown__empty">
              <i className="fa-solid fa-circle-check" aria-hidden />
              <p>No {activeStageDef?.label.toLowerCase()} orders right now.</p>
            </div>
          ) : (
            <ul className="tc-kitchen-stage-dropdown__list">
              {dropdownOrders.map((order) => {
                const isNew =
                  order.status === "placed" ||
                  order.status === "awaiting_payment" ||
                  order.status === "payment_received";
                const canStart = isNew && (canStartPreparing ? canStartPreparing(order) : true);
                const tableLabel = order.table_number
                  ? order.table_number.trim().toLowerCase().startsWith("table")
                    ? order.table_number.trim()
                    : `Table ${order.table_number.trim()}`
                  : null;
                return (
                  <li key={order.id} className={`tc-kitchen-order${isNew ? " is-new" : ""}`}>
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
                          onClick={() => onStartPreparing?.(order)}
                        >
                          {startingOrderId === order.id ? "Starting…" : "Start preparing"}
                        </button>
                      ) : order.status === "being_prepared" ? (
                        <button
                          type="button"
                          className="rs-btn rs-btn--primary"
                          style={{ background: "#2563eb", color: "#fff", border: "none" }}
                          disabled={startingOrderId != null}
                          onClick={() => onMarkReady?.(order)}
                        >
                          {startingOrderId === order.id ? "Updating…" : "Mark ready"}
                        </button>
                      ) : order.status === "ready" ? (
                        <button
                          type="button"
                          className="rs-btn rs-btn--success"
                          style={{ background: "#16a34a", color: "#fff", border: "none" }}
                          disabled={startingOrderId != null}
                          onClick={() => onConfirmHandoff?.(order)}
                        >
                          {startingOrderId === order.id ? "Updating…" : "Serve to table"}
                        </button>
                      ) : isNew ? (
                        <span className="tc-kitchen-order__progress">Waiting for payment confirmation</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function KitchenOrderQueue({
  orders,
  loading,
  error,
  startingOrderId,
  activeFilter = "all",
  onFilterChange,
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
  activeFilter?: "all" | "new" | "preparing" | "ready";
  onFilterChange?: (filter: "all" | "new" | "preparing" | "ready") => void;
  onRefresh: () => void;
  onStartPreparing: (order: Order) => void;
  onMarkReady: (order: Order) => void;
  onConfirmHandoff: (order: Order) => void;
  canStartPreparing: (order: Order) => boolean;
}) {
  const [internalFilter, setInternalFilter] = useState<"all" | "new" | "preparing" | "ready">("all");
  const currentFilter = activeFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;

  const newOrders = orders.filter(
    (order) =>
      order.status === "placed" ||
      order.status === "awaiting_payment" ||
      order.status === "payment_received",
  );
  const preparingOrders = orders.filter((order) => order.status === "being_prepared");
  const readyOrders = orders.filter((order) => order.status === "ready");

  const filteredOrders =
    currentFilter === "new"
      ? newOrders
      : currentFilter === "preparing"
        ? preparingOrders
        : currentFilter === "ready"
          ? readyOrders
          : orders;

  return (
    <section className="tc-kitchen-section tc-kitchen-orders" aria-label="Kitchen order queue">
      <div className="tc-kitchen-section__head">
        <div>
          <h3 className="tc-kitchen-section__title">
            <i className="fa-solid fa-bell" aria-hidden />
            <span>Kitchen orders</span>
            {newOrders.length > 0 ? (
              <span className="tc-kitchen-orders__new">{newOrders.length} new</span>
            ) : null}
          </h3>
          <p className="tc-kitchen-section__subtitle">
            New orders appear here automatically. Start preparing, mark ready when cooked, and serve to tables.
          </p>
        </div>
        <button type="button" className="rs-btn rs-btn--small" onClick={onRefresh} disabled={loading}>
          <i className="fa-solid fa-rotate" aria-hidden /> Refresh
        </button>
      </div>

      <div className="tc-kitchen-order-filters" role="tablist" aria-label="Order stages">
        <button
          type="button"
          className={`tc-kitchen-filter-chip ${currentFilter === "all" ? "is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          <span>All</span>
          <span className="tc-kitchen-filter-count">{orders.length}</span>
        </button>
        <button
          type="button"
          className={`tc-kitchen-filter-chip tc-kitchen-filter-chip--new ${currentFilter === "new" ? "is-active" : ""}`}
          onClick={() => setFilter("new")}
        >
          <i className="fa-solid fa-bell" aria-hidden />
          <span>New</span>
          <span className="tc-kitchen-filter-count">{newOrders.length}</span>
          {newOrders.length > 0 ? <span className="tc-kitchen-new-dot" aria-hidden /> : null}
        </button>
        <button
          type="button"
          className={`tc-kitchen-filter-chip tc-kitchen-filter-chip--preparing ${currentFilter === "preparing" ? "is-active" : ""}`}
          onClick={() => setFilter("preparing")}
        >
          <i className="fa-solid fa-fire-burner" aria-hidden />
          <span>In preparation</span>
          <span className="tc-kitchen-filter-count">{preparingOrders.length}</span>
        </button>
        <button
          type="button"
          className={`tc-kitchen-filter-chip tc-kitchen-filter-chip--ready ${currentFilter === "ready" ? "is-active" : ""}`}
          onClick={() => setFilter("ready")}
        >
          <i className="fa-solid fa-bell-concierge" aria-hidden />
          <span>Ready to serve</span>
          <span className="tc-kitchen-filter-count">{readyOrders.length}</span>
        </button>
      </div>

      {error ? (
        <p className="tc-kitchen-orders__error" role="alert">
          Could not refresh kitchen orders: {error}
        </p>
      ) : null}

      {loading ? (
        <p className="rs-empty">Loading kitchen orders…</p>
      ) : filteredOrders.length === 0 ? (
        <div className="tc-kitchen-empty">
          <i className="fa-solid fa-bell-slash" aria-hidden />
          <h4>
            {currentFilter === "new"
              ? "No new orders"
              : currentFilter === "preparing"
                ? "No orders currently in preparation"
                : currentFilter === "ready"
                  ? "No orders waiting to be served"
                  : "No active orders"}
          </h4>
          <p>
            {currentFilter !== "all" && orders.length > 0 ? (
              <button
                type="button"
                className="rs-btn rs-btn--small"
                onClick={() => setFilter("all")}
                style={{ marginTop: "0.5rem" }}
              >
                Show all {orders.length} orders
              </button>
            ) : (
              "New orders will show here while the kitchen is open."
            )}
          </p>
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



function servingsChanged(previous: Map<string, MenuCosting>, next: Map<string, MenuCosting>): boolean {
  if (previous.size === 0) return false;
  const servings = (meal: MenuCosting | undefined) =>
    JSON.stringify([
      meal?.portions_possible ?? null,
      (meal?.equivalences ?? []).map((entry) => [entry.serving_unit, entry.portions_possible]),
    ]);
  for (const [id, meal] of next) {
    if (previous.has(id) && servings(previous.get(id)) !== servings(meal)) return true;
  }
  return false;
}

function CurrentMenuSection({
  dishes,
  setDishes,
  supplies,
  reloadDishes,
  loading,
  enableKitchenMeasures = true,
}: {
  dishes: InventoryItem[];
  setDishes: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  supplies: InventoryItem[];
  reloadDishes: () => Promise<InventoryItem[] | null>;
  loading: boolean;
  enableKitchenMeasures?: boolean;
}) {
  const user = useAuthUser();
  const accountId = (user.active_account ?? user.account)?.id ?? null;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingDishId, setDeletingDishId] = useState<string | null>(null);
  const [selectedServingUnitByDish, setSelectedServingUnitByDish] = useState<Record<string, string>>({});
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
  const dirtyGroupIdsRef = useRef<Set<string>>(new Set());

  const costingRef = useRef(costing);
  useEffect(() => {
    costingRef.current = costing;
  }, [costing]);

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
    const refreshSilently = () => {
      fetchMenuCosting()
        .then((rows) => {
          if (!active) return;
          const next = new Map(rows.map((row) => [row.inventory_item_id, row]));
          const changed = servingsChanged(costingRef.current, next);
          setCosting(next);
          setCostingLoadFailed(false);
          if (changed) void toastSuccess("Possible servings updated");
        })
        .catch(() => undefined);
    };
    let debounce: number | undefined;
    const refreshSoon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(refreshSilently, 400);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };
    const timer = window.setInterval(refreshSilently, 10_000);
    window.addEventListener("trans-chap:refresh-counts", refreshSoon);
    window.addEventListener("TransChap:notification", refreshSoon);
    window.addEventListener(DATA_CHANGED_EVENT, refreshSoon);
    window.addEventListener("focus", refreshSoon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearTimeout(debounce);
      window.removeEventListener("trans-chap:refresh-counts", refreshSoon);
      window.removeEventListener("TransChap:notification", refreshSoon);
      window.removeEventListener(DATA_CHANGED_EVENT, refreshSoon);
      window.removeEventListener("focus", refreshSoon);
      document.removeEventListener("visibilitychange", onVisible);
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
  const modifierGroupsById = useMemo(
    () => new Map(modifierGroups.map((group) => [group.id, group])),
    [modifierGroups],
  );
  const supplyNameByProductId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of supplies) {
      if (s.product_id) map.set(s.product_id, inventoryProductName(s));
    }
    return map;
  }, [supplies]);
  const modifierSources = useMemo<ModifierSources>(
    () => ({
      storeItems: supplies
        .filter((item) => isSaleableRole(inventoryRole(item)) && !isHotelMenuItem(item))
        .map((item) => ({
          id: item.product_id,
          name: inventoryProductName(item),
          units: itemDefinedUnits(item),
          inKitchen: Number(item.kitchen_quantity ?? 0) > 0,
          role: inventoryRole(item),
        })),
      rawMaterials: supplies
        .filter((item) => inventoryRole(item) === "raw_material" && !isHotelMenuItem(item))
        .map((item) => ({
          id: item.product_id,
          name: inventoryProductName(item),
          units: itemDefinedUnits(item),
          inKitchen: Number(item.kitchen_quantity ?? 0) > 0,
          role: "raw_material",
        })),
      menuItems: dishes
        .filter((item) => item.product?.product_type !== "addon")
        .map((item) => {
          const mealUnits = Array.from(
            new Set(
              [
                item.product?.recipe_serving_unit,
                ...(item.product?.serving_options ?? []),
                ...(item.product?.recipe?.map((r) => r.serving_unit) ?? []),
              ]
                .filter((u): u is string => typeof u === "string" && Boolean(u.trim()))
                .map((u) => u.trim()),
            ),
          );
          return {
            id: item.product_id,
            name: inventoryProductName(item),
            units: mealUnits.length ? mealUnits : ["servings"],
            inKitchen: true,
          };
        }),
      extras: modifierGroups
        .filter((group) => group.is_extra)
        .flatMap((group) =>
          group.options.map((option) => ({
            id: option.id,
            name: option.name,
            units: [
              option.recipes?.[0]?.portion_unit || option.portion_unit || "portions",
            ],
            inKitchen: true,
          })),
        ),
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

  async function openRecipeEditor(dish: InventoryItem) {
    dirtyGroupIdsRef.current.clear();
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
      await toastSuccess(`“${name}” created in Kitchen. Set up its recipe batch and portions.`);
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
      const latestGroupsById = new Map(modifierGroups.map((g) => [g.id, g]));
      if (dirtyGroupIdsRef.current.size > 0) {
        for (const dirtyId of Array.from(dirtyGroupIdsRef.current)) {
          const dirtyGroup = latestGroupsById.get(dirtyId);
          if (!dirtyGroup) continue;
          const savedGroup = await saveModifierGroup(dirtyGroup.id, {
            name: dirtyGroup.name,
            min_select: dirtyGroup.min_select,
            max_select: dirtyGroup.max_select,
            is_extra: dirtyGroup.is_extra,
            included: Boolean(dirtyGroup.included),
            options: dirtyGroup.options.map((opt) => ({
              ...modifierOptionInput(opt),
              stock_qty: opt.stock_qty ?? 1,
              portion_unit: (opt.portion_unit || recipeServingUnit || "servings").trim() || null,
            })),
          });
          latestGroupsById.set(savedGroup.id, { ...savedGroup, item_count: dirtyGroup.item_count });
          dirtyGroupIdsRef.current.delete(dirtyId);
        }
        setModifierGroups(Array.from(latestGroupsById.values()));
        savedParts.push("Modifier portions");
      }
      const previousGroups = recipeEditor.product?.modifier_groups ?? [];
      const previousIds = previousGroups.map((group) => group.id);
      const groupsChanged =
        previousIds.length !== selectedModifierGroupIds.length ||
        previousIds.some((id, index) => id !== selectedModifierGroupIds[index]);
      const attachedGroups = groupsChanged
        ? await saveItemModifierGroups(recipeEditor.product_id, selectedModifierGroupIds)
        : selectedModifierGroupIds
            .map((id) => latestGroupsById.get(id) ?? previousGroups.find((g) => g.id === id))
            .filter((g): g is ModifierGroup => Boolean(g));
      if (groupsChanged) savedParts.push("Modifiers");
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

  async function handleDeleteDish(dish: InventoryItem) {
    if (deletingDishId || savingRecipe) return;
    const name = inventoryProductName(dish);
    const ok = await confirmAction(
      `Delete "${name}"?`,
      `This permanently deletes "${name}" from your kitchen menu and inventory.`,
      "Delete meal",
    );
    if (!ok) return;
    setDeletingDishId(dish.id);
    try {
      await deleteInventoryItem(dish.id);
      setDishes((previous) => previous.filter((d) => d.id !== dish.id));
      if (recipeEditor?.id === dish.id) {
        setRecipeEditor(null);
      }
      await toastSuccess(`"${name}" deleted from kitchen menu`);
      await refreshCosting();
    } catch (err) {
      await showError("Could not delete meal", extractErrorMessage(err));
    } finally {
      setDeletingDishId(null);
    }
  }

  async function handleInlineGroupUpdate(nextGroup: ModifierGroup, persist?: boolean) {
    setModifierGroups((previous) =>
      previous.map((group) => (group.id === nextGroup.id ? { ...nextGroup, item_count: group.item_count } : group)),
    );
    dirtyGroupIdsRef.current.add(nextGroup.id);
    if (!persist) return;
    try {
      const saved = await saveModifierGroup(nextGroup.id, {
        name: nextGroup.name,
        min_select: nextGroup.min_select,
        max_select: nextGroup.max_select,
        is_extra: nextGroup.is_extra,
        included: Boolean(nextGroup.included),
        options: nextGroup.options.map((opt) => ({
          ...modifierOptionInput(opt),
          stock_qty: opt.stock_qty ?? 1,
          portion_unit: (opt.portion_unit || recipeServingUnit || "servings").trim() || null,
        })),
      });
      dirtyGroupIdsRef.current.delete(nextGroup.id);
      setModifierGroups((previous) =>
        previous.map((group) => (group.id === saved.id ? { ...saved, item_count: group.item_count } : group)),
      );
    } catch (err) {
      await showError("Could not update modifier portion", extractErrorMessage(err));
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
            Define each meal&apos;s recipe. Possible servings update automatically as supplies change.
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
          <p>Create a meal here and set up its recipe batches and portions.</p>
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
            const batchLimit = equivalence?.batches_producible ?? 0;
            const portionsPossible = equivalence?.portions_possible ?? meal?.portions_possible;
            const recipeLines = dish.product?.recipe ?? [];
            const recipeYield = recipeLines[0]?.batch_yield || 1;
            const recipeServingUnit =
              recipeLines[0]?.serving_unit || dish.product?.recipe_serving_unit || servingUnit || "servings";
            const attachedGroups = (dish.product?.modifier_groups ?? [])
              .map((g) => modifierGroupsById.get(g.id) ?? g)
              .filter(Boolean);

            return (
              <li key={dish.id} className={`tc-kitchen-meal-item${dish.is_active ? "" : " is-paused"}`}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`tc-menu__card tc-kitchen-meal__card${dish.is_active ? "" : " tc-menu__card--paused"}`}
                  onClick={() => openRecipeEditor(dish)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openRecipeEditor(dish);
                    }
                  }}
                  title="Click to edit recipe and modifiers"
                >
                  <TransChapProductThumb item={dish} size="md" />
                  <span className="tc-menu__card-body">
                    <span className="tc-menu__card-head">
                      <span className="tc-kitchen-meal__title-group">
                        <strong className="tc-kitchen-meal__name">{dish.product?.name ?? "Dish"}</strong>
                        <span className="tc-kitchen-meal__meta">
                          <span className="rs-badge">
                            {dish.product?.product_type === "combo" ? "Combo" : "Meal"}
                          </span>
                          {dish.product?.category ? <span>{dish.product.category}</span> : null}
                        </span>
                      </span>

                      {/* Portions mapped to it (replaces Ksh from Menu card) */}
                      <span className="tc-kitchen-meal__portions-stat-wrap">
                        {costingLoading ? (
                          <span className="tc-kitchen-meal__portions-stat rs-muted">Loading…</span>
                        ) : costingLoadFailed ? (
                          <span className="tc-kitchen-meal__portions-stat is-warn">Unavailable</span>
                        ) : !meal?.has_recipe ? (
                          <span className="tc-kitchen-meal__portions-stat is-none">
                            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> Recipe not set
                          </span>
                        ) : portionsPossible == null ? (
                          <span className="tc-kitchen-meal__portions-stat is-untracked">Stock untracked</span>
                        ) : (
                          <span
                            className={`tc-kitchen-meal__portions-stat${portionsPossible <= 0 ? " is-out" : ""}`}
                            title="Ready portions plus what kitchen and store supplies can make"
                          >
                            <strong>{portionsPossible}</strong> possible {servingUnit}
                          </span>
                        )}
                      </span>
                    </span>

                    {equivalence?.prepared_quantity != null ? (
                      <div className="tc-kitchen-meal__batch-row">
                        <span className="tc-kitchen-meal__batch-limit">
                          {batchLimit > 0
                            ? `${batchLimit} batch${batchLimit === 1 ? "" : "es"} can be made${
                                equivalence.limiting_ingredient
                                  ? ` · limited by ${equivalence.limiting_ingredient}`
                                  : ""
                              }`
                            : `Limited by ${equivalence.limiting_ingredient || "available supplies"}`}
                        </span>
                      </div>
                    ) : meal?.limiting_ingredient ? (
                      <span className="tc-kitchen-meal__limiting">
                        Limited by {meal.limiting_ingredient}
                      </span>
                    ) : null}
                  </span>
                </div>

                {/* Bottom row: Availability switch on left, recipe and modifier badge counts on lower right */}
                <div className="tc-menu__card-side tc-kitchen-meal__side">
                  <div className="tc-menu__card-status">
                    <button
                      type="button"
                      role="switch"
                      className={`theme-switch ${dish.is_active ? "is-on" : ""}`}
                      aria-checked={dish.is_active}
                      aria-label={dish.is_active ? `Pause ${dish.product?.name}` : `Enable ${dish.product?.name}`}
                      disabled={togglingId === dish.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggle(dish);
                      }}
                    >
                      <span className="theme-switch__thumb" aria-hidden />
                    </button>
                    <span className={`rs-badge ${dish.is_active ? "rs-badge--ok" : "rs-badge--warn"}`}>
                      {dish.is_active ? "Available" : "Paused"}
                    </span>
                  </div>

                  <div className="tc-kitchen-meal__badges">
                    {/* Recipe count badge with hover details tooltip */}
                    <div className="tc-kitchen-badge-wrapper">
                      <button
                        type="button"
                        className={`tc-kitchen-count-badge tc-kitchen-count-badge--recipe${
                          recipeLines.length === 0 ? " is-empty" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openRecipeEditor(dish);
                        }}
                        aria-label={`Recipe: ${recipeLines.length} ingredients`}
                      >
                        <i className="fa-solid fa-utensils" aria-hidden="true" />
                        <span>
                          {recipeLines.length
                            ? `${recipeLines.length} recipe item${recipeLines.length === 1 ? "" : "s"}`
                            : "No recipe"}
                        </span>
                      </button>
                      <div className="tc-kitchen-tooltip" role="tooltip">
                        <div className="tc-kitchen-tooltip__head">
                          <i className="fa-solid fa-book-open" aria-hidden="true" />
                          <strong>Recipe details</strong>
                        </div>
                        {recipeLines.length > 0 ? (
                          <>
                            <ul className="tc-kitchen-tooltip__list">
                              {recipeLines.map((line, idx) => {
                                const name =
                                  supplyNameByProductId.get(line.ingredient_product_id) ||
                                  `Item #${line.ingredient_product_id}`;
                                const qty = line.batch_quantity ?? line.quantity;
                                const unit = line.ingredient_unit || line.unit || "";
                                return (
                                  <li key={idx}>
                                    <span>{name}</span>
                                    <strong>
                                      {qty} {unit}
                                    </strong>
                                  </li>
                                );
                              })}
                            </ul>
                            {recipeYield ? (
                              <div className="tc-kitchen-tooltip__footer">
                                Batch yield: <strong>{recipeYield} {recipeServingUnit}</strong>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="tc-kitchen-tooltip__empty">No recipe configured yet. Click to set ingredients.</p>
                        )}
                      </div>
                    </div>

                    {/* Modifier count badge with hover details tooltip */}
                    <div className="tc-kitchen-badge-wrapper">
                      <button
                        type="button"
                        className={`tc-kitchen-count-badge tc-kitchen-count-badge--modifier${
                          attachedGroups.length === 0 ? " is-empty" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openRecipeEditor(dish);
                        }}
                        aria-label={`Modifiers: ${attachedGroups.length} attached`}
                      >
                        <i className="fa-solid fa-list-check" aria-hidden="true" />
                        <span>
                          {attachedGroups.length
                            ? `${attachedGroups.length} modifier${attachedGroups.length === 1 ? "" : "s"}`
                            : "No modifiers"}
                        </span>
                      </button>
                      <div className="tc-kitchen-tooltip" role="tooltip">
                        <div className="tc-kitchen-tooltip__head">
                          <i className="fa-solid fa-layer-group" aria-hidden="true" />
                          <strong>Meal modifiers</strong>
                        </div>
                        {attachedGroups.length > 0 ? (
                          <ul className="tc-kitchen-tooltip__list">
                            {attachedGroups.map((group) => {
                              const min = (group as any).min_select ?? (group as any).min_selections ?? 0;
                              const rule = min > 0 ? `Required (min ${min})` : "Optional";
                              const opts = group.options?.map((o) => o.name).join(", ");
                              return (
                                <li key={group.id} className="tc-kitchen-tooltip__group-item">
                                  <div className="tc-kitchen-tooltip__group-row">
                                    <strong>{group.name}</strong>
                                    <span className="rs-muted">{rule}</span>
                                  </div>
                                  {opts ? (
                                    <div className="tc-kitchen-tooltip__sublist">{opts}</div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="tc-kitchen-tooltip__empty">No modifiers attached. Click to add options.</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="tc-menu__card-del-btn"
                      title={`Delete ${inventoryProductName(dish)}`}
                      aria-label={`Delete ${inventoryProductName(dish)}`}
                      disabled={deletingDishId === dish.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteDish(dish);
                      }}
                    >
                      <i
                        className={`fa-solid ${deletingDishId === dish.id ? "fa-spinner fa-spin" : "fa-trash-can"}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
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
                <div className="pos-menu-modal__input-wrap">
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
              </div>
              <p className="rs-card__meta">
                Set the recipe batch and portion sizes in Kitchen.
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
      {recipeEditor && !groupEditor && !showNewMeal ? (
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
                    <div className="pos-menu-modal__input-wrap">
                      <input
                        id="kitchen-meal-name"
                        type="text"
                        maxLength={255}
                        value={recipeMealName}
                        readOnly={recipeEditor.product?.created_by_account_id !== accountId}
                        onChange={(event) => setRecipeMealName(event.target.value)}
                        className="pos-menu-modal__text-input"
                      />
                    </div>
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
                    price={null}
                    showMoney={false}
                    servingUnit={recipeServingUnit}
                    onServingUnitChange={setRecipeServingUnit}
                    onChange={setRecipeDraft}
                  />
                </>
              )}
              {!loadingRecipeStock && !recipeStockLoadFailed ? (
                <MenuOptionsField
                  label="Meal modifiers"
                  hint="Portion-wise options configured with this meal"
                  groups={regularModifierGroups}
                  attachedIds={selectedModifierGroupIds}
                  onChange={setSelectedModifierGroupIds}
                  onNewGroup={() => setGroupEditor({ group: null, attach: true })}
                  onEditGroup={(group) => setGroupEditor({ group, attach: false })}
                  showMoney={true}
                  servingUnit={recipeServingUnit || "servings"}
                  onUpdateGroup={handleInlineGroupUpdate}
                />
              ) : null}
              <footer className="pos-menu-modal__footer tc-menu__footer tc-menu__recipe-footer">
                <button
                  type="button"
                  className="tc-menu__remove"
                  onClick={() => void handleDeleteDish(recipeEditor)}
                  disabled={savingRecipe || loadingRecipeStock || Boolean(deletingDishId)}
                >
                  {deletingDishId === recipeEditor.id ? "Deleting…" : "Delete meal"}
                </button>
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
