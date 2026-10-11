"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { showError, showInternalError, toastSuccess } from "@/lib/alerts";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  toWhatsAppMsisdn,
  WHATSAPP_COUNTRIES,
  DEFAULT_WHATSAPP_COUNTRY,
} from "@/lib/whatsapp-phone";
import {
  inventoryCoverUrl,
  inventoryProductName,
  isHotelMenuItem,
} from "@/lib/trans-chap-product";
import { isRestaurantStore } from "@/lib/onboarding";
import { packUnits, detectPackSize } from "@/lib/sell-units";
import type {
  InventoryItem,
  InventoryResponse,
  ShopCustomer,
  ShopCustomersListResponse,
} from "@/lib/types";
import "@/styles/trans-chap-quotation.css";

export type QuotationLineItem = {
  id: string; // key: `${item.id}::${unitType}`
  itemId?: string;
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
  unit: string;
  unitType?: "single" | "bulk";
  factor?: number;
};

export function getItemUnitOptions(item: InventoryItem) {
  const name = inventoryProductName(item);
  const packs = packUnits(item);
  const basePrice = item.selling_price ?? 0;
  const baseUnit = item.product?.unit?.trim() || "pcs";

  const single = {
    type: "single" as const,
    name: "Single",
    unit: baseUnit,
    factor: 1,
    price: basePrice,
    stock: item.stock_quantity,
  };

  const autoFactor = packs[0]?.factor ?? detectPackSize(name) ?? 12;
  const packName = packs[0]?.name || `Bulk (${autoFactor} ${baseUnit})`;
  const bulkPrice =
    packs[0]?.selling_price != null ? packs[0].selling_price : basePrice * autoFactor;
  const bulkStock =
    item.stock_quantity != null ? Math.floor(item.stock_quantity / autoFactor) : null;

  const bulk = {
    type: "bulk" as const,
    name: packs[0]?.name || "Bulk",
    unit: packName,
    factor: autoFactor,
    price: bulkPrice,
    stock: bulkStock,
  };

  return { single, bulk, packs };
}

const VALIDITY_PRESETS = [
  { label: "3 days", text: "Valid for 3 days. Prices inclusive of VAT." },
  { label: "7 days", text: "Valid for 7 days. Prices inclusive of VAT." },
  { label: "14 days", text: "Valid for 14 days. Prices inclusive of VAT." },
  { label: "30 days", text: "Valid for 30 days. Prices inclusive of VAT." },
];

export function TransChapQuotation() {
  const user = useAuthUser();
  const searchParams = useSearchParams();
  const queryParamItemIds = useMemo(
    () => (searchParams?.get("items") || "").split(",").map((s) => s.trim()).filter(Boolean),
    [searchParams],
  );

  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "Store";
  const shopPhone = user.phone || "";
  const shopLocation =
    user.active_account?.business_location ||
    user.account?.business_location ||
    "";
  const restaurant = isRestaurantStore(user.active_account ?? user.account);

  // Reference number generated on mount
  const quoteRef = useMemo(() => {
    const today = new Date();
    const y = String(today.getFullYear()).slice(-2);
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `QT-${y}${m}${d}-${rand}`;
  }, []);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);

  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [countryDial, setCountryDial] = useState("254");

  const [notes, setNotes] = useState(VALIDITY_PRESETS[1].text);
  const [discount, setDiscount] = useState<string>("");

  const [quoteItems, setQuoteItems] = useState<QuotationLineItem[]>([]);
  const [catalogUnitByItemId, setCatalogUnitByItemId] = useState<Record<string, "single" | "bulk">>({});
  const [catalogCustomPrices, setCatalogCustomPrices] = useState<Record<string, number>>({});
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "in_stock">("all");

  // Load Inventory
  const loadInventory = useCallback(async () => {
    setLoadingInventory(true);
    try {
      const res = await apiFetch<InventoryResponse>(`${apiRoutes.inventory}?active=true`);
      setInventory(res.data || []);
    } catch {
      setInventory([]);
    } finally {
      setLoadingInventory(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  // Load Customers (for quick selection)
  useEffect(() => {
    void apiFetch<ShopCustomersListResponse>(apiRoutes.customers)
      .then((res) => {
        setCustomers(res.data || []);
      })
      .catch(() => {
        setCustomers([]);
      });
  }, []);

  // Pre-populate items from URL query params once inventory is loaded
  useEffect(() => {
    if (!inventory.length || !queryParamItemIds.length) return;
    setQuoteItems((current) => {
      if (current.length > 0) return current; // avoid overwriting if already populated
      const matched: QuotationLineItem[] = [];
      for (const id of queryParamItemIds) {
        const found = inventory.find((it) => it.id === id);
        if (found) {
          const { single } = getItemUnitOptions(found);
          matched.push({
            id: `${found.id}::single`,
            itemId: found.id,
            item: found,
            quantity: 1,
            unitPrice: single.price,
            unit: single.unit,
            unitType: "single",
            factor: 1,
          });
        }
      }
      return matched;
    });
  }, [inventory, queryParamItemIds]);

  // Catalog filtering
  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return inventory.filter((item) => {
      if (!item.is_active) return false;
      if (restaurant && isHotelMenuItem(item)) return false;
      if (catalogFilter === "in_stock" && (item.stock_quantity == null || item.stock_quantity <= 0)) {
        return false;
      }
      if (!q) return true;
      const name = inventoryProductName(item).toLowerCase();
      const sku = (item.product?.sku || item.product?.product_code || "").toLowerCase();
      return name.includes(q) || sku.includes(q);
    });
  }, [inventory, catalogQuery, catalogFilter, restaurant]);

  // Filtered customer suggestions
  const customerSuggestions = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q))
      .slice(0, 5);
  }, [customers, customerSearch]);

  function handleSelectCustomer(c: ShopCustomer) {
    setCustomerName(c.name || "");
    const rawPhone = (c.phone || "").replace(/\D/g, "");
    if (rawPhone.startsWith("254") && rawPhone.length === 12) {
      setCountryDial("254");
      setCustomerPhone(rawPhone.slice(3));
    } else if (rawPhone.startsWith("0")) {
      setCustomerPhone(rawPhone.replace(/^0+/, ""));
    } else {
      setCustomerPhone(rawPhone);
    }
    setCustomerSearch("");
    void toastSuccess(`Selected customer: ${c.name}`);
  }

  // Basket actions
  function addItemToQuote(
    item: InventoryItem,
    forcedUnitType?: "single" | "bulk",
    customPrice?: number,
  ) {
    const { single, bulk } = getItemUnitOptions(item);
    const chosenType = forcedUnitType ?? catalogUnitByItemId[item.id] ?? "single";
    const chosenOption = chosenType === "bulk" ? bulk : single;
    const lineKey = `${item.id}::${chosenType}`;
    const priceToUse = customPrice !== undefined ? customPrice : chosenOption.price;

    setQuoteItems((prev) => {
      const existing = prev.find(
        (line) =>
          line.id === lineKey ||
          (line.id === item.id && (line.unitType || "single") === chosenType) ||
          ((line.itemId || line.id) === item.id && (line.unitType || "single") === chosenType),
      );
      if (existing) {
        return prev.map((line) =>
          line === existing
            ? {
                ...line,
                quantity: line.quantity + 1,
                ...(customPrice !== undefined ? { unitPrice: customPrice } : {}),
              }
            : line,
        );
      }
      return [
        ...prev,
        {
          id: lineKey,
          itemId: item.id,
          item,
          quantity: 1,
          unitPrice: priceToUse,
          unit: chosenOption.unit,
          unitType: chosenType,
          factor: chosenOption.factor,
        },
      ];
    });
    void toastSuccess(
      `Added ${inventoryProductName(item)} (${chosenType === "bulk" ? "Bulk" : "Single"}) to quotation`,
    );
  }

  function toggleItemUnitType(lineId: string, nextType: "single" | "bulk") {
    setQuoteItems((prev) => {
      const target = prev.find((l) => l.id === lineId);
      if (!target || (target.unitType || "single") === nextType) return prev;
      const { single, bulk } = getItemUnitOptions(target.item);
      const nextOption = nextType === "bulk" ? bulk : single;
      const nextKey = `${target.itemId || target.item.id}::${nextType}`;

      const duplicate = prev.find((l) => l.id === nextKey && l.id !== lineId);
      if (duplicate) {
        return prev
          .filter((l) => l.id !== lineId)
          .map((l) =>
            l.id === duplicate.id
              ? { ...l, quantity: l.quantity + target.quantity }
              : l,
          );
      }

      return prev.map((line) => {
        if (line.id !== lineId) return line;
        return {
          ...line,
          id: nextKey,
          unitType: nextType,
          unit: nextOption.unit,
          unitPrice: nextOption.price,
          factor: nextOption.factor,
        };
      });
    });
  }

  function updateItemQty(id: string, qty: number) {
    if (qty <= 0) {
      removeItem(id);
      return;
    }
    setQuoteItems((prev) =>
      prev.map((line) => (line.id === id ? { ...line, quantity: qty } : line)),
    );
  }

  function updateItemPrice(id: string, price: number) {
    setQuoteItems((prev) =>
      prev.map((line) =>
        line.id === id ? { ...line, unitPrice: Math.max(0, price) } : line,
      ),
    );
  }

  function removeItem(id: string) {
    setQuoteItems((prev) => prev.filter((line) => line.id !== id));
  }

  function clearQuote() {
    setQuoteItems([]);
    setCustomerName("");
    setCustomerPhone("");
    setDiscount("");
  }

  // Calculations
  const subtotal = useMemo(
    () => quoteItems.reduce((acc, line) => acc + line.quantity * line.unitPrice, 0),
    [quoteItems],
  );

  const discountNum = useMemo(() => {
    const val = Number(discount.trim());
    return Number.isFinite(val) && val > 0 ? Math.min(val, subtotal) : 0;
  }, [discount, subtotal]);

  const grandTotal = Math.max(0, subtotal - discountNum);

  // Formatted WhatsApp message
  const whatsappMessage = useMemo(() => {
    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const lines: string[] = [];
    lines.push(`📋 *${restaurant ? "SUPPLIES QUOTATION" : "PRICE QUOTATION"}*`);
    if (shopName) lines.push(`🏪 *${shopName}*`);
    lines.push(`🗓️ *Date:* ${today}`);
    lines.push(`🔖 *Ref:* ${quoteRef}`);
    if (customerName.trim()) {
      lines.push(`👤 *For:* ${customerName.trim()}`);
    }
    lines.push(`────────────────────`);
    lines.push(`*ITEMS:*`);

    if (quoteItems.length === 0) {
      lines.push(`_(No items selected yet)_`);
    } else {
      quoteItems.forEach((line, idx) => {
        const name = inventoryProductName(line.item);
        const lineTotal = line.quantity * line.unitPrice;
        const isBulk = line.unitType === "bulk";
        const typeTag = isBulk ? " [Bulk]" : "";
        const unitPart = line.unit ? ` (${line.unit})` : "";
        lines.push(
          `${idx + 1}. *${name}${typeTag}*\n   ${line.quantity}${unitPart} × KES ${line.unitPrice.toLocaleString()} = *KES ${lineTotal.toLocaleString()}*`,
        );
      });
    }

    lines.push(`────────────────────`);
    lines.push(`💵 *Subtotal:* KES ${subtotal.toLocaleString()}`);
    if (discountNum > 0) {
      lines.push(`🏷️ *Discount:* -KES ${discountNum.toLocaleString()}`);
    }
    lines.push(`💰 *TOTAL:* *KES ${grandTotal.toLocaleString()}*`);
    lines.push(`────────────────────`);

    if (notes.trim()) {
      lines.push(`📌 *Notes:*\n${notes.trim()}`);
    }

    if (shopPhone) {
      lines.push(`📞 *Enquiries:* ${shopPhone}`);
    }
    if (shopLocation) {
      lines.push(`📍 *Location:* ${shopLocation}`);
    }
    lines.push(`_Thank you for doing business with us!_`);

    return lines.join("\n");
  }, [
    restaurant,
    shopName,
    quoteRef,
    customerName,
    quoteItems,
    subtotal,
    discountNum,
    grandTotal,
    notes,
    shopPhone,
    shopLocation,
  ]);

  // Actions
  function handleSendWhatsApp() {
    if (quoteItems.length === 0) {
      void showError("Quotation is empty", "Please add at least one product to the quotation.");
      return;
    }

    const cleanNumber = customerPhone.trim();
    if (cleanNumber) {
      const msisdn = toWhatsAppMsisdn(cleanNumber, countryDial);
      if (!msisdn) {
        void showError(
          "Invalid WhatsApp number",
          "Please check the recipient's phone number or leave it blank to select directly in WhatsApp.",
        );
        return;
      }
      const url = `https://wa.me/${msisdn}?text=${encodeURIComponent(whatsappMessage)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      void toastSuccess(`Opening WhatsApp for +${msisdn}...`);
    } else {
      // Open WhatsApp with text ready to share with any contact or group
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      void toastSuccess("Opening WhatsApp to select recipient...");
    }
  }

  async function handleCopyQuote() {
    if (quoteItems.length === 0) {
      void showError("Quotation is empty", "Add products first before copying.");
      return;
    }
    try {
      await navigator.clipboard.writeText(whatsappMessage);
      void toastSuccess("Quotation message copied to clipboard!");
    } catch {
      void showError("Could not copy", "Please copy the text directly from the preview card.");
    }
  }

  function handlePrint() {
    if (quoteItems.length === 0) {
      void showError("Quotation is empty", "Add products first before printing.");
      return;
    }
    window.print();
  }

  const currentTimeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="trans-chap-quotation" id="trans-chap-quotation-page">
      {/* Top Banner */}
      <div className="tc-quote-banner">
        <div className="tc-quote-banner__info">
          <div className="tc-quote-banner__icon">
            <i className="fa-brands fa-whatsapp" aria-hidden />
          </div>
          <div>
            <h1 className="tc-quote-banner__title">
              {restaurant ? "Store Supplies Quotation" : "Stock Quotation"}
            </h1>
            <p className="tc-quote-banner__desc">
              Select items from your stock, set custom prices or quantities, and share directly via WhatsApp.
            </p>
          </div>
        </div>
        <div className="tc-quote-banner__meta">
          <span className="tc-quote-ref-badge" title="Quotation Reference">
            <i className="fa-solid fa-receipt" style={{ color: "#25d366" }} aria-hidden />
            {quoteRef}
          </span>
          <Link
            href="/trans-chap/stocks"
            className="tc-wa-btn-sub"
            style={{ textDecoration: "none" }}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden />
            Back to stock
          </Link>
        </div>
      </div>

      <div className="tc-quote-grid">
        {/* Left Column: Quotation Builder */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Card 1: Customer / Recipient Details */}
          <section className="tc-quote-card" aria-labelledby="tc-recipient-heading">
            <div className="tc-quote-card__header">
              <h2 className="tc-quote-card__title" id="tc-recipient-heading">
                <i className="fa-solid fa-user" style={{ color: "#25d366" }} aria-hidden />
                Recipient Information
              </h2>
              {customers.length > 0 ? (
                <span className="tc-quote-card__badge">
                  {customers.length} saved customer{customers.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            {/* Quick customer search / select if existing customers exist */}
            {customers.length > 0 ? (
              <div className="tc-quote-field" style={{ position: "relative" }}>
                <label htmlFor="quote-customer-search">Pick Existing Customer (Optional)</label>
                <div className="tc-quote-catalog-search">
                  <i className="fa-solid fa-magnifying-glass" aria-hidden />
                  <input
                    id="quote-customer-search"
                    type="search"
                    placeholder="Search by customer name or phone…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                {customerSuggestions.length > 0 ? (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 10,
                      background: "var(--app-surface, #fff)",
                      border: "1px solid var(--app-border, #cbd5e1)",
                      borderRadius: "10px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      marginTop: "4px",
                      overflow: "hidden",
                    }}
                  >
                    {customerSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCustomer(c)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          width: "100%",
                          padding: "0.6rem 0.85rem",
                          border: 0,
                          background: "transparent",
                          textAlign: "left",
                          cursor: "pointer",
                          borderBottom: "1px solid var(--app-border, #f1f5f9)",
                          fontSize: "0.85rem",
                        }}
                      >
                        <strong>{c.name}</strong>
                        <span style={{ color: "var(--app-text-muted, #64748b)" }}>{c.phone || "No phone"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="tc-quote-form-row">
              <div className="tc-quote-field">
                <label htmlFor="quote-customer-name">Customer / Client Name</label>
                <input
                  id="quote-customer-name"
                  type="text"
                  placeholder="e.g. John Kamau or Apex Ltd"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="tc-quote-field">
                <label htmlFor="quote-customer-phone">WhatsApp Phone Number</label>
                <div className="tc-quote-phone-group">
                  <select
                    id="quote-country-dial"
                    value={countryDial}
                    aria-label="Country Dial Code"
                    onChange={(e) => setCountryDial(e.target.value)}
                  >
                    {WHATSAPP_COUNTRIES.map((country) => (
                      <option key={country.iso} value={country.dial}>
                        +{country.dial} ({country.iso})
                      </option>
                    ))}
                  </select>
                  <input
                    id="quote-customer-phone"
                    type="tel"
                    placeholder="712 345 678 (no leading 0)"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="tc-quote-field">
              <label htmlFor="quote-notes">Validity & Terms / Notes</label>
              <textarea
                id="quote-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Valid for 7 days. Prices inclusive of taxes."
              />
              <div className="tc-quote-presets" role="group" aria-label="Validity presets">
                {VALIDITY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="tc-quote-preset-chip"
                    onClick={() => setNotes(p.text)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Card 2: Selected Quotation Items (The Basket) */}
          <section className="tc-quote-card" aria-labelledby="tc-basket-heading">
            <div className="tc-quote-card__header">
              <h2 className="tc-quote-card__title" id="tc-basket-heading">
                <i className="fa-solid fa-basket-shopping" style={{ color: "#25d366" }} aria-hidden />
                Quotation Items ({quoteItems.length})
              </h2>
              {quoteItems.length > 0 ? (
                <button
                  type="button"
                  className="tc-wa-btn-sub"
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
                  onClick={clearQuote}
                >
                  <i className="fa-solid fa-trash-can" aria-hidden />
                  Clear all
                </button>
              ) : null}
            </div>

            {quoteItems.length === 0 ? (
              <div className="tc-quote-empty-state">
                <i className="fa-solid fa-boxes-stacked" aria-hidden />
                <strong>No products in quotation yet</strong>
                <p style={{ margin: 0, fontSize: "0.82rem" }}>
                  Pick products from your catalog below to add them to this price quote.
                </p>
              </div>
            ) : (
              <div className="tc-quote-items-list" role="list">
                {quoteItems.map((line) => {
                  const name = inventoryProductName(line.item);
                  const onHand = line.item.stock_quantity;
                  const lineTotal = line.quantity * line.unitPrice;
                  const isBulk = line.unitType === "bulk";

                  return (
                    <div key={line.id} className="tc-quote-pos-row is-in-basket" role="listitem">
                      <div className="tc-quote-pos-name-col">
                        <strong className="tc-quote-pos-name" title={name}>
                          {name}
                        </strong>
                        <div className="tc-quote-pos-sub">
                          <span>{line.unit || (isBulk ? "bulk" : "pc")}</span>
                          <span>•</span>
                          <span>{onHand == null ? "Stock: —" : `Stock: ${onHand}`}</span>
                        </div>
                      </div>

                      <div className="tc-quote-pos-controls">
                        <div className="tc-quote-pos-units" role="group" aria-label="Unit type">
                          <button
                            type="button"
                            className={`tc-quote-pos-unit-btn${!isBulk ? " is-active" : ""}`}
                            onClick={() => toggleItemUnitType(line.id, "single")}
                          >
                            Single
                          </button>
                          <button
                            type="button"
                            className={`tc-quote-pos-unit-btn${isBulk ? " is-active" : ""}`}
                            onClick={() => toggleItemUnitType(line.id, "bulk")}
                            title={`Units per bulk: ${line.factor || 12}`}
                          >
                            Bulk
                          </button>
                        </div>

                        <div className="tc-quote-pos-stepper">
                          <button
                            type="button"
                            className="tc-quote-pos-step-btn"
                            aria-label={`Decrease ${name} quantity`}
                            onClick={() => updateItemQty(line.id, line.quantity - 1)}
                          >
                            –
                          </button>
                          <span className="tc-quote-pos-qty">{line.quantity}</span>
                          <button
                            type="button"
                            className="tc-quote-pos-step-btn"
                            aria-label={`Increase ${name} quantity`}
                            onClick={() => updateItemQty(line.id, line.quantity + 1)}
                          >
                            +
                          </button>
                        </div>

                        <div className="tc-quote-pos-price-wrap" title="Unit Price for this quote">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="tc-quote-pos-price-input"
                            value={line.unitPrice}
                            aria-label={`Price for ${name}`}
                            onChange={(e) => updateItemPrice(line.id, Number(e.target.value))}
                          />
                        </div>

                        <div className="tc-quote-pos-total">
                          KES {lineTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>

                        <button
                          type="button"
                          className="tc-quote-pos-remove-btn"
                          title={`Remove ${name}`}
                          aria-label={`Remove ${name}`}
                          onClick={() => removeItem(line.id)}
                        >
                          <i className="fa-solid fa-trash-can" aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Totals Summary */}
            <div className="tc-quote-totals-bar">
              <div className="tc-quote-totals-row">
                <span>Subtotal ({quoteItems.length} item{quoteItems.length === 1 ? "" : "s"})</span>
                <span>{formatKsh(subtotal)}</span>
              </div>
              <div className="tc-quote-totals-row">
                <label htmlFor="quote-discount-input" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <span>Discount (KES)</span>
                </label>
                <div style={{ maxWidth: "120px" }}>
                  <input
                    id="quote-discount-input"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={discount}
                    style={{
                      width: "100%",
                      padding: "0.3rem 0.5rem",
                      border: "1px solid var(--app-border, #cbd5e1)",
                      borderRadius: "6px",
                      textAlign: "right",
                      font: "inherit",
                      fontSize: "0.82rem",
                    }}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </div>
              </div>
              <div className="tc-quote-totals-row tc-quote-totals-row--grand">
                <span>Total Quotation</span>
                <strong>{formatKsh(grandTotal)}</strong>
              </div>
            </div>
          </section>

          {/* Card 3: Stock Catalog / Quick Product Picker */}
          <section className="tc-quote-card" aria-labelledby="tc-catalog-heading">
            <div className="tc-quote-card__header">
              <h2 className="tc-quote-card__title" id="tc-catalog-heading">
                <i className="fa-solid fa-cubes-stacked" style={{ color: "#25d366" }} aria-hidden />
                Add from Stock ({inventory.length})
              </h2>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <button
                  type="button"
                  className={`tc-quote-preset-chip${catalogFilter === "all" ? " is-active" : ""}`}
                  style={{
                    background: catalogFilter === "all" ? "rgba(37,211,102,0.15)" : undefined,
                    borderColor: catalogFilter === "all" ? "#25d366" : undefined,
                    color: catalogFilter === "all" ? "#15803d" : undefined,
                  }}
                  onClick={() => setCatalogFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`tc-quote-preset-chip${catalogFilter === "in_stock" ? " is-active" : ""}`}
                  style={{
                    background: catalogFilter === "in_stock" ? "rgba(37,211,102,0.15)" : undefined,
                    borderColor: catalogFilter === "in_stock" ? "#25d366" : undefined,
                    color: catalogFilter === "in_stock" ? "#15803d" : undefined,
                  }}
                  onClick={() => setCatalogFilter("in_stock")}
                >
                  In stock only
                </button>
              </div>
            </div>

            <div className="tc-quote-catalog-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden />
              <input
                type="search"
                placeholder="Search products by name or SKU…"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
              />
            </div>

            {loadingInventory ? (
              <p style={{ textAlign: "center", color: "var(--app-text-muted, #64748b)", margin: "1rem" }}>
                Loading stock catalog…
              </p>
            ) : filteredCatalog.length === 0 ? (
              <p style={{ textAlign: "center", color: "var(--app-text-muted, #64748b)", margin: "1rem" }}>
                No products found matching your search.
              </p>
            ) : (
              <div className="tc-quote-catalog-list">
                {filteredCatalog.map((item) => {
                  const name = inventoryProductName(item);
                  const { single, bulk } = getItemUnitOptions(item);
                  const currentUnitType = catalogUnitByItemId[item.id] ?? "single";
                  const activeUnit = currentUnitType === "bulk" ? bulk : single;
                  const onHand = item.stock_quantity;

                  const singleInQuote = quoteItems.find(
                    (l) =>
                      l.id === `${item.id}::single` ||
                      (l.id === item.id && (l.unitType || "single") === "single") ||
                      ((l.itemId || l.id) === item.id && (l.unitType || "single") === "single"),
                  );
                  const bulkInQuote = quoteItems.find(
                    (l) =>
                      l.id === `${item.id}::bulk` ||
                      ((l.itemId || l.id) === item.id && l.unitType === "bulk"),
                  );
                  const inBasket = currentUnitType === "bulk" ? bulkInQuote : singleInQuote;

                  const draftPriceKey = `${item.id}::${currentUnitType}`;
                  const displayPrice = inBasket
                    ? inBasket.unitPrice
                    : (catalogCustomPrices[draftPriceKey] ?? activeUnit.price);
                  const displayQty = inBasket ? inBasket.quantity : 0;
                  const displayTotal = inBasket
                    ? inBasket.quantity * inBasket.unitPrice
                    : displayPrice;

                  return (
                    <div
                      key={item.id}
                      className={`tc-quote-pos-row${inBasket ? " is-in-basket" : ""}`}
                    >
                      <div className="tc-quote-pos-name-col">
                        <strong className="tc-quote-pos-name" title={name}>
                          {name}
                        </strong>
                        <div className="tc-quote-pos-sub">
                          <span>{activeUnit.unit || (currentUnitType === "bulk" ? "bulk" : "pc")}</span>
                          <span>•</span>
                          <span>
                            {currentUnitType === "bulk"
                              ? activeUnit.stock != null
                                ? `Stock: ${activeUnit.stock} bulk`
                                : "Stock: —"
                              : onHand != null
                                ? `Stock: ${onHand}`
                                : "Stock: —"}
                          </span>
                        </div>
                      </div>

                      <div className="tc-quote-pos-controls">
                        <div className="tc-quote-pos-units" role="group" aria-label="Unit type">
                          <button
                            type="button"
                            className={`tc-quote-pos-unit-btn${currentUnitType === "single" ? " is-active" : ""}`}
                            onClick={() =>
                              setCatalogUnitByItemId((prev) => ({ ...prev, [item.id]: "single" }))
                            }
                          >
                            Single
                          </button>
                          <button
                            type="button"
                            className={`tc-quote-pos-unit-btn${currentUnitType === "bulk" ? " is-active" : ""}`}
                            onClick={() =>
                              setCatalogUnitByItemId((prev) => ({ ...prev, [item.id]: "bulk" }))
                            }
                            title={`Bulk pack: ${bulk.factor} ${single.unit}`}
                          >
                            Bulk
                          </button>
                        </div>

                        <div className="tc-quote-pos-stepper">
                          <button
                            type="button"
                            className="tc-quote-pos-step-btn"
                            disabled={!inBasket}
                            onClick={() => {
                              if (inBasket) {
                                updateItemQty(inBasket.id, inBasket.quantity - 1);
                              }
                            }}
                            aria-label={`Decrease ${name} quantity`}
                          >
                            –
                          </button>
                          <span className="tc-quote-pos-qty">{displayQty}</span>
                          <button
                            type="button"
                            className="tc-quote-pos-step-btn"
                            onClick={() => {
                              if (inBasket) {
                                updateItemQty(inBasket.id, inBasket.quantity + 1);
                              } else {
                                addItemToQuote(item, currentUnitType, displayPrice);
                              }
                            }}
                            aria-label={`Increase ${name} quantity`}
                          >
                            +
                          </button>
                        </div>

                        <div className="tc-quote-pos-price-wrap" title="Unit Price for this quote">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="tc-quote-pos-price-input"
                            value={displayPrice}
                            aria-label={`Price for ${name}`}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              if (inBasket) {
                                updateItemPrice(inBasket.id, val);
                              } else {
                                setCatalogCustomPrices((prev) => ({
                                  ...prev,
                                  [draftPriceKey]: val,
                                }));
                              }
                            }}
                          />
                        </div>

                        <div className="tc-quote-pos-total">
                          KES {displayTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: WhatsApp Live Preview & Actions */}
        <div className="tc-wa-preview-wrap">
          <div className="tc-wa-phone-mockup">
            {/* Phone header */}
            <div className="tc-wa-phone-header">
              <div className="tc-wa-header-left">
                <div className="tc-wa-avatar">
                  <i className="fa-brands fa-whatsapp" aria-hidden />
                </div>
                <div className="tc-wa-contact-info">
                  <span className="tc-wa-contact-name">
                    {customerName.trim() || (customerPhone ? `+${countryDial} ${customerPhone}` : "Customer")}
                  </span>
                  <span className="tc-wa-contact-status">online • WhatsApp</span>
                </div>
              </div>
              <div style={{ color: "#8696a0", fontSize: "0.9rem", display: "flex", gap: "0.75rem" }}>
                <i className="fa-solid fa-phone" aria-hidden />
                <i className="fa-solid fa-ellipsis-vertical" aria-hidden />
              </div>
            </div>

            {/* Chat message body */}
            <div className="tc-wa-chat-body">
              <div className="tc-wa-bubble">
                <pre>{whatsappMessage}</pre>
                <div className="tc-wa-bubble-time">
                  <span>{currentTimeStr}</span>
                  <i className="fa-solid fa-check-double" aria-hidden />
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="tc-wa-actions">
            <button
              type="button"
              id="send-quotation-whatsapp-btn"
              className="tc-wa-btn-primary"
              disabled={quoteItems.length === 0}
              onClick={handleSendWhatsApp}
            >
              <i className="fa-brands fa-whatsapp" style={{ fontSize: "1.2rem" }} aria-hidden />
              Send via WhatsApp
            </button>

            <div className="tc-wa-btn-row">
              <button
                type="button"
                id="copy-quotation-btn"
                className="tc-wa-btn-sub"
                disabled={quoteItems.length === 0}
                onClick={() => void handleCopyQuote()}
              >
                <i className="fa-regular fa-copy" aria-hidden />
                Copy text
              </button>
              <button
                type="button"
                id="print-quotation-btn"
                className="tc-wa-btn-sub"
                disabled={quoteItems.length === 0}
                onClick={handlePrint}
              >
                <i className="fa-solid fa-print" aria-hidden />
                Print slip
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Print Slip View (portalled to body for clean print output) */}
      {typeof document !== "undefined"
        ? createPortal(
            <div className="tc-quote-print-root" aria-hidden="true">
              <div style={{ maxWidth: "600px", margin: "0 auto", padding: "20px", fontFamily: "sans-serif" }}>
                <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "10px", marginBottom: "15px" }}>
                  <h2 style={{ margin: 0 }}>{shopName}</h2>
                  {shopLocation ? <p style={{ margin: "2px 0" }}>{shopLocation}</p> : null}
                  {shopPhone ? <p style={{ margin: "2px 0" }}>Tel: {shopPhone}</p> : null}
                  <h3 style={{ margin: "8px 0 0", letterSpacing: "1px" }}>PRICE QUOTATION</h3>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "15px", fontSize: "14px" }}>
                  <div>
                    <strong>Quotation Ref:</strong> {quoteRef}<br />
                    <strong>Date:</strong> {new Date().toLocaleDateString("en-GB")}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong>Customer:</strong> {customerName || "Walk-in"}<br />
                    {customerPhone ? <span><strong>Phone:</strong> +{countryDial} {customerPhone}</span> : null}
                  </div>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #000", textAlign: "left" }}>
                      <th style={{ padding: "6px 4px" }}>#</th>
                      <th style={{ padding: "6px 4px" }}>Item</th>
                      <th style={{ padding: "6px 4px", textAlign: "right" }}>Qty</th>
                      <th style={{ padding: "6px 4px", textAlign: "right" }}>Unit Price</th>
                      <th style={{ padding: "6px 4px", textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteItems.map((line, idx) => (
                      <tr key={line.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "6px 4px" }}>{idx + 1}</td>
                        <td style={{ padding: "6px 4px" }}>
                          {inventoryProductName(line.item)}
                          {line.unitType === "bulk" ? " [Bulk]" : ""}
                        </td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>{line.quantity} {line.unit}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>KES {line.unitPrice.toLocaleString()}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right" }}>KES {(line.quantity * line.unitPrice).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ textAlign: "right", borderTop: "1px solid #000", paddingTop: "8px", fontSize: "14px", lineHeight: "1.6" }}>
                  <div>Subtotal: KES {subtotal.toLocaleString()}</div>
                  {discountNum > 0 ? <div>Discount: -KES {discountNum.toLocaleString()}</div> : null}
                  <div style={{ fontSize: "16px", fontWeight: "bold" }}>Grand Total: KES {grandTotal.toLocaleString()}</div>
                </div>

                {notes ? (
                  <div style={{ marginTop: "20px", fontSize: "12px", borderTop: "1px dashed #ccc", paddingTop: "10px" }}>
                    <strong>Notes & Terms:</strong>
                    <p style={{ margin: "4px 0" }}>{notes}</p>
                  </div>
                ) : null}

                <div style={{ textAlign: "center", marginTop: "30px", fontSize: "12px", color: "#666" }}>
                  Thank you for your business!
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
