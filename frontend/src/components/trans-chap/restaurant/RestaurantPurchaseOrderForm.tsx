"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { nairobiDateKey } from "@/lib/nairobi-time";
import {
  createPurchaseOrder,
  fetchSupplyItems,
  formatQty,
  type BuyUnit,
  type SupplyItem,
} from "@/lib/restaurant-supplies";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { fetchShopSuppliers } from "@/lib/trans-chap-suppliers";
import type { ShopSupplier } from "@/lib/types";

type DraftLine = {
  item: SupplyItem;
  unit: string;
  qty: string;
  cost: string;
};

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitFor(item: SupplyItem, name: string): BuyUnit {
  return item.buy_units.find((unit) => unit.name === name) ?? item.buy_units[0];
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

function newLine(item: SupplyItem): DraftLine {
  // Prefer the biggest pack the shop usually buys (e.g. a 50kg bag over 1 kg).
  const unit = [...item.buy_units].sort((a, b) => b.factor - a.factor)[0] ?? item.buy_units[0];
  return { item, unit: unit?.name ?? item.base_unit, qty: "", cost: defaultCost(unit) };
}

export function RestaurantPurchaseOrderForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [supplies, setSupplies] = useState<SupplyItem[]>([]);
  const [suppliers, setSuppliers] = useState<ShopSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierId, setSupplierId] = useState("");
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

  useEffect(() => {
    let alive = true;
    Promise.all([fetchSupplyItems(), fetchShopSuppliers().catch(() => [] as ShopSupplier[])])
      .then(([items, supplierRows]) => {
        if (!alive) return;
        setSupplies(items);
        setSuppliers(supplierRows);
        const wanted = (params.get("items") || "").split(",").filter(Boolean);
        if (wanted.length) {
          const picked = items.filter((item) => wanted.includes(item.id));
          setLines(picked.map(newLine));
          const preferred = picked.find((item) => item.preferred_supplier_id)?.preferred_supplier_id;
          if (preferred && supplierRows.some((s) => s.id === preferred)) setSupplierId(preferred);
        }
        const supplierParam = params.get("supplier");
        if (supplierParam && supplierRows.some((s) => s.id === supplierParam)) setSupplierId(supplierParam);
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

  const needle = search.trim().toLowerCase();
  const picked = useMemo(() => new Set(lines.map((line) => line.item.id)), [lines]);
  const matches = useMemo(
    () =>
      supplies
        .filter((item) => !picked.has(item.id))
        .filter((item) => !needle || item.name.toLowerCase().includes(needle))
        .sort((a, b) => {
          // Suggest this supplier's usual items first.
          const pa = supplierId && a.preferred_supplier_id === supplierId ? 0 : 1;
          const pb = supplierId && b.preferred_supplier_id === supplierId ? 0 : 1;
          return pa - pb || a.name.localeCompare(b.name);
        })
        .slice(0, 30),
    [needle, picked, supplierId, supplies],
  );

  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function changeUnit(index: number, name: string) {
    const line = lines[index];
    patchLine(index, { unit: name, cost: defaultCost(unitFor(line.item, name)) || line.cost });
  }

  function addItem(item: SupplyItem) {
    setLines((prev) => [...prev, newLine(item)]);
    setSearch("");
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

  if (loading) return <div className="rs"><p className="rs-empty">Loading supplies…</p></div>;

  return (
    <form className="rs" onSubmit={(event) => void submit("ordered", event)}>
      <div className="rs-card">
        <div className="rs-grid">
          <label className="rs-field">
            <span>Supplier</span>
            <select className="rs-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">No supplier / market</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="rs-field">
            <span>Supplier invoice no.</span>
            <input className="rs-input" value={invoiceNo} maxLength={120} onChange={(e) => setInvoiceNo(e.target.value)} />
          </label>
          <label className="rs-field">
            <span>Order date</span>
            <input className="rs-input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </label>
          {!receiveNow ? (
            <label className="rs-field">
              <span>Expected delivery</span>
              <input className="rs-input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </label>
          ) : null}
        </div>
        {!suppliers.length ? (
          <p className="rs-card__meta">
            <Link href="/trans-chap/suppliers">Add your suppliers</Link> to track what you buy from each and what you owe.
          </p>
        ) : null}
      </div>

      <h3 className="rs-section-title">Supplies</h3>
      {lines.length === 0 ? (
        <p className="rs-empty">Search below to add the supplies you are buying.</p>
      ) : (
        <ul className="rs-list">
          {lines.map((line, index) => {
            const unit = unitFor(line.item, line.unit);
            const qty = parseNumber(line.qty) ?? 0;
            const cost = parseNumber(line.cost) ?? 0;
            return (
              <li key={line.item.id} className="rs-line">
                <div>
                  <p className="rs-card__title">{line.item.name}</p>
                  <p className="rs-card__meta">
                    In stock {formatQty(line.item.stock_quantity, line.item.base_unit)}
                    {unit && unit.factor !== 1 && qty > 0
                      ? ` · adds ${formatQty(qty * unit.factor, line.item.base_unit)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="rs-btn rs-btn--danger rs-btn--small"
                  aria-label={`Remove ${line.item.name}`}
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                >
                  <i className="fa-solid fa-xmark" aria-hidden />
                </button>
                <div className="rs-line__inputs">
                  <label className="rs-field">
                    <span>Unit</span>
                    <select className="rs-select" value={line.unit} onChange={(e) => changeUnit(index, e.target.value)}>
                      {line.item.buy_units.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.factor === 1 ? option.name : `${option.name} (${formatQty(option.factor, line.item.base_unit)})`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="rs-field">
                    <span>Quantity</span>
                    <input
                      className="rs-input"
                      inputMode="decimal"
                      value={line.qty}
                      placeholder="0"
                      onChange={(e) => patchLine(index, { qty: e.target.value })}
                    />
                  </label>
                  <label className="rs-field">
                    <span>Cost per {line.unit}</span>
                    <input
                      className="rs-input"
                      inputMode="decimal"
                      value={line.cost}
                      placeholder="0"
                      onChange={(e) => patchLine(index, { cost: e.target.value })}
                    />
                  </label>
                </div>
                {qty > 0 ? (
                  <p className="rs-card__meta" style={{ gridColumn: "1 / -1" }}>
                    Line total <strong>{formatKsh(lineCents(qty, cost) / 100)}</strong>
                    {unit && unit.factor !== 1 && cost > 0
                      ? ` · ${formatKsh(cost / unit.factor)} per ${line.item.base_unit}`
                      : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <label className="trans-chap-sales__search">
        <i className="fa-solid fa-plus" aria-hidden />
        <input
          type="search"
          value={search}
          placeholder="Add a supply (flour, oil, soda…)"
          aria-label="Add a supply"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {needle || lines.length === 0 ? (
        matches.length ? (
          <div className="rs-picker">
            {matches.map((item) => (
              <button key={item.id} type="button" onClick={() => addItem(item)}>
                <span>
                  {item.name}
                  {supplierId && item.preferred_supplier_id === supplierId ? (
                    <em className="rs-badge rs-badge--info" style={{ marginLeft: 6 }}>Usual</em>
                  ) : null}
                </span>
                <span className="rs-muted">{formatQty(item.stock_quantity, item.base_unit)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rs-card__meta">
            No matching supply. Add it to your inventory first (as an ingredient or a sold item).
          </p>
        )
      ) : null}

      <div className="rs-card">
        <div className="rs-grid">
          <label className="rs-field">
            <span>Discount (KES)</span>
            <input className="rs-input" inputMode="decimal" value={discount} placeholder="0" onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <label className="rs-field">
            <span>Notes</span>
            <input className="rs-input" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <label className="rs-check">
          <input type="checkbox" checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)} />
          The supplies have already arrived — add them to stock now
        </label>
        {receiveNow ? (
          <label className="rs-field">
            <span>Amount paid now (KES)</span>
            <input
              className="rs-input"
              inputMode="decimal"
              value={paidNow}
              placeholder={total ? String(Math.round(total * 100) / 100) : "0"}
              onChange={(e) => setPaidNow(e.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="rs-total-bar">
        <div>
          <p className="rs-card__meta">Total</p>
          <strong className="rs-card__amount">{formatKsh(total)}</strong>
        </div>
        <div className="rs-row">
          {!receiveNow ? (
            <button type="button" className="rs-btn" disabled={!linesValid || saving} onClick={() => void submit("draft")}>
              Save draft
            </button>
          ) : null}
          <button type="submit" className="rs-btn rs-btn--primary" disabled={!linesValid || saving}>
            {saving ? "Saving…" : receiveNow ? "Receive into stock" : "Place order"}
          </button>
        </div>
      </div>
    </form>
  );
}
