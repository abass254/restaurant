"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptionalAuthUser } from "@/components/app/AuthProvider";
import { TransChapPhotoField } from "@/components/trans-chap/TransChapPhotoField";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch } from "@/lib/api";
import { showError, showInternalError, toastSuccess, internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { isRestaurantStore } from "@/lib/onboarding";
import {
  baseUnitName,
  detectPackFactor,
  isGroupUnit,
  mergeSellUnitsIntoAttributes,
  packUnits,
  type SellUnit,
} from "@/lib/sell-units";
import {
  inventoryCoverUrl,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  updateInventoryItem,
  updateProductName,
  uploadInventoryPhoto,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type {
  CatalogProductMutationResponse,
  InventoryItem,
  InventoryItemDetailResponse,
  InventoryRole,
} from "@/lib/types";

const ALL_ROLE_OPTIONS: { id: InventoryRole; label: string; hint: string }[] = [
  {
    id: "both",
    label: "Buy & sell",
    hint: "Shows on Purchases and New sale",
  },
  {
    id: "for_sale",
    label: "Sell only",
    hint: "Shows on New sale only — hidden from Purchases (e.g. finished toppings)",
  },
  {
    id: "raw_material",
    label: "Raw material",
    hint: "Shows on Purchases only — not sold as-is",
  },
];

type PackDraft = {
  key: string;
  name: string;
  factor: string;
  sellingPrice: string;
};

function packDraftsFromItem(item: InventoryItem): PackDraft[] {
  return packUnits(item).map((pack, index) => ({
    key: `pack-${index}-${pack.name}`,
    name: pack.name,
    factor: String(pack.factor),
    sellingPrice:
      pack.selling_price == null ? "" : String(pack.selling_price),
  }));
}

function draftsToSellUnits(drafts: PackDraft[]): SellUnit[] {
  return drafts.map((draft) => {
    const unit: SellUnit = {
      name: draft.name.trim(),
      factor: Math.floor(Number(draft.factor)),
    };
    const price = draft.sellingPrice.trim() === "" ? null : Number(draft.sellingPrice);
    if (price != null && Number.isFinite(price) && price >= 0) {
      unit.selling_price = price;
    }
    return unit;
  });
}

function formatUnitPlural(unit: string): string {
  const clean = (unit || "").trim();
  if (!clean) return "Units";
  if (clean.toLowerCase().endsWith("s")) return clean;
  return `${clean}s`;
}

type ProductEditTab = "all" | "general" | "pricing" | "inventory" | "photo";

export function TransChapProductEditForm() {
  const router = useRouter();
  const user = useOptionalAuthUser();
  const restaurant = isRestaurantStore(user?.active_account ?? user?.account);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProductEditTab>("all");
  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [baseUnit, setBaseUnit] = useState("Piece");
  const [packs, setPacks] = useState<PackDraft[]>([]);
  const [role, setRole] = useState<InventoryRole>("for_sale");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id")?.trim() || "";
    if (!id) {
      setLoading(false);
      setError("Choose a product from Inventory to edit.");
      return;
    }
    let alive = true;
    setLoading(true);
    apiFetch<InventoryItemDetailResponse>(apiRoutes.inventoryItem(id))
      .then((res) => {
        if (!alive) return;
        const row = res.data;
        setItem(row);
        setName(inventoryProductName(row));
        setSellingPrice(row.selling_price == null ? "" : String(row.selling_price));
        setBaseUnit(baseUnitName(row));
        setPacks(packDraftsFromItem(row));
        setRole(inventoryRole(row));
        setError(null);
      })
      .catch(() => {
        if (!alive) return;
        setItem(null);
        setError(internalErrorMessage());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const hotel = item ? isHotelMenuItem(item) : false;
  const needsSellPrice = hotel || isSaleableRole(role);
  const roleOptions = useMemo(() => {
    return ALL_ROLE_OPTIONS.filter(
      (option) =>
        option.id !== "raw_material" || restaurant || role === "raw_material",
    );
  }, [restaurant, role]);

  function handleBaseUnitChange(nextUnit: string) {
    setBaseUnit(nextUnit);
    const autoFactor = detectPackFactor(nextUnit, name);
    if (autoFactor) {
      const packName = isGroupUnit(nextUnit) ? nextUnit.trim() : "Bulk";
      setPacks((prev) => {
        if (prev.length === 0) {
          return [
            {
              key: `pack-${Date.now()}`,
              name: packName,
              factor: String(autoFactor),
              sellingPrice: "",
            },
          ];
        } else if (
          prev.length === 1 &&
          (!prev[0].factor || prev[0].name === "Bulk" || isGroupUnit(prev[0].name))
        ) {
          return [
            {
              ...prev[0],
              name: prev[0].name || packName,
              factor: String(autoFactor),
            },
          ];
        }
        return prev;
      });
    }
  }

  function addPack() {
    const autoFactor = detectPackFactor(baseUnit, name);
    const autoName = isGroupUnit(baseUnit) ? baseUnit.trim() : "Bulk";
    setPacks((prev) => [
      ...prev,
      {
        key: `pack-${Date.now()}`,
        name: autoName,
        factor: autoFactor ? String(autoFactor) : "",
        sellingPrice: "",
      },
    ]);
  }

  function updatePack(key: string, patch: Partial<PackDraft>) {
    setPacks((prev) =>
      prev.map((pack) => {
        if (pack.key !== key) return pack;
        const next = { ...pack, ...patch };
        if (patch.name !== undefined && (!pack.factor || pack.factor.trim() === "")) {
          const auto = detectPackFactor(patch.name, name);
          if (auto) {
            next.factor = String(auto);
          }
        }
        return next;
      }),
    );
  }

  function removePack(key: string) {
    setPacks((prev) => prev.filter((pack) => pack.key !== key));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!item) return;
    const nextName = name.trim();
    if (!nextName) return;

    const sellRaw = sellingPrice.trim();
    const sell = sellRaw === "" ? null : Number(sellRaw);
    if (needsSellPrice) {
      if (sell == null || !Number.isFinite(sell) || sell <= 0) return;
    } else if (sellRaw !== "" && (sell == null || !Number.isFinite(sell) || sell < 0)) {
      return;
    }

    for (const pack of packs) {
      const packName = pack.name.trim();
      const factor = Number(pack.factor);
      if (!packName && pack.factor.trim() === "" && pack.sellingPrice.trim() === "") {
        continue;
      }
      if (!packName) {
        await showError("Pack name", "Enter a name like Crate or Dozen.");
        return;
      }
      if (!Number.isFinite(factor) || factor < 2) {
        await showError("Pack size", "Enter how many stock units are in the pack (2 or more).");
        return;
      }
      if (pack.sellingPrice.trim() !== "") {
        const packPrice = Number(pack.sellingPrice);
        if (!Number.isFinite(packPrice) || packPrice < 0) {
          await showError("Pack price", "Enter a valid pack selling price.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (nextName !== inventoryProductName(item)) {
        const product = await updateProductName(item.product_id, nextName);
        setItem((prev) =>
          prev
            ? { ...prev, product: prev.product ? { ...prev.product, ...product } : product }
            : prev,
        );
      }
      const nextBaseUnit = baseUnit.trim() || "Piece";
      if (!hotel && nextBaseUnit !== (item.product?.unit || "Piece")) {
        const product = await apiFetch<CatalogProductMutationResponse>(
          apiRoutes.product(item.product_id),
          {
            method: "PATCH",
            body: JSON.stringify({ unit: nextBaseUnit }),
          },
        );
        setItem((prev) =>
          prev
            ? {
                ...prev,
                product: prev.product
                  ? { ...prev.product, ...product.data }
                  : product.data,
              }
            : prev,
        );
      }

      const payload: {
        selling_price?: number | null;
        inventory_role?: InventoryRole;
        attributes?: Record<string, unknown> | null;
      } = {
        selling_price: needsSellPrice ? sell : sell,
      };
      if (!hotel) {
        payload.inventory_role = role;
        let finalPacks = draftsToSellUnits(packs);
        if (finalPacks.length === 0) {
          const autoFactor = detectPackFactor(nextBaseUnit, nextName);
          if (autoFactor) {
            finalPacks = [
              {
                name: isGroupUnit(nextBaseUnit) ? nextBaseUnit : "Bulk",
                factor: autoFactor,
              },
            ];
          }
        }
        payload.attributes = mergeSellUnitsIntoAttributes(
          item.attributes,
          finalPacks,
        );
      }
      let updated = await updateInventoryItem(item.id, payload);
      if (photoFile) {
        try {
          updated = await uploadInventoryPhoto(item.id, photoFile);
        } catch {
          await showInternalError();
          router.push("/trans-chap/stocks");
          return;
        }
      }
      setItem(updated);
      await toastSuccess("Product updated");
      router.push("/trans-chap/stocks");
    } catch {
      await showInternalError();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="trans-chap-form__lead">Loading product…</p>;
  }

  if (error || !item) {
    return (
      <TransChapStatus
        tone="error"
        actionHref="/trans-chap/stocks"
        actionLabel="Back to Inventory"
      >
        {error || "Product not found."}
      </TransChapStatus>
    );
  }

  const qtyLabel =
    item.stock_quantity == null ? "Not tracked" : String(item.stock_quantity);
  const buyLabel =
    item.buying_price == null ? "Set on Purchases" : formatKsh(item.buying_price);

  const buyPriceNum = Number(item.buying_price || 0);
  const sellPriceNum = Number(sellingPrice || 0);
  const hasBothPrices = buyPriceNum > 0 && sellPriceNum > 0;
  const unitProfit = sellPriceNum - buyPriceNum;
  const marginPct = sellPriceNum > 0 ? (unitProfit / sellPriceNum) * 100 : 0;
  const markupPct = buyPriceNum > 0 ? (unitProfit / buyPriceNum) * 100 : 0;
  const stockQty = Number(item.stock_quantity || 0);
  const totalCostVal = stockQty > 0 && buyPriceNum > 0 ? stockQty * buyPriceNum : null;
  const totalSellVal = stockQty > 0 && sellPriceNum > 0 ? stockQty * sellPriceNum : null;
  const backDestination = restaurant ? "/trans-chap/menus" : "/trans-chap/stocks";

  return (
    <div className="trans-chap-product-edit">
      {/* Top Breadcrumb & Action bar */}
      <div className="trans-chap-product-edit__topbar">
        <nav className="trans-chap-product-edit__breadcrumbs" aria-label="Breadcrumb">
          <Link
            href={backDestination}
            className="trans-chap-product-edit__back-btn"
            title={restaurant ? "Back to Menu" : "Back to Inventory"}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            <span>{restaurant ? "Menu" : "Inventory"}</span>
          </Link>
          <span className="trans-chap-product-edit__sep">/</span>
          <span className="trans-chap-product-edit__current">
            {name ? name : "Edit Product"}
          </span>
        </nav>

        <div className="trans-chap-product-edit__top-actions">
          <button
            type="button"
            className="trans-chap-btn trans-chap-btn--ghost"
            onClick={() => router.push(backDestination)}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="trans-chap-btn trans-chap-btn--primary"
            onClick={(e) => void handleSubmit(e)}
            disabled={saving}
          >
            {saving ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                <span>Saving…</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-check" aria-hidden="true" />
                <span>Save changes</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Hero section with product title and badges */}
      <div className="trans-chap-product-edit__hero">
        <div className="trans-chap-product-edit__hero-title-row">
          <h1 className="trans-chap-product-edit__title">{name || "Untitled Product"}</h1>
          <span className={`trans-chap-product-edit__badge is-${role}`}>
            {roleOptions.find((o) => o.id === role)?.label || "Item"}
          </span>
          {hotel ? (
            <span className="trans-chap-product-edit__badge is-hotel">
              <i className="fa-solid fa-utensils" aria-hidden="true" /> Menu item
            </span>
          ) : null}
          <span
            className={`trans-chap-product-edit__badge ${
              stockQty > 0 ? "is-in-stock" : "is-out-of-stock"
            }`}
          >
            <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
            <span>
              {item.stock_quantity != null
                ? `${item.stock_quantity} in stock`
                : "Not tracked"}
            </span>
          </span>
        </div>
        <p className="trans-chap-product-edit__subtitle">
          {hotel
            ? "Update dish name, presentation photo, and retail menu pricing."
            : "Configure retail pricing, stock units, pack sizing, and review live profitability margins."}
        </p>
      </div>

      {/* Tabs Navigation */}
      <div
        className="trans-chap-product-edit__tabs"
        role="tablist"
        aria-label="Product editor sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "all"}
          className={`trans-chap-tab-btn${activeTab === "all" ? " is-active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          <i className="fa-solid fa-table-cells-large" aria-hidden="true" />
          <span>All sections</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "general"}
          className={`trans-chap-tab-btn${activeTab === "general" ? " is-active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          <i className="fa-solid fa-tag" aria-hidden="true" />
          <span>General info</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pricing"}
          className={`trans-chap-tab-btn${activeTab === "pricing" ? " is-active" : ""}`}
          onClick={() => setActiveTab("pricing")}
        >
          <i className="fa-solid fa-coins" aria-hidden="true" />
          <span>Pricing & Margin</span>
          {hasBothPrices ? (
            <span
              className={`trans-chap-tab-btn__badge ${
                marginPct >= 0 ? "is-margin" : ""
              }`}
            >
              {marginPct >= 0
                ? `+${marginPct.toFixed(0)}%`
                : `${marginPct.toFixed(0)}%`}
            </span>
          ) : null}
        </button>

        {!hotel ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "inventory"}
            className={`trans-chap-tab-btn${
              activeTab === "inventory" ? " is-active" : ""
            }`}
            onClick={() => setActiveTab("inventory")}
          >
            <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
            <span>Stock & Packs</span>
            {stockQty > 0 ? (
              <span className="trans-chap-tab-btn__badge">{stockQty}</span>
            ) : null}
          </button>
        ) : null}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "photo"}
          className={`trans-chap-tab-btn${activeTab === "photo" ? " is-active" : ""}`}
          onClick={() => setActiveTab("photo")}
        >
          <i className="fa-solid fa-camera" aria-hidden="true" />
          <span>Product Photo</span>
          {photoFile || inventoryCoverUrl(item) ? (
            <span className="trans-chap-tab-btn__badge">✓</span>
          ) : null}
        </button>
      </div>

      {/* 2-Column Responsive Layout Form */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="trans-chap-product-edit__grid"
      >
        {/* Left Column (Main Details & Pricing) */}
        <div className="trans-chap-product-edit__col-main">
          {/* Card 1: Product Information */}
          {activeTab === "all" || activeTab === "general" ? (
            <section className="trans-chap-edit-card">
              <div className="trans-chap-edit-card__head">
                <div className="trans-chap-edit-card__icon">
                  <i className="fa-solid fa-tag" aria-hidden="true" />
                </div>
                <div>
                  <h3>Product Information</h3>
                  <p>Title, classification and inventory measurement unit</p>
                </div>
              </div>

              <div className="trans-chap-edit-card__body">
                <div className="trans-chap-edit-field">
                  <label htmlFor="edit-product-name">
                    <span>Product name</span>
                    <span className="trans-chap-edit-field__required">*</span>
                  </label>
                  <input
                    id="edit-product-name"
                    type="text"
                    required
                    autoComplete="off"
                    className="trans-chap-edit-input"
                    placeholder="e.g. Daima Milk 500ml"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>

                {!hotel ? (
                  <div className="trans-chap-edit-field">
                    <span className="trans-chap-edit-field__label">
                      Buy / sell classification
                    </span>
                    <div
                      className="trans-chap-role-picker"
                      role="radiogroup"
                      aria-label="Buy / sell classification"
                    >
                      {roleOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={role === option.id}
                          className={`trans-chap-role-picker__btn${
                            role === option.id ? " is-active" : ""
                          }`}
                          onClick={() => setRole(option.id)}
                        >
                          <span className="trans-chap-role-picker__title">
                            {option.label}
                          </span>
                          <span className="trans-chap-role-picker__desc">
                            {option.hint}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {!hotel ? (
                  <div className="trans-chap-edit-field">
                    <label htmlFor="edit-product-base-unit">
                      <span>Base stock unit</span>
                    </label>
                    <input
                      id="edit-product-base-unit"
                      type="text"
                      autoComplete="off"
                      placeholder="Piece"
                      className="trans-chap-edit-input"
                      value={baseUnit}
                      onChange={(event) => handleBaseUnitChange(event.target.value)}
                    />
                    <span className="trans-chap-edit-field__hint">
                      Inventory is always kept in this unit (e.g. Piece, Packet, Box, Kg).
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Card 2: Pricing & Profitability */}
          {activeTab === "all" || activeTab === "pricing" ? (
            <section className="trans-chap-edit-card">
              <div className="trans-chap-edit-card__head">
                <div className="trans-chap-edit-card__icon is-pricing">
                  <i className="fa-solid fa-coins" aria-hidden="true" />
                </div>
                <div>
                  <h3>Pricing & Profit Margin</h3>
                  <p>Set retail prices and monitor your gross profit margin</p>
                </div>
              </div>

              <div className="trans-chap-edit-card__body">
                <div className="trans-chap-pricing-row">
                  {needsSellPrice ? (
                    <div className="trans-chap-edit-field">
                      <label htmlFor="edit-product-sell">
                        <span>
                          Selling price
                          {hotel ? "" : ` / ${baseUnit.trim() || "Piece"}`}
                        </span>
                        <span className="trans-chap-edit-field__required">*</span>
                      </label>
                      <div className="trans-chap-price-input-wrap">
                        <span className="trans-chap-price-prefix">KES</span>
                        <input
                          id="edit-product-sell"
                          type="text"
                          required
                          inputMode="decimal"
                          placeholder="0.00"
                          className="trans-chap-edit-input trans-chap-edit-input--price"
                          value={sellingPrice}
                          onChange={(event) => setSellingPrice(event.target.value)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="trans-chap-edit-field">
                      <span className="trans-chap-edit-field__label">
                        Selling price
                      </span>
                      <p className="trans-chap-edit-field__note">
                        Raw materials don’t need a selling price and won’t show in New
                        sale.
                      </p>
                    </div>
                  )}

                  {!hotel ? (
                    <div className="trans-chap-edit-field">
                      <span className="trans-chap-edit-field__label">
                        Cost price (Buying price)
                      </span>
                      <div className="trans-chap-cost-display">
                        <span className="trans-chap-cost-display__amount">
                          {buyLabel}
                        </span>
                        <span className="trans-chap-cost-display__hint">
                          {item.buying_price != null && item.buying_price > 0
                            ? "Last recorded purchase cost"
                            : "Automatically updated from Purchases"}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Live Profit Margin Analysis */}
                <div className="trans-chap-margin-calc">
                  <div className="trans-chap-margin-calc__head">
                    <span>Live Profitability Analysis</span>
                    {hasBothPrices ? (
                      <span
                        className={`trans-chap-product-edit__badge ${
                          unitProfit >= 0 ? "is-in-stock" : "is-out-of-stock"
                        }`}
                      >
                        {unitProfit >= 0 ? "Profitable" : "Loss per unit"}
                      </span>
                    ) : null}
                  </div>

                  {hasBothPrices ? (
                    <div className="trans-chap-margin-calc__grid">
                      <div className="trans-chap-margin-tile">
                        <span className="trans-chap-margin-tile__label">
                          Gross Profit / Unit
                        </span>
                        <strong
                          className={`trans-chap-margin-tile__value ${
                            unitProfit >= 0 ? "is-positive" : "is-negative"
                          }`}
                        >
                          {unitProfit >= 0
                            ? `+${formatKsh(unitProfit)}`
                            : `-${formatKsh(Math.abs(unitProfit))}`}
                        </strong>
                        <span className="trans-chap-margin-tile__sub">
                          per {baseUnit.trim() || "unit"}
                        </span>
                      </div>

                      <div className="trans-chap-margin-tile">
                        <span className="trans-chap-margin-tile__label">
                          Profit Margin
                        </span>
                        <strong
                          className={`trans-chap-margin-tile__value ${
                            marginPct >= 0 ? "is-positive" : "is-negative"
                          }`}
                        >
                          {marginPct >= 0
                            ? `+${marginPct.toFixed(1)}%`
                            : `${marginPct.toFixed(1)}%`}
                        </strong>
                        <span className="trans-chap-margin-tile__sub">
                          Markup:{" "}
                          {markupPct >= 0
                            ? `+${markupPct.toFixed(1)}%`
                            : `${markupPct.toFixed(1)}%`}
                        </span>
                      </div>

                      <div className="trans-chap-margin-tile">
                        <span className="trans-chap-margin-tile__label">
                          Inventory Valuation
                        </span>
                        <strong className="trans-chap-margin-tile__value">
                          {totalSellVal != null ? formatKsh(totalSellVal) : "—"}
                        </strong>
                        <span className="trans-chap-margin-tile__sub">
                          {totalCostVal != null
                            ? `Cost basis: ${formatKsh(totalCostVal)}`
                            : `${qtyLabel} in stock`}
                        </span>
                      </div>
                    </div>
                  ) : buyPriceNum <= 0 && sellPriceNum > 0 ? (
                    <p className="trans-chap-margin-calc__tip">
                      <i className="fa-solid fa-circle-info" aria-hidden="true" />
                      <span>
                        Buying price not yet recorded. Margin and profit will calculate
                        automatically once a purchase is logged.
                      </span>
                    </p>
                  ) : (
                    <p className="trans-chap-margin-calc__tip">
                      <i className="fa-solid fa-calculator" aria-hidden="true" />
                      <span>
                        Enter a selling price above to see live gross profit and margin
                        calculations.
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {/* Card 3: Inventory & Packs */}
          {!hotel && (activeTab === "all" || activeTab === "inventory") ? (
            <section className="trans-chap-edit-card">
              <div className="trans-chap-edit-card__head">
                <div className="trans-chap-edit-card__icon is-inventory">
                  <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
                </div>
                <div>
                  <h3>Inventory & Packs</h3>
                  <p>Current stock levels and bundled pack configurations</p>
                </div>
              </div>

              <div className="trans-chap-edit-card__body">
                {/* Stock Level Metric Box */}
                <div className="trans-chap-stock-level-box">
                  <div className="trans-chap-stock-level-box__stat">
                    <span className="trans-chap-stock-level-box__label">
                      Quantity on hand
                    </span>
                    <div className="trans-chap-stock-level-box__value-wrap">
                      <strong className="trans-chap-stock-level-box__value">
                        {qtyLabel}
                      </strong>
                      <span className="trans-chap-stock-level-box__unit">
                        {formatUnitPlural(baseUnit)}
                      </span>
                    </div>
                  </div>
                  <div className="trans-chap-stock-level-box__info">
                    <i className="fa-solid fa-circle-info" aria-hidden="true" />
                    <p>
                      Counted in <strong>{formatUnitPlural(baseUnit)}</strong>.
                      Stock updates automatically when goods are received through
                      Purchases or sold at POS.
                    </p>
                  </div>
                </div>

                {/* Packs Configuration */}
                <div className="trans-chap-packs-section">
                  <div className="trans-chap-packs-section__head">
                    <div>
                      <h4>Also sell as packs</h4>
                      <p>
                        Bundle multiple units into a pack (e.g. Crate of 30, Carton
                        of 12). Stock deducts by individual units when a pack is
                        sold.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="trans-chap-btn trans-chap-btn--ghost trans-chap-btn--sm"
                      onClick={addPack}
                      disabled={saving}
                    >
                      <i className="fa-solid fa-plus" aria-hidden="true" />
                      <span>Add pack</span>
                    </button>
                  </div>

                  {packs.length > 0 ? (
                    <div className="trans-chap-packs-table">
                      <div className="trans-chap-packs-table__header">
                        <span>Pack name</span>
                        <span>Units / pack</span>
                        <span>Pack price (KES)</span>
                        <span>Unit equiv.</span>
                        <span></span>
                      </div>
                      {packs.map((pack) => {
                        const factorNum = Number(pack.factor);
                        const priceNum = Number(pack.sellingPrice);
                        const unitEquiv =
                          factorNum > 0 && priceNum > 0
                            ? formatKsh(priceNum / factorNum)
                            : "—";

                        return (
                          <div
                            key={pack.key}
                            className="trans-chap-packs-table__row"
                          >
                            <div>
                              <input
                                type="text"
                                placeholder="e.g. Crate, Carton"
                                className="trans-chap-edit-input trans-chap-edit-input--sm"
                                value={pack.name}
                                onChange={(event) =>
                                  updatePack(pack.key, {
                                    name: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="e.g. 12"
                                className="trans-chap-edit-input trans-chap-edit-input--sm"
                                value={pack.factor}
                                onChange={(event) =>
                                  updatePack(pack.key, {
                                    factor: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="e.g. 1500"
                                className="trans-chap-edit-input trans-chap-edit-input--sm"
                                value={pack.sellingPrice}
                                onChange={(event) =>
                                  updatePack(pack.key, {
                                    sellingPrice: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="trans-chap-packs-table__equiv">
                              <span>{unitEquiv}</span>
                              <small>/{baseUnit.trim() || "unit"}</small>
                            </div>
                            <div>
                              <button
                                type="button"
                                className="trans-chap-packs-table__remove-btn"
                                title="Remove pack"
                                aria-label="Remove pack"
                                onClick={() => removePack(pack.key)}
                              >
                                <i
                                  className="fa-solid fa-trash-can"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="trans-chap-packs-empty">
                      <p>
                        No pack bundles configured. Click{" "}
                        <strong>+ Add pack</strong> to set up carton, six-pack, or
                        crate sales.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {/* Card 4 (Featured in Main Column when Photo tab is active) */}
          {activeTab === "photo" ? (
            <section className="trans-chap-edit-card">
              <div className="trans-chap-edit-card__head">
                <div className="trans-chap-edit-card__icon is-photo">
                  <i className="fa-solid fa-camera" aria-hidden="true" />
                </div>
                <div>
                  <h3>Product Photo</h3>
                  <p>Upload a clear, well-lit photo of the product</p>
                </div>
              </div>
              <div className="trans-chap-edit-card__body">
                <TransChapPhotoField
                  existingUrl={inventoryCoverUrl(item)}
                  file={photoFile}
                  onFileChange={setPhotoFile}
                  disabled={saving}
                />
              </div>
            </section>
          ) : null}
        </div>

        {/* Right Sidebar Column (Photo, Overview, Actions) */}
        <div className="trans-chap-product-edit__col-side">
          {/* Card 4: Product Photo (Only shown in sidebar if not on photo tab) */}
          {activeTab !== "photo" ? (
            <section className="trans-chap-edit-card">
              <div className="trans-chap-edit-card__head">
                <div className="trans-chap-edit-card__icon is-photo">
                  <i className="fa-solid fa-camera" aria-hidden="true" />
                </div>
                <div>
                  <h3>Product Photo</h3>
                  <p>Visual identifier on POS & catalog</p>
                </div>
              </div>
              <div className="trans-chap-edit-card__body">
                <TransChapPhotoField
                  existingUrl={inventoryCoverUrl(item)}
                  file={photoFile}
                  onFileChange={setPhotoFile}
                  disabled={saving}
                />
              </div>
            </section>
          ) : null}

          {/* Card 5: Summary & Save (Sticky on desktop) */}
          <section className="trans-chap-edit-card trans-chap-edit-card--sticky">
            <div className="trans-chap-edit-card__head">
              <div className="trans-chap-edit-card__icon is-action">
                <i className="fa-solid fa-sliders" aria-hidden="true" />
              </div>
              <div>
                <h3>Summary & Actions</h3>
                <p>Review and save your changes</p>
              </div>
            </div>

            <div className="trans-chap-edit-card__body">
              <div className="trans-chap-edit-summary">
                <div className="trans-chap-edit-summary__item">
                  <span>Product</span>
                  <strong>{name || "Untitled"}</strong>
                </div>
                <div className="trans-chap-edit-summary__item">
                  <span>Retail Price</span>
                  <strong>
                    {sellingPrice
                      ? formatKsh(Number(sellingPrice) || 0)
                      : "Not set"}
                  </strong>
                </div>
                {!hotel ? (
                  <div className="trans-chap-edit-summary__item">
                    <span>Stock On Hand</span>
                    <strong>
                      {qtyLabel} {formatUnitPlural(baseUnit)}
                    </strong>
                  </div>
                ) : null}
                {!hotel && hasBothPrices ? (
                  <div className="trans-chap-edit-summary__item">
                    <span>Est. Margin</span>
                    <strong
                      style={{
                        color: marginPct >= 0 ? "#10b981" : "#ef4444",
                      }}
                    >
                      {marginPct >= 0
                        ? `+${marginPct.toFixed(1)}%`
                        : `${marginPct.toFixed(1)}%`}
                    </strong>
                  </div>
                ) : null}
              </div>

              <div className="trans-chap-edit-actions">
                <button
                  type="submit"
                  className="trans-chap-btn trans-chap-btn--primary trans-chap-btn--block"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <i
                        className="fa-solid fa-spinner fa-spin"
                        aria-hidden="true"
                      />
                      <span>Saving changes…</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check" aria-hidden="true" />
                      <span>Save changes</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="trans-chap-btn trans-chap-btn--ghost trans-chap-btn--block"
                  onClick={() => router.push(backDestination)}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        </div>
      </form>
    </div>
  );
}
