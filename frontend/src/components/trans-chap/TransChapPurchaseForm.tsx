"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  addInventoryQuantity,
  addLiteInventoryProduct,
  findInventoryByName,
} from "@/lib/trans-chap-product";
import { saveTransChapPurchase } from "@/lib/trans-chap-purchases";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export function TransChapPurchaseForm() {
  const router = useRouter();
  const user = useAuthUser();
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const shopId = user.active_account?.id || user.account?.id || "local";

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const qty = Number(quantity);
    const cost = Number(unitCost);
    if (!name || !Number.isInteger(qty) || qty <= 0) return;
    if (!Number.isFinite(cost) || cost < 0) return;

    setSaving(true);
    try {
      let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
      if (!item) {
        const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
        item = findInventoryByName(fresh.data, name) ?? null;
      }
      if (!item) {
        item = await addLiteInventoryProduct(name, "", {
          buying_price: cost,
          stock_quantity: qty,
        });
      } else {
        item = await addInventoryQuantity(item, qty, { buying_price: cost });
      }

      saveTransChapPurchase(shopId, {
        id: `pur-${Date.now()}`,
        productName: name,
        inventoryItemId: item.id,
        quantity: qty,
        unitCost: cost,
        total: qty * cost,
        supplier: supplier.trim() || null,
        paidAt: new Date().toISOString(),
      });
      router.push("/trans-chap/purchases");
    } catch (err) {
      await showError("Could not save purchase", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="trans-chap-form__fields">
        <TransChapProductField
          value={product}
          amount={unitCost}
          selectedItem={selectedItem}
          onNameChange={setProduct}
          onAmountChange={setUnitCost}
          onSelectItem={setSelectedItem}
          onItemsChange={handleItemsChange}
          fillAmountFrom="buying"
          suggestMeta="stock"
        />
        <div className="auth-split__field">
          <label htmlFor="purchase-qty">Quantity</label>
          <input
            id="purchase-qty"
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
        <div className="auth-split__field">
          <label htmlFor="purchase-cost">Unit cost</label>
          <input
            id="purchase-cost"
            type="number"
            required
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0"
            className="auth-split__input"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
        </div>
        <div className="auth-split__field">
          <label htmlFor="purchase-supplier">Supplier</label>
          <input
            id="purchase-supplier"
            type="text"
            autoComplete="organization"
            placeholder="Optional"
            className="auth-split__input"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </div>
      </div>
      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Saving purchase…" : "Save purchase"}
        </button>
      </div>
    </form>
  );
}
