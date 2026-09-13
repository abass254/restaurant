"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TransChapPhotoField } from "@/components/trans-chap/TransChapPhotoField";
import { TransChapProductField } from "@/components/trans-chap/TransChapProductField";
import { apiFetch } from "@/lib/api";
import { showError, showInternalError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  generateInventoryPhoto,
  inventoryCoverUrl,
  isHotelMenuItem,
  receiveStock,
  updateInventorySellingPrice,
  uploadInventoryPhoto,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export function TransChapStockUpForm() {
  const router = useRouter();
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [buyingPrice, setBuyingPrice] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [aiQueued, setAiQueued] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
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

  async function handleGenerateAi() {
    const name = product.trim();
    if (!name) {
      await showError("Product name needed", "Type the product name first, then generate a photo.");
      return;
    }

    const existing = selectedItem ?? findInventoryByName(inventory, name) ?? null;
    if (existing) {
      setGeneratingAi(true);
      try {
        const updated = await generateInventoryPhoto(existing.id, { prompt: name });
        setSelectedItem(updated);
        setInventory((prev) =>
          prev.map((row) => (row.id === updated.id ? updated : row)),
        );
        setPhotoFile(null);
        setAiQueued(false);
        await toastSuccess("Photo generated");
      } catch {
        await showInternalError();
      } finally {
        setGeneratingAi(false);
      }
      return;
    }

    setPhotoFile(null);
    setAiQueued(true);
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
      let item: InventoryItem | null = existing;
      if (bulk) {
        if (!item) {
          item = await addLiteInventoryProduct(name, "", { stock_quantity: 0 });
        }
        await receiveStock({
          item,
          quantity: qty,
          reason: "adjustment",
        });
      } else if (existing) {
        item = existing;
        await receiveStock({
          item: existing,
          quantity: qty,
          reason: "adjustment",
          unitCost: Number.isFinite(cost) && cost >= 0 ? cost : null,
        });
        if (Number.isFinite(sell) && sell > 0) {
          await updateInventorySellingPrice(existing.id, sell);
        }
      } else {
        item = await addLiteInventoryProduct(name, sellingPrice, {
          buying_price: Number.isFinite(cost) && cost >= 0 ? cost : null,
          stock_quantity: qty,
        });
      }
      if (item && photoFile) {
        try {
          await uploadInventoryPhoto(item.id, photoFile);
        } catch {
          await showInternalError();
          if (!bulk) router.push("/trans-chap/stocks");
          return;
        }
      } else if (item && aiQueued) {
        try {
          await generateInventoryPhoto(item.id, { prompt: name });
        } catch {
          await showInternalError();
          if (!bulk) router.push("/trans-chap/stocks");
          return;
        }
      }
      if (bulk) {
        setProduct("");
        setQuantity("");
        setPhotoFile(null);
        setAiQueued(false);
        setSelectedItem(null);
        await toastSuccess("Stock added. Add another?");
      } else {
        await toastSuccess(existing ? "Stock added" : "Product added");
        router.push("/trans-chap/stocks");
      }
    } catch {
      await showInternalError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        {bulk
          ? "Scan or search products and add units, one after another. Go back to Inventory when you’re done."
          : "Type the product name, add a photo if you have one, then quantity and prices."}
      </p>
      <div className="trans-chap-form__fields">
        {bulk ? (
          <TransChapProductField
            fieldId="stock-up-product"
            value={product}
            amount=""
            selectedItem={selectedItem}
            onNameChange={(value) => {
              setProduct(value);
              setAiQueued(false);
            }}
            onAmountChange={() => undefined}
            onSelectItem={(item) => {
              setSelectedItem(item);
              setAiQueued(false);
            }}
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
                  setAiQueued(false);
                }}
              />
            </div>
          </div>
        )}
        <TransChapPhotoField
          existingUrl={selectedItem ? inventoryCoverUrl(selectedItem) : null}
          file={photoFile}
          onFileChange={setPhotoFile}
          disabled={saving || generatingAi}
          onGenerateAi={() => void handleGenerateAi()}
          generatingAi={generatingAi}
          aiQueued={aiQueued}
          onClearAiQueue={() => setAiQueued(false)}
        />
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
        <button type="submit" className="auth-split__btn" disabled={saving || generatingAi}>
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
