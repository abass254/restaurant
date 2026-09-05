"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  receiveStock,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export function TransChapStockUpForm() {
  const router = useRouter();
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("product");
    if (name?.trim()) {
      setProduct(name.trim());
    }
  }, []);

  useEffect(() => {
    if (!product.trim() || selectedItem) return;
    const match = findInventoryByName(inventory, product);
    if (match) setSelectedItem(match);
  }, [inventory, product, selectedItem]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const qty = Number(quantity);
    if (!name || !Number.isInteger(qty) || qty <= 0) return;

    setSaving(true);
    try {
      let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
      if (!item) {
        const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
        item = findInventoryByName(fresh.data, name) ?? null;
      }
      if (!item) {
        item = await addLiteInventoryProduct(name, "", { stock_quantity: 0 });
      }
      await receiveStock({
        item,
        quantity: qty,
        reason: "adjustment",
      });
      await toastSuccess("Stock added");
      router.push("/trans-chap/stocks");
    } catch (err) {
      await showError("Could not add stock", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        Add units you already have. Does not record a purchase or cost.
      </p>
      <div className="trans-chap-form__fields">
        <TransChapProductField
          fieldId="stock-up-product"
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
        <div className="auth-split__field">
          <label htmlFor="stock-up-qty">Quantity to add</label>
          <div className="trans-chap-input">
            <input
              id="stock-up-qty"
              type="text"
              required
              inputMode="numeric"
              placeholder="0"
              className="auth-split__input"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Adding stock…" : "Add stock"}
        </button>
      </div>
    </form>
  );
}
