"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatMoney } from "@/lib/orders";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryProductName,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

type Props = {
  value: string;
  amount: string;
  selectedItem: InventoryItem | null;
  onNameChange: (name: string) => void;
  onAmountChange: (amount: string) => void;
  onSelectItem: (item: InventoryItem | null) => void;
  onItemsChange?: (items: InventoryItem[]) => void;
};

export function TransChapProductField({
  value,
  amount,
  selectedItem,
  onNameChange,
  onAmountChange,
  onSelectItem,
  onItemsChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
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
    if (item.selling_price != null) {
      onAmountChange(String(item.selling_price));
    }
    setOpen(false);
  }

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
      <label htmlFor="transact-product">Product</label>
      <input
        id="transact-product"
        type="text"
        role="combobox"
        required
        autoComplete="off"
        placeholder="Search or type a new product"
        className="auth-split__input"
        value={value}
        aria-expanded={open}
        aria-controls="transact-product-list"
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onNameChange(e.target.value);
          onSelectItem(null);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />

      {open ? (
        <ul
          id="transact-product-list"
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
                    {item.selling_price != null
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
    </div>
  );
}
