"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  addInventoryQuantity,
  addLiteInventoryProduct,
  findInventoryByName,
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
        await addLiteInventoryProduct(name, "", { stock_quantity: qty });
      } else {
        await addInventoryQuantity(item, qty);
      }
      router.push("/trans-chap/stocks");
    } catch (err) {
      await showError("Could not add stock", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="trans-chap-form__fields">
        <TransChapProductField
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
          <input
            id="stock-up-qty"
            type="number"
            required
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="0"
            className="auth-split__input"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
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
