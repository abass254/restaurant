"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  receiveStock,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export function TransChapPurchaseForm() {
  const router = useRouter();
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);

  const qty = Number(quantity);
  const cost = Number(unitCost);
  const lineTotal =
    Number.isInteger(qty) && qty > 0 && Number.isFinite(cost) && cost >= 0
      ? qty * cost
      : 0;

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const parsedQty = Number(quantity);
    const parsedCost = Number(unitCost);
    if (!name || !Number.isInteger(parsedQty) || parsedQty <= 0) return;
    if (!Number.isFinite(parsedCost) || parsedCost < 0) return;

    setSaving(true);
    try {
      let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
      if (!item) {
        const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
        item = findInventoryByName(fresh.data, name) ?? null;
      }
      if (!item) {
        item = await addLiteInventoryProduct(name, "", {
          buying_price: parsedCost,
          stock_quantity: 0,
        });
      }
      await receiveStock({
        item,
        quantity: parsedQty,
        reason: "receive",
        unitCost: parsedCost,
        note: supplier.trim() || null,
      });
      await toastSuccess("Purchase saved");
      router.push("/trans-chap/purchases");
    } catch (err) {
      await showError("Could not save purchase", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        Stock you bought from a supplier. Adds to inventory and records the cost.
      </p>
      <div className="trans-chap-form__fields">
        <TransChapProductField
          fieldId="purchase-product"
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
          <div className="trans-chap-input">
            <input
              id="purchase-qty"
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
        <div className="auth-split__field">
          <label htmlFor="purchase-cost">Unit cost</label>
          <div className="trans-chap-input">
            <input
              id="purchase-cost"
              type="text"
              required
              inputMode="decimal"
              placeholder="0"
              className="auth-split__input"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </div>
        </div>
        {lineTotal > 0 ? (
          <p className="trans-chap-form__total">
            Total <strong>{formatKsh(lineTotal)}</strong>
          </p>
        ) : null}
        <div className="auth-split__field">
          <label htmlFor="purchase-supplier">Supplier</label>
          <div className="trans-chap-input">
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
      </div>
      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Saving purchase…" : "Save purchase"}
        </button>
      </div>
    </form>
  );
}
