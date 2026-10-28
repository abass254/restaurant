"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { TransChapBarcodeCamera } from "@/components/trans-chap/TransChapBarcodeCamera";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { isRestaurantStore } from "@/lib/onboarding";
import {
  allSellUnits,
  baseUnitName,
  canSellInUnit,
  hasPackUnits,
  normalizeUnitName,
  resolveSellUnit,
  sellUnitPrice,
  type SellUnit,
} from "@/lib/sell-units";
import {
  canSellInventoryItem,
  inventoryProductName,
  inventoryRole,
  hasKitchenRecipe,
  isHotelMenuItem,
  isSaleableRole,
  supportsKitchenRecipe,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem } from "@/lib/types";

export type SaleCatalogLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  unitPrice: number;
  sellUnit: string | null;
  unitFactor: number;
  servingUnit: string | null;
};

type Props = {
  scan: boolean;
  active: boolean;
  basket: SaleCatalogLine[];
  inventory: InventoryItem[];
  inventoryLoading: boolean;
  lastScannedKey: string | null;
  selectedUnitByItemId: Record<string, string>;
  selectedServingUnitByItemId: Record<string, string>;
  onScan: (code: string) => void;
  onSelectUnit: (itemId: string, unitName: string) => void;
  onSelectServingUnit: (itemId: string, servingUnit: string) => void;
  onAdd: (item: InventoryItem, unit?: SellUnit, servingUnit?: string) => void;
  onQty: (key: string, quantity: number) => void;
  onContinue: () => void;
};

type RestaurantDishTab = "all" | "food" | "drinks";

function isDrinkItem(item: InventoryItem): boolean {
  const name = inventoryProductName(item).toLowerCase();
  const category = (item.product?.category || "").toLowerCase();
  const keywords = [
    "chai",
    "tea",
    "coffee",
    "soda",
    "water",
    "juice",
    "drink",
    "beverage",
    "coke",
    "fanta",
    "sprite",
  ];
  return keywords.some((k) => name.includes(k) || category.includes(k));
}

export function TransChapSaleCatalog({
  scan,
  active,
  basket,
  inventory,
  inventoryLoading,
  lastScannedKey,
  selectedUnitByItemId,
  selectedServingUnitByItemId,
  onScan,
  onSelectUnit,
  onSelectServingUnit,
  onAdd,
  onQty,
  onContinue,
}: Props) {
  const user = useOptionalAuthUser();
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const [dishTab, setDishTab] = useState<RestaurantDishTab>("all");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const total = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [basket],
  );
  const qtyByKey = useMemo(() => {
    const map = new Map<string, SaleCatalogLine>();
    for (const line of basket) {
      map.set(line.key, line);
    }
    return map;
  }, [basket]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = inventory.filter((item) => {
      if (!item.is_active) return false;
      if (!isSaleableRole(inventoryRole(item))) return false;
      if (restaurant) {
        if ((supportsKitchenRecipe(item) || isHotelMenuItem(item)) && !hasKitchenRecipe(item)) return false;
        if (dishTab === "food" && isDrinkItem(item)) return false;
        if (dishTab === "drinks" && !isDrinkItem(item)) return false;
      }
      if (!needle) return true;
      const name = inventoryProductName(item).toLowerCase();
      const sku = (item.product?.sku ?? "").toLowerCase();
      const code = (item.product?.product_code ?? "").toLowerCase();
      const category = (item.product?.category ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        code.includes(needle) ||
        category.includes(needle)
      );
    });

    // Newest basket / scanned lines first, then the rest in catalog order.
    const basketRank = new Map<string, number>();
    basket.forEach((line, index) => {
      if (line.inventoryItemId && !basketRank.has(line.inventoryItemId)) {
        basketRank.set(line.inventoryItemId, index);
      }
    });
    return [...rows].sort((a, b) => {
      const aRank = basketRank.get(a.id);
      const bRank = basketRank.get(b.id);
      if (aRank != null && bRank != null) return aRank - bRank;
      if (aRank != null) return -1;
      if (bRank != null) return 1;
      return 0;
    });
  }, [basket, dishTab, inventory, query, restaurant]);

  useEffect(() => {
    if (!lastScannedKey) return;
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [lastScannedKey]);

  return (
    <div className={`trans-chap-sale-scan${scan ? "" : " trans-chap-sale-scan--select"}`}>
      {scan ? (
        <div className="trans-chap-sale-scan__camera">
          <TransChapBarcodeCamera active={active} onScan={onScan} />
        </div>
      ) : null}

      <div className="trans-chap-sale-scan__list" ref={listRef}>
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={
              restaurant
                ? "Search menu dishes (e.g. Chapati, Chai)…"
                : scan
                  ? "Search or scan a product…"
                  : "Search inventory…"
            }
            aria-label={restaurant ? "Search menu dishes" : "Search inventory"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {restaurant ? (
          <div
            className="trans-chap-sales__chips"
            role="group"
            aria-label="Dish type"
            style={{ marginBottom: "0.75rem" }}
          >
            <button
              type="button"
              className={`trans-chap-sales__chip${dishTab === "all" ? " is-active" : ""}`}
              aria-pressed={dishTab === "all"}
              onClick={() => setDishTab("all")}
            >
              All dishes
            </button>
            <button
              type="button"
              className={`trans-chap-sales__chip${dishTab === "food" ? " is-active" : ""}`}
              aria-pressed={dishTab === "food"}
              onClick={() => setDishTab("food")}
            >
              Food & Meals
            </button>
            <button
              type="button"
              className={`trans-chap-sales__chip${dishTab === "drinks" ? " is-active" : ""}`}
              aria-pressed={dishTab === "drinks"}
              onClick={() => setDishTab("drinks")}
            >
              Drinks & Beverages
            </button>
          </div>
        ) : null}

        {inventoryLoading ? (
          <p className="trans-chap-sale-scan__empty">
            {restaurant ? "Loading hotel menu…" : "Loading inventory…"}
          </p>
        ) : filtered.length === 0 ? (
          <TransChapStatus
            actionHref={
              restaurant
                ? "/trans-chap/menus"
                : inventory.length === 0
                  ? "/trans-chap/purchases/new"
                  : undefined
            }
            actionLabel={
              restaurant
                ? "Add dishes to menu"
                : inventory.length === 0
                  ? "Record a purchase"
                  : undefined
            }
          >
            {restaurant
              ? inventory.length === 0
                ? "No dishes on your hotel menu yet. Add common dishes like Chapati, Ugali, and Beef stew to start taking orders."
                : "No menu dishes match this search."
              : inventory.length === 0
                ? "No active inventory yet. Buy stock first, then set selling prices in Inventory."
                : "No items match this search."}
          </TransChapStatus>
        ) : (
          <ul className={`trans-chap-catalog${scan ? "" : " trans-chap-catalog--grid"}`}>
            {filtered.map((item) => {
              const name = inventoryProductName(item);
              const units = allSellUnits(item);
              const selected =
                resolveSellUnit(item, selectedUnitByItemId[item.id] ?? null);
              const servingOptions = item.product?.serving_options ?? [];
              const requestedServingUnit = selectedServingUnitByItemId[item.id];
              const servingUnit =
                requestedServingUnit && servingOptions.includes(requestedServingUnit)
                  ? requestedServingUnit
                  : item.product?.recipe_serving_unit ?? servingOptions[0] ?? null;
              const sellUnitKey =
                normalizeUnitName(selected.name) !== normalizeUnitName(baseUnitName(item))
                  ? `::${normalizeUnitName(selected.name)}`
                  : "";
              const lineKey =
                `${item.id}${sellUnitKey}` +
                (servingUnit ? `::${servingUnit.trim().toLowerCase()}` : "");
              const line = qtyByKey.get(lineKey);
              const canSell = canSellInventoryItem(item);
              const hotel = isHotelMenuItem(item);
              const out =
                !hotel && item.stock_quantity != null && item.stock_quantity <= 0;
              const price = sellUnitPrice(selected);
              const noPrice = price == null || price <= 0;
              const showUnits = hasPackUnits(item);
              return (
                <li
                  key={item.id}
                  className={`trans-chap-catalog__card${line ? " is-in-cart" : ""}${
                    line?.key === lastScannedKey ? " is-fresh" : ""
                  }${!canSell ? " is-disabled" : ""}`}
                >
                  <button
                    type="button"
                    className="trans-chap-catalog__main"
                    disabled={!canSell || !canSellInUnit(item, selected)}
                    onClick={() => onAdd(item, selected, servingUnit ?? undefined)}
                  >
                    <TransChapProductThumb item={item} name={name} size={scan ? "md" : "lg"} />
                    <span className="trans-chap-catalog__copy">
                      <strong>
                        {name}
                        {restaurant && hotel ? (
                          <>
                            <em className="trans-chap-panel__tag">Hotel</em>
                            {typeof (item.attributes as Record<string, unknown> | null)?.prep_time_minutes === "number" ? (
                              <em className="trans-chap-panel__tag" style={{ marginLeft: "0.25rem" }}>
                                ⏱️ {String((item.attributes as Record<string, unknown>).prep_time_minutes)}m
                              </em>
                            ) : null}
                          </>
                        ) : null}
                      </strong>
                      <span>
                        {out
                          ? "Out of stock"
                          : noPrice
                            ? "No price"
                            : `${formatKsh(price)}${
                                normalizeUnitName(selected.name) !== normalizeUnitName(baseUnitName(item))
                                  ? ` / ${selected.name}`
                                  : ""
                              }`}
                      </span>
                    </span>
                  </button>
                  {showUnits ? (
                    <div
                      className="trans-chap-catalog__units"
                      role="group"
                      aria-label={`${name} units`}
                    >
                      {units.map((unit) => {
                        const activeUnit =
                          normalizeUnitName(unit.name) ===
                          normalizeUnitName(selected.name);
                        const enabled = canSell && canSellInUnit(item, unit);
                        return (
                          <button
                            key={unit.name}
                            type="button"
                            className={`trans-chap-catalog__unit${
                              activeUnit ? " is-active" : ""
                            }`}
                            disabled={!enabled && !activeUnit}
                            aria-pressed={activeUnit}
                            onClick={() => onSelectUnit(item.id, unit.name)}
                          >
                            {unit.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {servingOptions.length > 1 ? (
                    <label className="trans-chap-catalog__units">
                      <span className="sr-only">Serving option for {name}</span>
                      <select
                        aria-label={`Serving option for ${name}`}
                        value={servingUnit ?? ""}
                        onChange={(event) => onSelectServingUnit(item.id, event.target.value)}
                      >
                        {servingOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {line ? (
                    <div className="trans-chap-sale-scan__qty">
                      <button
                        type="button"
                        aria-label={`Decrease ${name}`}
                        onClick={() => onQty(line.key, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span>
                        {line.quantity}
                        {line.sellUnit
                          ? ` ${line.sellUnit}`
                          : ""}
                        {line.servingUnit ? ` ${line.servingUnit}` : ""}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase ${name}`}
                        onClick={() => onQty(line.key, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="trans-chap-sale-scan__bar">
        {basket.length ? (
          <p className="trans-chap-form__total">
            {basket.length} item{basket.length === 1 ? "" : "s"}
            <strong>{formatKsh(total)}</strong>
          </p>
        ) : (
          <p className="trans-chap-sale-scan__hint">
            {scan ? "Scan a barcode or tap a product." : "Tap products to add them."}
          </p>
        )}
        <button
          type="button"
          className="auth-split__btn"
          disabled={basket.length === 0 || total <= 0}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
