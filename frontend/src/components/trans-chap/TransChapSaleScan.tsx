"use client";

import { useMemo, useState } from "react";
import { BarcodeCamera } from "@/components/inventory/BarcodeCamera";
import { findInventoryByName, inventoryProductName } from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem } from "@/lib/types";

export type SaleScanLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  unitPrice: number;
};

type Props = {
  active: boolean;
  basket: SaleScanLine[];
  inventory: InventoryItem[];
  inventoryLoading: boolean;
  lastScannedKey: string | null;
  onScan: (code: string) => void;
  onAddProduct: (name: string, item: InventoryItem | null) => void;
  onQty: (key: string, quantity: number) => void;
  onPrice: (key: string, unitPrice: number) => void;
  onCommitPrice: (key: string, unitPrice: number) => void;
  onRemove: (key: string) => void;
  onContinue: () => void;
};

export function TransChapSaleScan({
  active,
  basket,
  inventory,
  inventoryLoading,
  lastScannedKey,
  onScan,
  onAddProduct,
  onQty,
  onPrice,
  onCommitPrice,
  onRemove,
  onContinue,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const total = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [basket],
  );
  const needsPrice = basket.some((line) => line.unitPrice <= 0);
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    return inventory
      .filter((item) => {
        const name = inventoryProductName(item).toLowerCase();
        const sku = (item.product?.sku ?? "").toLowerCase();
        const code = (item.product?.product_code ?? "").toLowerCase();
        return name.includes(text) || sku.includes(text) || code.includes(text);
      })
      .slice(0, 8);
  }, [inventory, query]);

  function addNamed() {
    const name = query.trim();
    if (!name) return;
    onAddProduct(name, findInventoryByName(inventory, name) ?? null);
    setQuery("");
    setSearchOpen(false);
  }

  return (
    <div className="trans-chap-sale-scan">
      <div className="trans-chap-sale-scan__camera">
        <BarcodeCamera active={active} onScan={onScan} />
      </div>

      <div className="trans-chap-sale-scan__list">
        <div className="trans-chap-sale-scan__list-head">
          <p>
            {basket.length
              ? `${basket.length} item${basket.length === 1 ? "" : "s"}`
              : "Scanned products"}
          </p>
          <button
            type="button"
            className="trans-chap-sale-scan__manual"
            onClick={() => setSearchOpen((open) => !open)}
          >
            {searchOpen ? "Hide search" : "Add by name"}
          </button>
        </div>

        {searchOpen ? (
          <div className="trans-chap-sale-scan__search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNamed();
                }
              }}
              placeholder={inventoryLoading ? "Loading inventory…" : "Search inventory"}
              autoComplete="off"
            />
            {query.trim() ? (
              <ul>
                {matches.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAddProduct(inventoryProductName(item), item);
                        setQuery("");
                        setSearchOpen(false);
                      }}
                    >
                      <span>{inventoryProductName(item)}</span>
                      <em>
                        {item.selling_price != null
                          ? formatKsh(item.selling_price)
                          : "No price"}
                      </em>
                    </button>
                  </li>
                ))}
                {!findInventoryByName(inventory, query) ? (
                  <li>
                    <button type="button" onClick={addNamed}>
                      <span>Add “{query.trim()}”</span>
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {basket.length === 0 ? (
          <p className="trans-chap-sale-scan__empty">
            Scan a barcode or add a product from inventory.
          </p>
        ) : (
          <ul className="trans-chap-sale-scan__items">
            {basket.map((line) => (
              <li
                key={line.key}
                className={
                  line.key === lastScannedKey
                    ? "trans-chap-sale-scan__item is-fresh"
                    : "trans-chap-sale-scan__item"
                }
              >
                <div className="trans-chap-sale-scan__item-main">
                  <strong>{line.productName}</strong>
                  <em>
                    {line.unitPrice > 0
                      ? formatKsh(line.quantity * line.unitPrice)
                      : "Set price"}
                  </em>
                </div>
                <div className="trans-chap-sale-scan__item-meta">
                  <div className="trans-chap-sale-scan__qty">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.productName}`}
                      onClick={() => onQty(line.key, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${line.productName}`}
                      onClick={() => onQty(line.key, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <label className="trans-chap-sale-scan__price">
                    <span>KSh</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Price for ${line.productName}`}
                      placeholder="0"
                      value={line.unitPrice > 0 ? String(line.unitPrice) : ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") {
                          onPrice(line.key, 0);
                          return;
                        }
                        const next = Number(raw);
                        if (Number.isFinite(next) && next >= 0) onPrice(line.key, next);
                      }}
                      onBlur={() => {
                        if (line.unitPrice > 0) onCommitPrice(line.key, line.unitPrice);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && line.unitPrice > 0) {
                          e.preventDefault();
                          onCommitPrice(line.key, line.unitPrice);
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="trans-chap-sale-scan__remove"
                    aria-label={`Remove ${line.productName}`}
                    onClick={() => onRemove(line.key)}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="trans-chap-sale-scan__bar">
        {needsPrice ? (
          <p className="trans-chap-sale-scan__hint">Set a price on items that don’t have one.</p>
        ) : null}
        {total > 0 ? (
          <p className="trans-chap-form__total">
            Total <strong>{formatKsh(total)}</strong>
          </p>
        ) : null}
        <button
          type="button"
          className="auth-split__btn"
          disabled={basket.length === 0 || needsPrice}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
