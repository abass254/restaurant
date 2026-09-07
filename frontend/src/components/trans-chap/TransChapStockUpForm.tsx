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
  isHotelMenuItem,
  receiveStock,
  updateInventorySellingPrice,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export function TransChapStockUpForm() {
  const router = useRouter();
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [buyingPrice, setBuyingPrice] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState(false);

  const handleItemsChange = useCallback((items: InventoryItem[]) => {
    setInventory(items);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBulk(params.get("mode") === "bulk");
    const name = params.get("product");
    if (name?.trim()) {
      setProduct(name.trim());
    }
  }, []);

  useEffect(() => {
    if (bulk) return;
    let alive = true;
    apiFetch<InventoryResponse>(apiRoutes.inventory)
      .then((data) => {
        if (!alive) return;
        setInventory(data.data);
      })
      .catch(() => {
        if (!alive) return;
        setInventory([]);
      });
    return () => {
      alive = false;
    };
  }, [bulk]);

  useEffect(() => {
    if (!product.trim() || selectedItem) return;
    const match = findInventoryByName(inventory, product);
    if (match) setSelectedItem(match);
  }, [inventory, product, selectedItem]);

  async function resolveItem(name: string): Promise<InventoryItem | null> {
    let item = selectedItem ?? findInventoryByName(inventory, name) ?? null;
    if (!item) {
      const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      item = findInventoryByName(fresh.data, name) ?? null;
    }
    return item;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = product.trim();
    const qty = Number(quantity);
    if (!name || !Number.isInteger(qty) || qty <= 0) return;

    const sell = Number(sellingPrice);
    const cost = Number(buyingPrice);
    if (!bulk) {
      if (!Number.isFinite(sell) || sell <= 0) return;
    }

    setSaving(true);
    try {
      const existing = await resolveItem(name);
      if (existing && isHotelMenuItem(existing)) {
        await showError(
          "Hotel menu",
          "Menu dishes can’t be stocked up. Change the price from Hotel menu.",
        );
        return;
      }
      if (bulk) {
        let item = existing;
        if (!item) {
          item = await addLiteInventoryProduct(name, "", { stock_quantity: 0 });
        }
        await receiveStock({
          item,
          quantity: qty,
          reason: "adjustment",
        });
        setProduct("");
        setQuantity("");
        setSelectedItem(null);
        await toastSuccess("Stock added. Add another?");
      } else {
        if (existing) {
          await receiveStock({
            item: existing,
            quantity: qty,
            reason: "adjustment",
            unitCost: Number.isFinite(cost) && cost >= 0 ? cost : null,
          });
          if (Number.isFinite(sell) && sell > 0) {
            await updateInventorySellingPrice(existing.id, sell);
          }
          await toastSuccess("Stock added");
        } else {
          await addLiteInventoryProduct(name, sellingPrice, {
            buying_price: Number.isFinite(cost) && cost >= 0 ? cost : null,
            stock_quantity: qty,
          });
          await toastSuccess("Product added");
        }
        router.push("/trans-chap/stocks");
      }
    } catch (err) {
      await showError(
        bulk ? "Could not add stock" : "Could not add product",
        extractErrorMessage(err),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        {bulk
          ? "Scan or search products and add units, one after another. Go back to Inventory when you’re done."
          : "Type the product name, quantity, and prices. We’ll add it to inventory."}
      </p>
      <div className="trans-chap-form__fields">
        {bulk ? (
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
        ) : (
          <div className="auth-split__field">
            <label htmlFor="stock-up-product">Product name</label>
            <div className="trans-chap-input">
              <input
                id="stock-up-product"
                type="text"
                required
                autoComplete="off"
                placeholder="e.g. Coca-Cola 500ml"
                className="auth-split__input"
                value={product}
                onChange={(event) => {
                  setProduct(event.target.value);
                  setSelectedItem(null);
                }}
              />
            </div>
          </div>
        )}
        <div className="auth-split__field">
          <label htmlFor="stock-up-qty">{bulk ? "Quantity to add" : "Quantity"}</label>
          <div className="trans-chap-input">
            <input
              id="stock-up-qty"
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
        {bulk ? null : (
          <div className="trans-chap-form__row">
            <div className="auth-split__field">
              <label htmlFor="stock-up-sell">Selling price</label>
              <div className="trans-chap-input">
                <input
                  id="stock-up-sell"
                  type="text"
                  required
                  inputMode="decimal"
                  placeholder="0"
                  className="auth-split__input"
                  value={sellingPrice}
                  onChange={(event) => setSellingPrice(event.target.value)}
                />
              </div>
            </div>
            <div className="auth-split__field">
              <label htmlFor="stock-up-buy">Buying price</label>
              <div className="trans-chap-input">
                <input
                  id="stock-up-buy"
                  type="text"
                  inputMode="decimal"
                  placeholder="Optional"
                  className="auth-split__input"
                  value={buyingPrice}
                  onChange={(event) => setBuyingPrice(event.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving
            ? bulk
              ? "Adding stock…"
              : "Adding product…"
            : bulk
              ? "Add & continue"
              : "Add to inventory"}
        </button>
      </div>
    </form>
  );
}
