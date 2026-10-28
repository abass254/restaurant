"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { resolveAssetUrl } from "@/lib/config";
import { nairobiDateKey } from "@/lib/nairobi-time";
import {
  createPurchaseOrder,
  fetchSupplyItems,
  formatQty,
  type BuyUnit,
  type SupplyItem,
} from "@/lib/restaurant-supplies";
import { TransChapSupplierField } from "@/components/trans-chap/TransChapSupplierField";
import { addLiteInventoryProduct } from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { fetchShopSuppliers } from "@/lib/trans-chap-suppliers";
import type { ShopSupplier } from "@/lib/types";

type DraftLine = {
  item: SupplyItem;
  unit: string;
  /** Base units per purchase unit; 1 = single, more = bulk. */
  factor: number;
  packInput: string;
  qty: string;
  cost: string;
};

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function lineCents(qty: number, cost: number): number {
  const raw = Math.round(qty * 1000) * Math.round(cost * 100);
  const cents = Math.floor(raw / 1000);
  const rest = raw - cents * 1000;
  return rest > 500 || (rest === 500 && cents % 2 === 1) ? cents + 1 : cents;
}

function defaultCost(unit: BuyUnit | undefined): string {
  return unit?.buying_price != null ? String(round(unit.buying_price, 2)) : "";
}

function nameInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

const PICKER_LIMIT = 30;
const CART_COLLAPSED_KEY = "po:cart_collapsed";

const NEW_SUPPLY_UNITS = ["Pc(s)", "Kg", "L(s)", "Carton", "Bag", "Packet", "Crate", "Tray"] as const;

type NewSupplyDraft = { name: string; unit: string; cost: string };

function stockLabel(item: SupplyItem): { text: string; tone: "ok" | "low" | "none" } {
  if (item.stock_quantity == null) return { text: "Stock not tracked", tone: "none" };
  const text = `${formatQty(item.stock_quantity, item.base_unit)} in stock`;
  return { text, tone: item.is_low_stock || item.stock_quantity <= 0 ? "low" : "ok" };
}

function biggestUnit(item: SupplyItem): BuyUnit | undefined {
  return [...item.buy_units].sort((a, b) => b.factor - a.factor)[0] ?? item.buy_units[0];
}

function baseUnit(item: SupplyItem): BuyUnit {
  return item.buy_units.find((unit) => unit.name.toLowerCase() === item.base_unit.toLowerCase())
    ?? item.buy_units.find((unit) => unit.factor === 1)
    ?? { name: item.base_unit, factor: 1 };
}

function packUnits(item: SupplyItem): BuyUnit[] {
  const base = baseUnit(item);
  return item.buy_units
    .filter((unit) => unit.name.toLowerCase() !== base.name.toLowerCase())
    .sort((a, b) => b.factor - a.factor);
}

/** Pack size from names like "Unga (pack of 24)" or "Water 12pcs". */
function detectPackSize(name: string): number | null {
  const lower = name.toLowerCase();
  const pack = lower.match(/(?:pack|bundle|box|carton|case|crate|bag|tray)\s+(?:of\s+)?(\d+)/);
  if (pack) return Number(pack[1]);
  const pcs = lower.match(/(\d+)\s*(?:pcs|packets|pieces|pkts)/);
  return pcs ? Number(pcs[1]) : null;
}

function bulkLine(line: DraftLine, factor: number, unitName?: string): DraftLine {
  const known = packUnits(line.item).find((unit) =>
    unitName
      ? unit.name.toLowerCase() === unitName.toLowerCase()
      : unit.factor === factor,
  );
  const base = baseUnit(line.item);
  const cost =
    known?.buying_price != null
      ? String(round(known.buying_price, 2))
      : base.buying_price != null
        ? String(round(base.buying_price * factor, 2))
        : line.cost;
  return {
    ...line,
    unit: known?.name ?? unitName ?? `Pack of ${round(factor, 4)}`,
    factor,
    packInput: String(round(factor, 4)),
    cost,
  };
}

function singleLine(line: DraftLine): DraftLine {
  const base = baseUnit(line.item);
  return { ...line, unit: base.name, factor: 1, cost: defaultCost(base) || line.cost };
}

function newLine(item: SupplyItem): DraftLine {
  const base = baseUnit(item);
  const line: DraftLine = { item, unit: base.name, factor: 1, packInput: "", qty: "1", cost: defaultCost(base) };
  // Prefer the biggest pack the shop usually buys (e.g. a 50kg bag over 1 kg).
  const pack = packUnits(item)[0];
  return pack ? bulkLine(line, pack.factor) : line;
}

function Thumb({ src, name, className }: { src?: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={className} aria-hidden="true">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveAssetUrl(src)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className={`${className}-fallback`}>{nameInitial(name)}</span>
      )}
    </div>
  );
}

export function RestaurantPurchaseOrderForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [supplies, setSupplies] = useState<SupplyItem[]>([]);
  const [suppliers, setSuppliers] = useState<ShopSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierName, setSupplierName] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [search, setSearch] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [orderDate, setOrderDate] = useState(() => nairobiDateKey(new Date()));
  const [expectedDate, setExpectedDate] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [receiveNow, setReceiveNow] = useState(false);
  const [paidNow, setPaidNow] = useState("");
  const [saving, setSaving] = useState(false);
  const [newSupply, setNewSupply] = useState<NewSupplyDraft | null>(null);
  const [creatingSupply, setCreatingSupply] = useState(false);
  const [mobileScreen, setMobileScreen] = useState<"catalog" | "supplier">("catalog");
  const [isCartCollapsed, setIsCartCollapsed] = useState(false);

  const toggleCartCollapsed = useCallback(() => {
    setIsCartCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(CART_COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchSupplyItems(), fetchShopSuppliers().catch(() => [] as ShopSupplier[])])
      .then(([items, supplierRows]) => {
        if (!alive) return;
        try {
          if (window.localStorage.getItem(CART_COLLAPSED_KEY) === "1") setIsCartCollapsed(true);
        } catch {}
        setSupplies(items);
        setSuppliers(supplierRows);
        const wanted = (params.get("items") || "").split(",").filter(Boolean);
        if (wanted.length) {
          const picked = items.filter((item) => wanted.includes(item.id));
          setLines(picked.map(newLine));
          const preferred = picked.find((item) => item.preferred_supplier_id)?.preferred_supplier_id;
          const preferredRow = supplierRows.find((s) => s.id === preferred);
          if (preferredRow) setSupplierName(preferredRow.name);
        }
        const paramRow = supplierRows.find((s) => s.id === params.get("supplier"));
        if (paramRow) setSupplierName(paramRow.name);
      })
      .catch((err) => {
        if (alive) void showError("Could not load supplies", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [params]);

  const supplierKey = supplierName.trim().toLowerCase();
  const supplierId = supplierKey
    ? (suppliers.find((s) => s.name.trim().toLowerCase() === supplierKey)?.id ?? "")
    : "";
  const needle = search.trim().toLowerCase();
  const allMatches = useMemo(
    () =>
      supplies
        .filter((item) => !needle || item.name.toLowerCase().includes(needle))
        .sort((a, b) => {
          // Suggest this supplier's usual items first.
          const pa = supplierId && a.preferred_supplier_id === supplierId ? 0 : 1;
          const pb = supplierId && b.preferred_supplier_id === supplierId ? 0 : 1;
          return pa - pb || a.name.localeCompare(b.name);
        }),
    [needle, supplierId, supplies],
  );
  const matches = allMatches.slice(0, PICKER_LIMIT);
  const exactExists = Boolean(needle) && supplies.some((item) => item.name.trim().toLowerCase() === needle);
  const canCreate = Boolean(needle) && !exactExists;

  function startNewSupply() {
    setNewSupply({ name: search.trim(), unit: NEW_SUPPLY_UNITS[0], cost: "" });
  }

  async function createSupply() {
    if (!newSupply || creatingSupply) return;
    const name = newSupply.name.trim();
    if (!name) {
      await showError("Name needed", "Enter the name of the supply.");
      return;
    }
    if (supplies.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())) {
      await showError("Already in inventory", `"${name}" is already a supply. Pick it from the list.`);
      return;
    }
    const cost = parseNumber(newSupply.cost);
    if (newSupply.cost.trim() && (cost == null || cost < 0)) {
      await showError("Buying price", "Enter a buying price of 0 or more, or leave it blank.");
      return;
    }
    setCreatingSupply(true);
    try {
      const created = await addLiteInventoryProduct(name, "", {
        buying_price: cost,
        stock_quantity: 0,
        unit: newSupply.unit,
        inventory_role: "raw_material",
      });
      const items = await fetchSupplyItems();
      setSupplies(items);
      const item = items.find((row) => row.id === created.id);
      if (item) {
        const line = newLine(item);
        setLines((prev) => [...prev, cost != null ? { ...line, cost: String(round(cost, 2)) } : line]);
      }
      setSearch("");
      setNewSupply(null);
      await toastSuccess(`${name} added to your supplies`);
    } catch (err) {
      await showError("Could not create supply", extractErrorMessage(err));
    } finally {
      setCreatingSupply(false);
    }
  }

  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function stepQty(index: number, delta: number) {
    const next = round((parseNumber(lines[index]?.qty ?? "") ?? 0) + delta, 3);
    if (next <= 0) removeLine(index);
    else patchLine(index, { qty: String(next) });
  }

  function updateLine(index: number, update: (line: DraftLine) => DraftLine) {
    setLines((prev) => prev.map((line, i) => (i === index ? update(line) : line)));
  }

  function chooseSingle(index: number) {
    updateLine(index, singleLine);
  }

  function chooseBulk(index: number) {
    updateLine(index, (line) =>
      line.unit.toLowerCase() !== baseUnit(line.item).name.toLowerCase()
        ? line
        : bulkLine(line, packUnits(line.item)[0]?.factor ?? detectPackSize(line.item.name) ?? 12),
    );
  }

  function changePackSize(index: number, value: string) {
    const factor = parseNumber(value);
    updateLine(index, (line) =>
      factor != null && factor > 1 ? bulkLine(line, factor) : { ...line, packInput: value },
    );
  }

  function addItem(item: SupplyItem) {
    const existing = lines.findIndex((line) => line.item.id === item.id);
    if (existing >= 0) stepQty(existing, 1);
    else setLines((prev) => [...prev, newLine(item)]);
  }

  const subtotalCents = lines.reduce(
    (sum, line) => sum + lineCents(parseNumber(line.qty) ?? 0, parseNumber(line.cost) ?? 0),
    0,
  );
  const discountValue = parseNumber(discount) ?? 0;
  const total = Math.max(subtotalCents - Math.round(discountValue * 100), 0) / 100;
  const linesValid =
    lines.length > 0 &&
    lines.every((line) => (parseNumber(line.qty) ?? 0) > 0 && (parseNumber(line.cost) ?? -1) >= 0);
  const paidValue = parseNumber(paidNow);
  const lineCount = lines.length;
  const lineIndexById = new Map(lines.map((line, index) => [line.item.id, index]));

  async function submit(status: "draft" | "ordered", event?: FormEvent) {
    event?.preventDefault();
    if (!linesValid || saving) return;
    setSaving(true);
    try {
      const po = await createPurchaseOrder({
        supplier_id: supplierId || null,
        status,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        supplier_invoice_no: invoiceNo.trim() || null,
        discount: discountValue ? round(discountValue, 2) : null,
        notes: notes.trim() || null,
        receive_now: receiveNow,
        amount_paid: receiveNow && paidValue ? round(Math.min(paidValue, total), 2) : null,
        lines: lines.map((line) => ({
          inventory_item_id: line.item.id,
          quantity: round(parseNumber(line.qty) ?? 0, 3),
          unit_cost: round(parseNumber(line.cost) ?? 0, 2),
          purchase_unit: line.unit,
          unit_factor: line.unit.toLowerCase() !== baseUnit(line.item).name.toLowerCase()
            ? line.factor
            : null,
        })),
      });
      await toastSuccess(
        receiveNow ? `${po.reference} received into stock` : `${po.reference} ${status === "draft" ? "saved as draft" : "ordered"}`,
      );
      router.replace(`/trans-chap/purchases/po?id=${encodeURIComponent(po.id)}`);
    } catch (err) {
      await showError("Could not save purchase order", extractErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="trans-chap-pos-host fb-app">
      <form className="app-panel pos-panel pos-panel--purchase" onSubmit={(event) => void submit("ordered", event)}>
        <div
          className={`pos-grid pos-grid--mobile-${mobileScreen === "supplier" ? "order" : "catalog"}${
            isCartCollapsed ? " is-cart-collapsed" : ""
          }`}
        >
          {mobileScreen === "supplier" ? (
            <div className="pos-mobile-order-nav">
              <button
                type="button"
                className="pos-mobile-order-nav__back"
                onClick={() => {
                  setMobileScreen("catalog");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                <span>Back to supplies</span>
              </button>
              <div className="pos-mobile-order-nav__meta">
                <span className="pos-mobile-order-nav__count">
                  {lineCount} {lineCount === 1 ? "item" : "items"}
                </span>
                <span className="pos-mobile-order-nav__total">{formatKsh(total)}</span>
              </div>
            </div>
          ) : null}

          <div className="pos-main">
            <div className="pos-catalog">
              <header className="pos-catalog__head">
                <h1 className="pos-title">
                  <i className="fa-solid fa-cart-flatbed pos-title__icon" aria-hidden="true" />
                  New purchase order
                </h1>
                <div className="pos-catalog__tools">
                  <label className="pos-search">
                    <i className="fa-solid fa-magnifying-glass pos-search__icon" aria-hidden="true" />
                    <input
                      type="search"
                      value={search}
                      placeholder="Search supplies (flour, oil, soda…)"
                      aria-label="Search supplies"
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (canCreate && !matches.length) startNewSupply();
                      }}
                    />
                    {search ? (
                      <button
                        type="button"
                        className="pos-search__clear"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        <i className="fa-solid fa-xmark" aria-hidden="true" />
                      </button>
                    ) : null}
                  </label>
                  <button
                    type="button"
                    className="pos-card__add pos-purchase-new-btn"
                    onClick={startNewSupply}
                    aria-label="New supply"
                    title="New supply"
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                  </button>
                </div>
              </header>

              {loading ? (
                <div className="pos-empty">
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                  <h3>Loading supplies…</h3>
                </div>
              ) : newSupply ? (
                <div
                  className="rs-new-supply"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
                      e.preventDefault();
                      void createSupply();
                    }
                  }}
                >
                  <p className="rs-card__title">New supply</p>
                  <p className="rs-card__meta">
                    It is added to your inventory as an ingredient with 0 in stock, then put on this order. Stock goes
                    up when the order is received.
                  </p>
                  <div className="rs-new-supply__fields">
                    <label className="rs-field">
                      <span>Name</span>
                      <input
                        className="rs-input"
                        value={newSupply.name}
                        maxLength={255}
                        autoFocus
                        onChange={(e) => setNewSupply((d) => (d ? { ...d, name: e.target.value } : d))}
                      />
                    </label>
                    <label className="rs-field">
                      <span>Unit you count it in</span>
                      <select
                        className="rs-select"
                        value={newSupply.unit}
                        onChange={(e) => setNewSupply((d) => (d ? { ...d, unit: e.target.value } : d))}
                      >
                        {NEW_SUPPLY_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rs-field">
                      <span>Buying price per {newSupply.unit} (optional)</span>
                      <input
                        className="rs-input"
                        inputMode="decimal"
                        placeholder="0"
                        value={newSupply.cost}
                        onChange={(e) => setNewSupply((d) => (d ? { ...d, cost: e.target.value } : d))}
                      />
                    </label>
                  </div>
                  <div className="rs-row">
                    <button
                      type="button"
                      className="rs-btn rs-btn--primary"
                      disabled={creatingSupply || !newSupply.name.trim()}
                      onClick={() => void createSupply()}
                    >
                      {creatingSupply ? "Creating…" : "Create & add to order"}
                    </button>
                    <button
                      type="button"
                      className="rs-btn"
                      disabled={creatingSupply}
                      onClick={() => setNewSupply(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : !needle ? (
                <div className="pos-empty">
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                  <h3>Search for an item to list it here</h3>
                  <p>Can’t find it? Tap + to add it to your inventory as a new supply.</p>
                </div>
              ) : !matches.length ? (
                <div className="pos-empty">
                  <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
                  <h3>No supplies match “{search.trim()}”</h3>
                  <p>Try a different search, or add it as a new supply.</p>
                  {canCreate ? (
                    <button
                      type="button"
                      className="pos-place"
                      style={{ marginTop: "0.75rem", width: "auto" }}
                      onClick={startNewSupply}
                    >
                      Add “{search.trim()}” as new
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {allMatches.length > matches.length ? (
                    <p className="pos-po-hint">
                      Showing {matches.length} of {allMatches.length} · type more to narrow
                    </p>
                  ) : null}
                  <ul className="pos-cards">
                    {matches.map((item) => {
                      const stock = stockLabel(item);
                      const unit = biggestUnit(item);
                      const index = lineIndexById.get(item.id);
                      const line = index != null ? lines[index] : null;
                      const usual = Boolean(supplierId && item.preferred_supplier_id === supplierId);
                      return (
                        <li key={item.id} className={`pos-card${line ? " is-in-cart" : ""}`}>
                          <div className="pos-card__hit">
                            <button
                              type="button"
                              className="pos-card__main"
                              onClick={() => addItem(item)}
                              aria-label={`Add ${item.name} to order`}
                            >
                              <Thumb src={item.image_url} name={item.name} className="pos-card__thumb" />
                              <div className="pos-card__info">
                                <span className="pos-card__name">{item.name}</span>
                                <span className="pos-card__subtitle">
                                  {usual ? "Usual from this supplier" : item.base_unit}
                                </span>
                                <span className="pos-card__price">
                                  {unit?.buying_price != null ? (
                                    <>
                                      <span className="pos-card__price-amount">{formatKsh(unit.buying_price)}</span>
                                      <span className="pos-card__price-unit">/{unit.name}</span>
                                    </>
                                  ) : (
                                    <span className="pos-card__price-unset">Set buying price in order</span>
                                  )}
                                </span>
                                <span className={`pos-card__stock pos-po-stock is-${stock.tone}`}>
                                  {stock.text}
                                  {line ? ` · ${line.qty || 0} ${line.unit} on order` : ""}
                                </span>
                              </div>
                            </button>
                            <div className="pos-card__action">
                              {line && index != null ? (
                                <div className="pos-card__qty" role="group" aria-label={`Quantity of ${item.name}`}>
                                  <button type="button" aria-label="Decrease quantity" onClick={() => stepQty(index, -1)}>
                                    <i className="fa-solid fa-minus" aria-hidden="true" />
                                  </button>
                                  <input
                                    inputMode="decimal"
                                    value={line.qty}
                                    onChange={(e) => patchLine(index, { qty: e.target.value })}
                                    aria-label={`Quantity of ${item.name}`}
                                  />
                                  <button type="button" aria-label="Increase quantity" onClick={() => stepQty(index, 1)}>
                                    <i className="fa-solid fa-plus" aria-hidden="true" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="pos-card__add"
                                  onClick={() => addItem(item)}
                                  aria-label={`Add ${item.name} to order`}
                                >
                                  <i className="fa-solid fa-plus" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>

            <section className={`pos-ticket${lineCount ? " has-lines" : ""}`} aria-label="Order items">
              {lineCount ? (
                <div className="pos-cart__lines pos-ticket__lines">
                  <ul>
                    {lines.map((line, index) => {
                      const base = baseUnit(line.item);
                      const bulk = line.unit.toLowerCase() !== base.name.toLowerCase();
                      const qty = parseNumber(line.qty) ?? 0;
                      const cost = parseNumber(line.cost) ?? 0;
                      const lineTotal = lineCents(qty, cost) / 100;
                      return (
                        <li key={line.item.id} className="pos-line pos-line--purchase pos-line--po">
                          <div className="pos-line__purchase-top">
                            <div className="pos-line__purchase-main">
                              <div className="pos-line__purchase-title-row">
                                <strong className="pos-line__purchase-title" title={line.item.name}>
                                  {line.item.name}
                                </strong>
                                {bulk ? (
                                  <span className="pos-line__bulk-tag">
                                    {line.unit.startsWith("Pack of ")
                                      ? `${line.unit} ${base.name}`
                                      : `${line.unit} (${formatQty(line.factor, base.name)})`}
                                  </span>
                                ) : null}
                              </div>
                              <span className="pos-po-line-meta">
                                {stockLabel(line.item).text}
                                {bulk && qty > 0 ? ` · adds ${formatQty(qty * line.factor, base.name)}` : ""}
                              </span>
                            </div>
                            <div className="pos-line__purchase-end">
                              <strong className="pos-line__purchase-total">
                                {lineTotal > 0 ? formatKsh(lineTotal) : "—"}
                              </strong>
                              <button
                                type="button"
                                className="pos-line__remove"
                                aria-label={`Remove ${line.item.name}`}
                                onClick={() => removeLine(index)}
                              >
                                <i className="fa-solid fa-trash" aria-hidden="true" />
                              </button>
                            </div>
                          </div>

                          <div className="pos-line__purchase-bottom">
                            <div className="pos-line__prices">
                              <label className="pos-line__price-edit">
                                <span className="pos-line__price-label">Buy</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  required
                                  placeholder="0"
                                  value={line.cost}
                                  onChange={(e) => patchLine(index, { cost: e.target.value })}
                                  aria-label={`Cost per ${line.unit} for ${line.item.name}`}
                                />
                              </label>
                              <span className="pos-po-line-meta">per {line.unit}</span>
                            </div>

                            <div className="pos-line__qty-group">
                              <div className="pos-line__auto-pack" role="group" aria-label={`${line.item.name} single or bulk`}>
                                <button
                                  type="button"
                                  className={`pos-line__unit-chip${bulk ? "" : " is-active"}`}
                                  aria-pressed={!bulk}
                                  title={`Buy per ${base.name}`}
                                  onClick={() => chooseSingle(index)}
                                >
                                  Single
                                </button>
                                <button
                                  type="button"
                                  className={`pos-line__unit-chip${bulk ? " is-active" : ""}`}
                                  aria-pressed={bulk}
                                  title="Buy in packs"
                                  onClick={() => chooseBulk(index)}
                                >
                                  Bulk
                                </button>
                                {bulk && packUnits(line.item).length > 0 ? (
                                  <select
                                    className="pos-line__pack-input"
                                    value={line.unit}
                                    aria-label={`Purchase unit for ${line.item.name}`}
                                    onChange={(e) => {
                                      const unit = packUnits(line.item).find((row) => row.name === e.target.value);
                                      if (unit) updateLine(index, (current) => bulkLine(current, unit.factor, unit.name));
                                    }}
                                  >
                                    {!packUnits(line.item).some((unit) => unit.name === line.unit) ? (
                                      <option value={line.unit}>{line.unit}</option>
                                    ) : null}
                                    {packUnits(line.item).map((unit) => (
                                      <option key={unit.name} value={unit.name}>{unit.name}</option>
                                    ))}
                                  </select>
                                ) : bulk ? (
                                  <input
                                    inputMode="decimal"
                                    className="pos-line__pack-input"
                                    value={line.packInput}
                                    onChange={(e) => changePackSize(index, e.target.value)}
                                    title={`${base.name} per pack`}
                                    aria-label={`${base.name} per pack for ${line.item.name}`}
                                  />
                                ) : null}
                              </div>
                              <div className="pos-line__qty">
                                <button type="button" aria-label="Decrease quantity" onClick={() => stepQty(index, -1)}>
                                  <i className="fa-solid fa-minus" aria-hidden="true" />
                                </button>
                                <input
                                  inputMode="decimal"
                                  value={line.qty}
                                  placeholder="0"
                                  onChange={(e) => patchLine(index, { qty: e.target.value })}
                                  aria-label={`Quantity of ${line.item.name}`}
                                />
                                <button type="button" aria-label="Increase quantity" onClick={() => stepQty(index, 1)}>
                                  <i className="fa-solid fa-plus" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>

          <aside
            className={`pos-cart pos-cart--meta${isCartCollapsed ? " pos-cart--collapsed" : ""}`}
            aria-label="Supplier details"
          >
            {isCartCollapsed ? (
              <div
                className="pos-cart__collapsed-bar"
                onClick={toggleCartCollapsed}
                title="Expand supplier details"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleCartCollapsed();
                  }
                }}
              >
                <button
                  type="button"
                  className="pos-cart__expand-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCartCollapsed();
                  }}
                  aria-label="Expand supplier details"
                >
                  <i className="fa-solid fa-angles-left pos-cart__expand-icon-desktop" aria-hidden="true" />
                  <i className="fa-solid fa-angles-down pos-cart__expand-icon-mobile" aria-hidden="true" />
                </button>
                <div className="pos-cart__collapsed-meta">
                  <div className="pos-cart__collapsed-icon">
                    <i className="fa-solid fa-truck-field" aria-hidden="true" />
                  </div>
                  <span className="pos-cart__count">{lineCount}</span>
                </div>
                <div className="pos-cart__collapsed-label">
                  <span>Supplier</span>
                </div>
                {total > 0 ? (
                  <div className="pos-cart__collapsed-amount" title={formatKsh(total)}>
                    <span>{formatKsh(total)}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <header className="pos-cart__head">
                  <h2>
                    <i className="fa-solid fa-truck-field" aria-hidden="true" />
                    Supplier
                    <span className="pos-cart__count">{lineCount === 0 ? "empty" : lineCount}</span>
                  </h2>
                  <div className="pos-cart__actions">
                    {lineCount ? (
                      <button
                        type="button"
                        className="pos-cart__reset"
                        onClick={() => setLines([])}
                        title="Clear order"
                      >
                        <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pos-cart__collapse-btn"
                      onClick={toggleCartCollapsed}
                      aria-label="Collapse supplier details"
                      aria-expanded={!isCartCollapsed}
                    >
                      <i className="fa-solid fa-angles-right pos-cart__collapse-icon-desktop" aria-hidden="true" />
                      <i className="fa-solid fa-angles-up pos-cart__collapse-icon-mobile" aria-hidden="true" />
                    </button>
                  </div>
                </header>

                <div className="pos-cart__body">
                  <div className="pos-cart__row">
                    <span className="pos-label">Supplier</span>
                    <div className="pos-purchase-supplier">
                      <TransChapSupplierField
                        id="po-supplier"
                        value={supplierName}
                        disabled={saving}
                        placeholder="Pick or add a supplier"
                        onChange={setSupplierName}
                        onCreated={(created) =>
                          setSuppliers((prev) => [...prev.filter((s) => s.id !== created.id), created])
                        }
                      />
                    </div>
                  </div>
                  {supplierKey && !supplierId ? (
                    <p className="pos-po-hint">
                      “{supplierName.trim()}” isn’t a saved supplier. Tap + to add it, or this is recorded as a market
                      purchase.
                    </p>
                  ) : !supplierKey ? (
                    <p className="pos-po-hint">
                      Leave empty for a market purchase, or tap + to add a new supplier.
                    </p>
                  ) : null}
                </div>

                <footer className="pos-cart__footer">
                  <div className="pos-cart__row pos-cart__row--pay pos-cart__row--pay-full">
                    <div className="pos-pickers pos-pickers--two" role="radiogroup" aria-label="Order status">
                      {[
                        { received: false, label: "Ordered", icon: "fa-solid fa-clipboard-list" },
                        { received: true, label: "Received", icon: "fa-solid fa-box-open" },
                      ].map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          role="radio"
                          aria-checked={receiveNow === option.received}
                          className={`pos-picker pos-picker--wide${receiveNow === option.received ? " is-active" : ""}`}
                          onClick={() => setReceiveNow(option.received)}
                        >
                          <i className={option.icon} aria-hidden="true" />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pos-fields pos-fields--po">
                    <input
                      className="pos-po-full"
                      type="text"
                      placeholder="Supplier invoice no. (optional)"
                      value={invoiceNo}
                      maxLength={120}
                      disabled={saving}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      aria-label="Supplier invoice number"
                    />
                    <label className="pos-po-field">
                      <span className="pos-label">Order date</span>
                      <input
                        type="date"
                        value={orderDate}
                        disabled={saving}
                        onChange={(e) => setOrderDate(e.target.value)}
                      />
                    </label>
                    {receiveNow ? (
                      <label className="pos-po-field">
                        <span className="pos-label">Paid now (KES)</span>
                        <input
                          inputMode="decimal"
                          value={paidNow}
                          placeholder={total ? String(round(total, 2)) : "0"}
                          disabled={saving}
                          onChange={(e) => setPaidNow(e.target.value)}
                        />
                      </label>
                    ) : (
                      <label className="pos-po-field">
                        <span className="pos-label">Expected delivery</span>
                        <input
                          type="date"
                          value={expectedDate}
                          disabled={saving}
                          onChange={(e) => setExpectedDate(e.target.value)}
                        />
                      </label>
                    )}
                    <input
                      inputMode="decimal"
                      placeholder="Discount (KES)"
                      value={discount}
                      disabled={saving}
                      onChange={(e) => setDiscount(e.target.value)}
                      aria-label="Discount (KES)"
                    />
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={notes}
                      maxLength={2000}
                      disabled={saving}
                      onChange={(e) => setNotes(e.target.value)}
                      aria-label="Notes"
                    />
                  </div>

                  <dl className="pos-totals">
                    <div>
                      <dt>Lines</dt>
                      <dd>{lineCount}</dd>
                    </div>
                    {discountValue > 0 ? (
                      <div>
                        <dt>Discount</dt>
                        <dd>−{formatKsh(discountValue)}</dd>
                      </div>
                    ) : null}
                    <div className="pos-totals__grand">
                      <dt>Total</dt>
                      <dd>{total > 0 ? formatKsh(total) : "—"}</dd>
                    </div>
                  </dl>

                  <button type="submit" className="pos-place" disabled={!linesValid || saving}>
                    {saving ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <span className="pos-place__label">
                          <i className="fa-solid fa-check" aria-hidden="true" />
                          {receiveNow ? "Receive into stock" : "Place order"}
                        </span>
                        <span className="pos-place__total">{total > 0 ? formatKsh(total) : "—"}</span>
                      </>
                    )}
                  </button>
                  {!receiveNow ? (
                    <button
                      type="button"
                      className="pos-po-draft"
                      disabled={!linesValid || saving}
                      onClick={() => void submit("draft")}
                    >
                      Save as draft
                    </button>
                  ) : null}
                </footer>
              </>
            )}
          </aside>

          {mobileScreen === "catalog" && lineCount > 0 ? (
            <div className="pos-mobile-cart-bar">
              <div className="pos-mobile-cart-bar__content">
                <div className="pos-mobile-cart-bar__info">
                  <span className="pos-mobile-cart-bar__badge">
                    <i className="fa-solid fa-cart-flatbed" aria-hidden="true" />
                    <span>{lineCount}</span>
                  </span>
                  <div className="pos-mobile-cart-bar__meta">
                    <span className="pos-mobile-cart-bar__title">Current order</span>
                    <span className="pos-mobile-cart-bar__total">{formatKsh(total)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="pos-mobile-cart-bar__action"
                  onClick={() => {
                    setMobileScreen("supplier");
                    setIsCartCollapsed(false);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <span>Review order</span>
                  <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
