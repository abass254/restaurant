"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  updateInventorySellingPrice,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

const MENU_DISHES = [
  "Chapati",
  "Ugali",
  "Rice",
  "Chips",
  "Beef stew",
  "Chicken",
  "Fish",
  "Sukuma",
  "Beans",
  "Pilau",
  "Mandazi",
  "Samosa",
  "Chai",
  "Coffee",
  "Soda",
  "Juice",
  "Water",
] as const;

export function TransChapMenuForm() {
  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const dish = name.trim();
    const sell = Number(sellingPrice);
    if (!dish || !Number.isFinite(sell) || sell <= 0) return;

    setSaving(true);
    try {
      let items = inventory;
      let existing = findInventoryByName(items, dish) ?? null;
      if (!existing) {
        const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
        items = fresh.data;
        existing = findInventoryByName(items, dish) ?? null;
      }

      if (existing) {
        const updated = await updateInventorySellingPrice(existing.id, sell);
        setInventory(
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        const created = await addLiteInventoryProduct(dish, sellingPrice, {
          category: "food_beverage",
        });
        setInventory([...items, created]);
      }

      setName("");
      setSellingPrice("");
      await toastSuccess("Dish added. Add another?");
    } catch (err) {
      await showError("Could not add dish", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-split__form trans-chap-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="trans-chap-form__lead">
        Type a dish name and selling price, or tap a common item. We’ll add it to
        inventory so you can sell it — no quantity to count.
      </p>
      <div className="trans-chap-form__fields">
        <div className="auth-split__field">
          <label htmlFor="menu-dish">Dish name</label>
          <div className="trans-chap-input">
            <input
              id="menu-dish"
              type="text"
              required
              autoComplete="off"
              placeholder="e.g. Chapati"
              className="auth-split__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>
        <div className="trans-chap-form__chips" role="group" aria-label="Common dishes">
          {MENU_DISHES.map((dish) => {
            const active = name.trim().toLowerCase() === dish.toLowerCase();
            return (
              <button
                key={dish}
                type="button"
                className={`trans-chap-form__chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => setName(dish)}
              >
                {dish}
              </button>
            );
          })}
        </div>
        <div className="auth-split__field">
          <label htmlFor="menu-sell">Selling price</label>
          <div className="trans-chap-input">
            <input
              id="menu-sell"
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
      </div>
      <div className="trans-chap-form__actions">
        <button type="submit" className="auth-split__btn" disabled={saving}>
          {saving ? "Adding dish…" : "Add & continue"}
        </button>
      </div>
    </form>
  );
}
