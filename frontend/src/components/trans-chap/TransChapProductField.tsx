"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeScannerSheet } from "@/components/inventory/BarcodeScannerSheet";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastInfo, toastSuccess } from "@/lib/alerts";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import { formatMoney } from "@/lib/orders";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryProductName,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

type Props = {
  fieldId?: string;
  value: string;
  amount: string;
  selectedItem: InventoryItem | null;
  onNameChange: (name: string) => void;
  onAmountChange: (amount: string) => void;
  onSelectItem: (item: InventoryItem | null) => void;
  onItemsChange?: (items: InventoryItem[]) => void;
  fillAmountFrom?: "selling" | "buying" | "none";
  suggestMeta?: "price" | "stock";
};

export function TransChapProductField({
  fieldId = "transact-product",
  value,
  amount,
  selectedItem,
  onNameChange,
  onAmountChange,
  onSelectItem,
  onItemsChange,
  fillAmountFrom = "selling",
  suggestMeta = "price",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<InventoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<InventoryResponse>(`${apiRoutes.inventory}?active=true`)
      .then((res) => {
        if (!alive) return;
        setItems(res.data);
        onItemsChange?.(res.data);
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        onItemsChange?.([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [onItemsChange]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = query
      ? items.filter((item) => {
          const name = inventoryProductName(item).toLowerCase();
          const code = (item.product?.product_code ?? "").toLowerCase();
          const sku = (item.product?.sku ?? "").toLowerCase();
          return (
            name.includes(query) || code.includes(query) || sku.includes(query)
          );
        })
      : items;
    return list.slice(0, 8);
  }, [items, query]);

  const isNewProduct =
    value.trim().length > 0 &&
    !selectedItem &&
    !findInventoryByName(items, value);

  function selectItem(item: InventoryItem) {
    onNameChange(inventoryProductName(item));
    onSelectItem(item);
    if (fillAmountFrom === "buying" && item.buying_price != null) {
      onAmountChange(String(item.buying_price));
    } else if (fillAmountFrom === "selling" && item.selling_price != null) {
      onAmountChange(String(item.selling_price));
    }
    setScanMiss(null);
    setOpen(false);
  }

  const applyScanRef = useRef<(code: string) => void>(() => {});
  applyScanRef.current = (code: string) => {
    const scanned = code.trim();
    if (!scanned) return;
    const item = findInventoryByBarcode(itemsRef.current, scanned);
    setScannerOpen(false);
    if (item) {
      selectItem(item);
      void toastSuccess(`Found ${inventoryProductName(item)}`);
      return;
    }
    setScanMiss(scanned);
    setOpen(true);
    void toastInfo(
      "No matching product",
      `SKU ${scanned} isn’t in inventory. Search by name or add it.`,
    );
  };

  const handleScan = useCallback((code: string) => {
    applyScanRef.current(code);
  }, []);

  async function addNow() {
    const name = value.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const item = await addLiteInventoryProduct(name, amount);
      setItems((prev) => {
        const next = [item, ...prev];
        onItemsChange?.(next);
        return next;
      });
      onNameChange(inventoryProductName(item));
      onSelectItem(item);
      setScanMiss(null);
      setOpen(false);
      await toastSuccess(`Added “${name}”`);
    } catch (err) {
      await showError("Could not add product", extractErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="auth-split__field trans-chap-product" ref={wrapRef}>
      <label htmlFor={fieldId}>Product</label>
      <div className="trans-chap-product__row">
        <div className="trans-chap-input">
        <input
          id={fieldId}
          type="text"
          role="combobox"
          required
          autoComplete="off"
          placeholder="Search, type, or scan a SKU"
          className="auth-split__input"
          value={value}
          aria-expanded={open}
          aria-controls={`${fieldId}-list`}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onNameChange(e.target.value);
            onSelectItem(null);
            setScanMiss(null);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
        </div>
        <button
          type="button"
          className="trans-chap-product__scan"
          aria-label="Scan product SKU"
          title="Scan product SKU"
          disabled={loading}
          onClick={() => {
            setOpen(false);
            setScannerOpen(true);
          }}
        >
          <i className="fa-solid fa-barcode" aria-hidden="true" />
        </button>
      </div>

      {open ? (
        <ul
          id={`${fieldId}-list`}
          className="trans-chap-suggest"
          role="listbox"
          aria-label="Inventory products"
        >
          {loading ? (
            <li className="trans-chap-suggest__empty">Loading inventory…</li>
          ) : matches.length > 0 ? (
            matches.map((item) => (
              <li key={item.id} role="option">
                <button
                  type="button"
                  className="trans-chap-suggest__item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectItem(item)}
                >
                  <span className="trans-chap-suggest__name">
                    {inventoryProductName(item)}
                  </span>
                  <span className="trans-chap-suggest__meta">
                    {suggestMeta === "stock"
                      ? item.stock_quantity == null
                        ? "Not tracked"
                        : `${item.stock_quantity} in stock`
                      : item.selling_price != null
                        ? formatMoney(item.selling_price)
                        : "No price"}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="trans-chap-suggest__empty">
              {query
                ? "No match. Enter the amount and continue — we’ll add it."
                : "Type a name to search or add a product."}
            </li>
          )}
        </ul>
      ) : null}

      {scanMiss && !isNewProduct ? (
        <p className="trans-chap-new">
          <span>No product with SKU {scanMiss}.</span>
        </p>
      ) : null}

      {isNewProduct ? (
        <p className="trans-chap-new">
          <span>Not in inventory. We’ll add it when you continue.</span>
          <button
            type="button"
            className="trans-chap-new__btn"
            disabled={adding}
            onClick={() => void addNow()}
          >
            {adding ? "Adding…" : "Add now"}
          </button>
        </p>
      ) : null}

      <BarcodeScannerSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
        title="Scan product SKU"
      />
    </div>
  );
}
