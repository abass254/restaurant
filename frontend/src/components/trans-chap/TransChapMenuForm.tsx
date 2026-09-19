"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { showInternalError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  addLiteInventoryProduct,
  findInventoryByName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  updateInventoryItem,
  updateInventorySellingPrice,
} from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

export type DishCategory = "all" | "mains" | "bites" | "hot_drinks" | "cold_drinks";

interface DishPreset {
  name: string;
  category: "mains" | "bites" | "hot_drinks" | "cold_drinks";
  suggestedPrice: number;
  icon: string;
}

const CATEGORY_TABS: { id: DishCategory; label: string; icon: string }[] = [
  { id: "all", label: "All Popular", icon: "fa-fire" },
  { id: "mains", label: "Mains & Stews", icon: "fa-bowl-rice" },
  { id: "bites", label: "Bites & Snacks", icon: "fa-bread-slice" },
  { id: "hot_drinks", label: "Hot Drinks", icon: "fa-mug-hot" },
  { id: "cold_drinks", label: "Cold Drinks", icon: "fa-wine-bottle" },
];

const CATEGORY_LABELS: Record<string, string> = {
  mains: "Mains & Stews",
  bites: "Bites & Snacks",
  hot_drinks: "Hot Drinks",
  cold_drinks: "Cold Drinks",
};

const PRESET_DISHES: DishPreset[] = [
  // Mains & Stews
  { name: "Chapati", category: "mains", suggestedPrice: 20, icon: "fa-circle-dot" },
  { name: "Ugali", category: "mains", suggestedPrice: 50, icon: "fa-bowl-rice" },
  { name: "Rice", category: "mains", suggestedPrice: 70, icon: "fa-bowl-rice" },
  { name: "Pilau", category: "mains", suggestedPrice: 150, icon: "fa-bowl-food" },
  { name: "Beef stew", category: "mains", suggestedPrice: 180, icon: "fa-drumstick-bite" },
  { name: "Chicken", category: "mains", suggestedPrice: 250, icon: "fa-drumstick-bite" },
  { name: "Fish", category: "mains", suggestedPrice: 250, icon: "fa-fish" },
  { name: "Beans", category: "mains", suggestedPrice: 70, icon: "fa-seedling" },
  { name: "Sukuma", category: "mains", suggestedPrice: 50, icon: "fa-leaf" },
  { name: "Githeri", category: "mains", suggestedPrice: 80, icon: "fa-bowl-food" },
  { name: "Matoke", category: "mains", suggestedPrice: 120, icon: "fa-bowl-food" },
  { name: "Mukimo", category: "mains", suggestedPrice: 130, icon: "fa-bowl-food" },

  // Bites & Snacks
  { name: "Chips", category: "bites", suggestedPrice: 100, icon: "fa-fire-burner" },
  { name: "Mandazi", category: "bites", suggestedPrice: 20, icon: "fa-bread-slice" },
  { name: "Samosa", category: "bites", suggestedPrice: 40, icon: "fa-play" },
  { name: "Sausage", category: "bites", suggestedPrice: 50, icon: "fa-hotdog" },
  { name: "Smokies", category: "bites", suggestedPrice: 40, icon: "fa-hotdog" },
  { name: "Fried Egg", category: "bites", suggestedPrice: 30, icon: "fa-egg" },
  { name: "Boiled Egg", category: "bites", suggestedPrice: 25, icon: "fa-egg" },
  { name: "Toast", category: "bites", suggestedPrice: 30, icon: "fa-bread-slice" },
  { name: "Kebab", category: "bites", suggestedPrice: 80, icon: "fa-drumstick-bite" },

  // Hot Drinks
  { name: "Chai (Tea)", category: "hot_drinks", suggestedPrice: 30, icon: "fa-mug-hot" },
  { name: "Special Chai", category: "hot_drinks", suggestedPrice: 50, icon: "fa-mug-hot" },
  { name: "White Coffee", category: "hot_drinks", suggestedPrice: 50, icon: "fa-coffee" },
  { name: "Black Coffee", category: "hot_drinks", suggestedPrice: 30, icon: "fa-coffee" },
  { name: "Lemon Tea", category: "hot_drinks", suggestedPrice: 40, icon: "fa-mug-hot" },
  { name: "Dawa", category: "hot_drinks", suggestedPrice: 70, icon: "fa-mug-saucer" },
  { name: "Hot Chocolate", category: "hot_drinks", suggestedPrice: 60, icon: "fa-mug-saucer" },

  // Cold Drinks
  { name: "Soda 300ml", category: "cold_drinks", suggestedPrice: 50, icon: "fa-bottle-droplet" },
  { name: "Soda 500ml", category: "cold_drinks", suggestedPrice: 70, icon: "fa-bottle-droplet" },
  { name: "Fresh Juice", category: "cold_drinks", suggestedPrice: 100, icon: "fa-glass-water" },
  { name: "Water 500ml", category: "cold_drinks", suggestedPrice: 30, icon: "fa-bottle-water" },
  { name: "Water 1L", category: "cold_drinks", suggestedPrice: 60, icon: "fa-bottle-water" },
  { name: "Energy Drink", category: "cold_drinks", suggestedPrice: 100, icon: "fa-bolt" },
];

const PRICE_SHORTCUTS = [20, 30, 40, 50, 70, 80, 100, 120, 150, 180, 200, 250, 300];

export function TransChapMenuForm() {
  const [activeCategory, setActiveCategory] = useState<DishCategory>("all");
  const [search, setSearch] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sessionAddedCount, setSessionAddedCount] = useState(0);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalName, setModalName] = useState("");
  const [modalPrice, setModalPrice] = useState("");
  const [modalCategory, setModalCategory] = useState<"mains" | "bites" | "hot_drinks" | "cold_drinks">("mains");
  const [modalIcon, setModalIcon] = useState("fa-utensils");
  const [saving, setSaving] = useState(false);

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);

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

  // Track which dishes already exist in inventory
  const existingDishesMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory) {
      if (item.is_active && isHotelMenuItem(item) && isSaleableRole(inventoryRole(item))) {
        const n = (item.product?.name || "").trim().toLowerCase();
        if (n) {
          map.set(n, item.selling_price ?? 0);
        }
      }
    }
    return map;
  }, [inventory]);

  // Filter presets by active category and search
  const visiblePresets = useMemo(() => {
    let list = PRESET_DISHES;
    if (activeCategory !== "all") {
      list = list.filter((dish) => dish.category === activeCategory);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((dish) => dish.name.toLowerCase().includes(q));
    }
    return list;
  }, [activeCategory, search]);

  // Check if search query matches an exact preset
  const searchMatchesExactPreset = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return PRESET_DISHES.some((dish) => dish.name.toLowerCase() === q);
  }, [search]);

  // Open modal for a preset dish
  function handleOpenPresetModal(preset: DishPreset) {
    const existingPrice = existingDishesMap.get(preset.name.toLowerCase());
    setModalName(preset.name);
    setModalPrice(String(existingPrice || preset.suggestedPrice));
    setModalCategory(preset.category);
    setModalIcon(preset.icon);
    setModalOpen(true);
    setTimeout(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    }, 80);
  }

  // Open modal for a custom dish
  function handleOpenCustomModal(prefilledName = "") {
    setModalName(prefilledName);
    setModalPrice("");
    setModalCategory(activeCategory === "all" ? "mains" : activeCategory);
    setModalIcon("fa-utensils");
    setModalOpen(true);
    setTimeout(() => {
      if (!prefilledName.trim()) {
        nameInputRef.current?.focus();
      } else {
        priceInputRef.current?.focus();
      }
    }, 80);
  }

  // Submit dish to menu
  async function handleModalSubmit(event?: FormEvent) {
    if (event) event.preventDefault();
    const dish = modalName.trim();
    const sell = Number(modalPrice);
    if (!dish || !Number.isFinite(sell) || sell <= 0 || saving) return;

    setSaving(true);
    try {
      let items = inventory;
      let existing = findInventoryByName(items, dish) ?? null;
      if (!existing) {
        const fresh = await apiFetch<InventoryResponse>(apiRoutes.inventory);
        items = fresh.data;
        existing = findInventoryByName(items, dish) ?? null;
      }

      if (!existing) {
        const created = await addLiteInventoryProduct(dish, String(sell), {
          category: "food_beverage",
          stock_quantity: null,
          inventory_role: "for_sale",
        });
        setInventory((prev) => [...prev, created]);
      } else if (
        inventoryRole(existing) !== "for_sale" ||
        existing.stock_quantity != null
      ) {
        const patched = await updateInventoryItem(existing.id, {
          inventory_role: "for_sale",
          stock_quantity: null,
          selling_price: sell,
        });
        setInventory((prev) =>
          prev.map((item) => (item.id === patched.id ? patched : item)),
        );
      } else {
        const updated = await updateInventorySellingPrice(existing.id, sell);
        setInventory((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      }

      setSessionAddedCount((prev) => prev + 1);
      setModalOpen(false);
      setSearch("");
      await toastSuccess(`"${dish}" added at ${formatKsh(sell)}!`);
    } catch {
      await showInternalError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-panel">
      <div
        className="pos-grid"
        style={{
          gridTemplateColumns: "1fr",
          maxWidth: "1080px",
          margin: "0 auto",
          paddingBottom: "4rem",
        }}
      >
        <div className="pos-main">
          <div className="pos-catalog">
            {/* Catalog Head: Search bar & "+ Custom" button */}
            <header className="pos-catalog__head">
              <div className="pos-menu-tools-row">
                <label className="pos-search">
                  <i
                    className="fa-solid fa-magnifying-glass pos-search__icon"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    placeholder="Search dishes or type custom dish…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                  {search ? (
                    <button
                      type="button"
                      className="pos-search__clear"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  ) : null}
                </label>

                <button
                  type="button"
                  className="pos-menu-custom-btn"
                  onClick={() => handleOpenCustomModal(search.trim())}
                >
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                  <span>Custom Dish</span>
                </button>
              </div>
            </header>

            {/* Horizontal Category Filter Chips */}
            <div
              className="pos-category-chips"
              role="tablist"
              aria-label="Filter dishes by category"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeCategory === "all"}
                className={`pos-category-chip${activeCategory === "all" ? " is-active" : ""}`}
                onClick={() => setActiveCategory("all")}
              >
                <i className="fa-solid fa-layer-group" aria-hidden="true" />
                <span>All ({PRESET_DISHES.length})</span>
              </button>

              {CATEGORY_TABS.filter((t) => t.id !== "all").map((tab) => {
                const count = PRESET_DISHES.filter((d) => d.category === tab.id).length;
                const isActive = activeCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`pos-category-chip${isActive ? " is-active" : ""}`}
                    onClick={() => setActiveCategory(tab.id)}
                  >
                    <i className={`fa-solid ${tab.icon}`} aria-hidden="true" />
                    <span>{tab.label}</span>
                    <span className="pos-category-chip__count">{count}</span>
                  </button>
                );
              })}

              {sessionAddedCount > 0 ? (
                <span className="pos-menu-stats-pill">
                  <i className="fa-solid fa-circle-check" aria-hidden="true" />
                  <span>{sessionAddedCount} added this session</span>
                </span>
              ) : null}
            </div>

            {/* Banner when searching for a dish that doesn't match an exact preset */}
            {search.trim() && !searchMatchesExactPreset ? (
              <div
                className="pos-menu-search-prompt"
                onClick={() => handleOpenCustomModal(search.trim())}
                role="button"
                tabIndex={0}
              >
                <div className="pos-menu-search-prompt__meta">
                  <div className="pos-menu-search-prompt__icon">
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                  </div>
                  <div>
                    <strong className="pos-menu-search-prompt__name">
                      Add &ldquo;{search.trim()}&rdquo; to Menu
                    </strong>
                    <span className="pos-menu-search-prompt__hint">
                      Tap to set price and save as new menu item
                    </span>
                  </div>
                </div>
                <span className="pos-menu-search-prompt__action">
                  Set Price &rarr;
                </span>
              </div>
            ) : null}

            {/* Dish Cards Grid: 2 columns on mobile, auto-fill on desktop */}
            <ul className="pos-cards" role="list">
              {/* Card 1: Custom Dish card */}
              <li className="pos-card pos-card--custom">
                <div className="pos-card__hit">
                  <button
                    type="button"
                    className="pos-card__main"
                    onClick={() => handleOpenCustomModal(search.trim())}
                  >
                    <div
                      className="pos-card__thumb"
                      style={{
                        background:
                          "color-mix(in srgb, var(--app-primary) 10%, var(--app-surface))",
                      }}
                    >
                      <div
                        className="pos-card__thumb-fallback"
                        style={{ color: "var(--app-primary)" }}
                      >
                        <i
                          className="fa-solid fa-circle-plus"
                          aria-hidden="true"
                          style={{ fontSize: "2rem" }}
                        />
                      </div>
                    </div>
                    <div className="pos-card__info">
                      <span
                        className="pos-card__dish-tag"
                        style={{
                          background: "var(--app-primary)",
                          color: "#ffffff",
                        }}
                      >
                        Custom
                      </span>
                      <strong className="pos-card__name">Add Custom Dish</strong>
                      <div className="pos-card__price">
                        <span className="pos-card__price-unit">
                          Any name & price
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              </li>

              {/* Preset Cards */}
              {visiblePresets.map((dish) => {
                const isAdded = existingDishesMap.has(dish.name.toLowerCase());
                const currentPrice = existingDishesMap.get(dish.name.toLowerCase());
                const displayPrice = isAdded && currentPrice ? currentPrice : dish.suggestedPrice;

                return (
                  <li
                    key={dish.name}
                    className={`pos-card${isAdded ? " is-in-cart" : ""}`}
                  >
                    <div className="pos-card__hit">
                      <button
                        type="button"
                        className="pos-card__main"
                        onClick={() => handleOpenPresetModal(dish)}
                      >
                        <div className="pos-card__thumb">
                          <div className="pos-card__thumb-fallback">
                            <i className={`fa-solid ${dish.icon}`} aria-hidden="true" />
                          </div>
                          {isAdded ? (
                            <span className="pos-card__in-cart-badge">
                              <i className="fa-solid fa-check" aria-hidden="true" /> On Menu
                            </span>
                          ) : null}
                        </div>
                        <div className="pos-card__info">
                          <span className="pos-card__dish-tag">
                            {CATEGORY_LABELS[dish.category] || dish.category}
                          </span>
                          <strong className="pos-card__name">{dish.name}</strong>
                          <div className="pos-card__price">
                            <span className="pos-card__price-amount">
                              KES {displayPrice}
                            </span>
                            <span className="pos-card__price-unit">
                              {isAdded ? "current" : "suggested"}
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* POS Menu Add/Edit Bottom-Sheet (Mobile) & Modal (Desktop) */}
      {modalOpen ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => setModalOpen(false)}
          role="presentation"
        >
          <div
            className="pos-menu-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-modal-title"
          >
            <div className="pos-menu-modal__drag-handle" />

            <header className="pos-menu-modal__header">
              <div className="pos-menu-modal__title-row">
                <div className="pos-menu-modal__badge">
                  <i className={`fa-solid ${modalIcon}`} aria-hidden="true" />
                  <span>{CATEGORY_LABELS[modalCategory] || "Menu Item"}</span>
                </div>
                <button
                  type="button"
                  className="pos-menu-modal__close-btn"
                  onClick={() => setModalOpen(false)}
                  aria-label="Close"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
              <h2 id="menu-modal-title" className="pos-menu-modal__title">
                {modalName.trim() ? `Add "${modalName.trim()}"` : "Add New Dish"}
              </h2>
              <p className="pos-menu-modal__subtitle">
                Set selling price to make this item available on POS immediately
              </p>
            </header>

            <form
              onSubmit={(e) => void handleModalSubmit(e)}
              className="pos-menu-modal__body"
            >
              {/* Dish Name */}
              <div className="pos-menu-modal__field">
                <label htmlFor="modal-dish-name">Dish or Beverage Name</label>
                <div className="pos-menu-modal__input-wrap">
                  <span className="pos-menu-modal__input-icon">
                    <i className="fa-solid fa-utensils" aria-hidden="true" />
                  </span>
                  <input
                    id="modal-dish-name"
                    ref={nameInputRef}
                    type="text"
                    required
                    autoComplete="off"
                    placeholder="e.g. Chapati, Beef stew, Ugali…"
                    value={modalName}
                    onChange={(e) => setModalName(e.target.value)}
                    className="pos-menu-modal__text-input"
                  />
                  {modalName ? (
                    <button
                      type="button"
                      className="pos-menu-modal__clear-btn"
                      onClick={() => {
                        setModalName("");
                        nameInputRef.current?.focus();
                      }}
                      aria-label="Clear dish name"
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Selling Price */}
              <div className="pos-menu-modal__field">
                <div className="pos-menu-modal__label-row">
                  <label htmlFor="modal-dish-price">Selling Price</label>
                  <span className="pos-menu-modal__label-hint">Per plate or serving</span>
                </div>
                <div className="pos-menu-modal__price-wrap">
                  <span className="pos-menu-modal__price-prefix">KES</span>
                  <input
                    id="modal-dish-price"
                    ref={priceInputRef}
                    type="text"
                    required
                    inputMode="decimal"
                    placeholder="0"
                    value={modalPrice}
                    onChange={(e) => setModalPrice(e.target.value)}
                    className="pos-menu-modal__price-input"
                  />
                </div>

                {/* Quick Price Shortcuts */}
                <div
                  className="pos-menu-modal__shortcuts"
                  role="group"
                  aria-label="Price shortcuts"
                >
                  {PRICE_SHORTCUTS.map((amt) => {
                    const isActive = modalPrice === String(amt);
                    return (
                      <button
                        key={amt}
                        type="button"
                        className={`pos-menu-modal__price-pill${isActive ? " is-active" : ""}`}
                        onClick={() => setModalPrice(String(amt))}
                      >
                        {amt}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category Selector */}
              <div className="pos-menu-modal__field">
                <label>Category</label>
                <div className="pos-menu-modal__cat-selector">
                  {(["mains", "bites", "hot_drinks", "cold_drinks"] as const).map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`pos-menu-modal__cat-btn${modalCategory === cat ? " is-active" : ""}`}
                        onClick={() => setModalCategory(cat)}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Modal Footer Submit */}
              <footer className="pos-menu-modal__footer">
                <button
                  type="submit"
                  disabled={saving || !modalName.trim() || Number(modalPrice) <= 0}
                  className="pos-menu-modal__submit-btn"
                >
                  {saving ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                      <span>Adding to Menu…</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-circle-plus" aria-hidden="true" />
                      <span>
                        Add {modalName.trim() ? `"${modalName.trim()}"` : "Dish"} to Menu
                        {Number(modalPrice) > 0 ? ` (KES ${modalPrice})` : ""}
                      </span>
                    </>
                  )}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
