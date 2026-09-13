"use client";

import { FormEvent, useCallback, useState } from "react";
import Link from "next/link";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { showError, showInternalError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryProductName,
  isHotelMenuItem,
  receiveStock,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export function TransChapOpeningStockForm() {
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  async function resolveItem(name: string): Promise<InventoryItem | null> {
    let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
    if (!item) {
      const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      item = findInventoryByName(fresh.data, name) ?? null;
      setInventory(fresh.data);
    }
    return item;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const qty = Number(quantity);
    if (!name || !Number.isInteger(qty) || qty <= 0) return;

    setSaving(true);
    try {
      let item = await resolveItem(name);
      if (item && isHotelMenuItem(item)) {
        await showError(
          "Hotel menu",
          "Menu dishes don’t track opening stock. Use Hotel menu for dishes.",
        );
        return;
      }
      if (!item) {
        item = await addLiteInventoryProduct(name, "", { stock_quantity: 0 });
        setInventory((prev) => [...prev, item!]);
      }

      const updated = await receiveStock({
        item,
        quantity: qty,
        reason: "adjustment",
        note: "Opening stock",
      });
      setInventory((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row)),
      );
      setProduct("");
      setQuantity("");
      setSelectedItem(null);
      setSavedCount((n) => n + 1);
      await toastSuccess(
        `${inventoryProductName(updated)} · +${qty}. Add another?`,
      );
    } catch {
      await showInternalError();
    } finally {
      setSaving(false);
    }
  }

  const currentQty =
    selectedItem && selectedItem.stock_quantity != null
      ? selectedItem.stock_quantity
      : null;

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        Record what you already have on hand — scan or search each product, enter the opening
        quantity, then continue to the next.
      </p>
      <div className="trans-chap-form__fields">
        <TransChapProductField
          fieldId="opening-stock-product"
          value={product}
          amount=""
          selectedItem={selectedItem}
          onNameChange={setProduct}
          onAmountChange={() => undefined}
          onSelectItem={setSelectedItem}
          onItemsChange={handleItemsChange}
          fillAmountFrom="none"
          suggestMeta="stock"
        />
        {currentQty != null ? (
          <p className="trans-chap-form__hint">On hand now: {currentQty}</p>
        ) : null}
        <div className="auth-split__field">
          <label htmlFor="opening-stock-qty">Opening quantity</label>
          <div className="trans-chap-input">
            <input
              id="opening-stock-qty"
              type="text"
              required
              inputMode="numeric"
              placeholder="0"
              className="auth-split__input"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="trans-chap-form__actions trans-chap-form__actions--stack">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Saving…" : "Save & continue"}
        </button>
        <p className="trans-chap-form__hint">
          {savedCount > 0 ? (
            <>
              {savedCount} recorded.{" "}
              <Link href="/trans-chap/stocks">Done</Link>
            </>
          ) : (
            <Link href="/trans-chap/stocks">Back to inventory</Link>
          )}
        </p>
      </div>
    </form>
  );
}
