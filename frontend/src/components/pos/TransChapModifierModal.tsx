"use client";

import { useId, useMemo, useState } from "react";
import { formatMoney } from "@/lib/orders";
import type { InventoryItem, OrderItemModifier } from "@/lib/types";

export type ModifierOption = {
  id: string;
  name: string;
  price: number;
  group: string;
};

const DEFAULT_MODIFIER_PRESETS: ModifierOption[] = [
  // Proteins & Meats
  { id: "beef", name: "Beef", price: 100, group: "Proteins & Meats" },
  { id: "extra_chicken", name: "Extra Chicken", price: 150, group: "Proteins & Meats" },
  { id: "goat_mbuzi", name: "Goat / Mbuzi", price: 180, group: "Proteins & Meats" },
  { id: "fish", name: "Fish", price: 200, group: "Proteins & Meats" },
  { id: "kuku_choma", name: "Kuku Choma", price: 180, group: "Proteins & Meats" },

  // Sides & Accompaniments
  { id: "poussin_chips", name: "Poussin Chips", price: 200, group: "Sides & Accompaniments" },
  { id: "plain_chips", name: "Plain Chips", price: 150, group: "Sides & Accompaniments" },
  { id: "ugali", name: "Ugali", price: 80, group: "Sides & Accompaniments" },
  { id: "chapati", name: "Chapati", price: 80, group: "Sides & Accompaniments" },
  { id: "kachumbari", name: "Kachumbari", price: 50, group: "Sides & Accompaniments" },
  { id: "extra_rice", name: "Extra Rice", price: 100, group: "Sides & Accompaniments" },

  // Drink Flavors & Upgrades
  { id: "fanta_blackcurrant", name: "Fanta Blackcurrant", price: 0, group: "Drink Options" },
  { id: "fanta_orange", name: "Fanta Orange", price: 0, group: "Drink Options" },
  { id: "coca_cola", name: "Coca-Cola", price: 0, group: "Drink Options" },
  { id: "sprite", name: "Sprite", price: 0, group: "Drink Options" },
  { id: "coke_zero", name: "Coke Zero", price: 50, group: "Drink Options" },
  { id: "fresh_juice", name: "Fresh Juice Upgrade", price: 100, group: "Drink Options" },

  // Cooking & Prep Notes
  { id: "very_spicy", name: "Very Spicy", price: 0, group: "Cooking & Spice Notes" },
  { id: "medium_spicy", name: "Medium Spicy", price: 0, group: "Cooking & Spice Notes" },
  { id: "mild_no_pepper", name: "Mild / No Pepper", price: 0, group: "Cooking & Spice Notes" },
  { id: "extra_gravy", name: "Extra Gravy / Soup", price: 0, group: "Cooking & Spice Notes" },
  { id: "no_salt", name: "No Salt / Less Salt", price: 0, group: "Cooking & Spice Notes" },
  { id: "pack_separate", name: "Pack Separately", price: 0, group: "Cooking & Spice Notes" },
];

export type TransChapModifierModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  initialModifiers?: OrderItemModifier[] | null;
  initialNotes?: string | null;
  currency?: string;
  onConfirm: (
    modifiers: OrderItemModifier[],
    notes: string | null,
    effectiveUnitPrice: number,
  ) => void;
};

export function TransChapModifierModal({
  isOpen,
  onClose,
  item,
  initialModifiers,
  initialNotes,
  currency = "KES",
  onConfirm,
}: TransChapModifierModalProps) {
  const headingId = useId();
  const [selectedModifiers, setSelectedModifiers] = useState<OrderItemModifier[]>(
    () => initialModifiers || [],
  );
  const [notes, setNotes] = useState<string>(() => initialNotes || "");
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customGroup, setCustomGroup] = useState("Custom Add-on");

  // Keep state synchronized if opened with initial modifiers
  const basePrice = item?.selling_price ?? 0;

  const modifiersTotal = useMemo(() => {
    return selectedModifiers.reduce((sum, mod) => sum + (Number(mod.price) || 0), 0);
  }, [selectedModifiers]);

  const unitTotal = basePrice + modifiersTotal;

  if (!isOpen || !item) return null;

  const toggleModifier = (opt: { name: string; price: number; group?: string | null }) => {
    setSelectedModifiers((prev) => {
      const exists = prev.some(
        (m) => m.name.toLowerCase() === opt.name.toLowerCase(),
      );
      if (exists) {
        return prev.filter(
          (m) => m.name.toLowerCase() !== opt.name.toLowerCase(),
        );
      }
      return [
        ...prev,
        { name: opt.name, price: opt.price, group: opt.group || null },
      ];
    });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const name = customName.trim();
    if (!name) return;
    const price = Math.max(0, parseFloat(customPrice) || 0);
    toggleModifier({ name, price, group: customGroup.trim() || "Custom Add-on" });
    setCustomName("");
    setCustomPrice("");
  };

  const isSelected = (name: string) => {
    return selectedModifiers.some((m) => m.name.toLowerCase() === name.toLowerCase());
  };

  const groups = [
    "Proteins & Meats",
    "Sides & Accompaniments",
    "Drink Options",
    "Cooking & Spice Notes",
  ];

  return (
    <div
      className="pos-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pos-modifier-modal">
        <header className="pos-modifier-modal__header">
          <div className="pos-modifier-modal__title-row">
            <span className="pos-modifier-modal__badge">
              <i className="fa-solid fa-utensils" aria-hidden="true" /> Dish Customization
            </span>
            <button
              type="button"
              className="pos-modifier-modal__close-btn"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
          <h2 id={headingId} className="pos-modifier-modal__item-name">
            {item.product?.name ?? "Menu Item"}
          </h2>
          <div className="pos-modifier-modal__base-tag">
            Base: {formatMoney(basePrice, currency)}
          </div>
        </header>

        <div className="pos-modifier-modal__body">
          {groups.map((grp) => {
            const groupOptions = DEFAULT_MODIFIER_PRESETS.filter((p) => p.group === grp);
            return (
              <section key={grp} className="pos-modifier-group">
                <div className="pos-modifier-group__header">
                  <h3 className="pos-modifier-group__title">{grp}</h3>
                  <span className="pos-modifier-group__hint">Optional</span>
                </div>
                <div className="pos-modifier-chips">
                  {groupOptions.map((opt) => {
                    const active = isSelected(opt.name);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`pos-modifier-chip${active ? " is-selected" : ""}`}
                        onClick={() => toggleModifier(opt)}
                      >
                        <span className="pos-modifier-chip__check">
                          <i
                            className={active ? "fa-solid fa-circle-check" : "fa-regular fa-circle"}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="pos-modifier-chip__label">{opt.name}</span>
                        <span className="pos-modifier-chip__price">
                          {opt.price > 0 ? `+${formatMoney(opt.price, currency)}` : "Free"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* Custom add-on entry */}
          <section className="pos-modifier-group">
            <div className="pos-modifier-group__header">
              <h3 className="pos-modifier-group__title">Custom Add-on</h3>
              <span className="pos-modifier-group__hint">Custom extra or charge</span>
            </div>
            <div className="pos-modifier-custom-row">
              <input
                type="text"
                placeholder="e.g. Extra Gravy, Double Egg"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="pos-modifier-input"
              />
              <input
                type="number"
                placeholder="+ Price (KES)"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                min="0"
                step="10"
                className="pos-modifier-input pos-modifier-input--price"
              />
              <button
                type="button"
                onClick={handleAddCustom}
                disabled={!customName.trim()}
                className="pos-modifier-custom-btn"
              >
                <i className="fa-solid fa-plus" aria-hidden="true" /> Add
              </button>
            </div>

            {/* Any selected custom modifiers not in preset list */}
            {selectedModifiers
              .filter(
                (m) =>
                  !DEFAULT_MODIFIER_PRESETS.some(
                    (p) => p.name.toLowerCase() === m.name.toLowerCase(),
                  ),
              )
              .map((m) => (
                <div key={m.name} className="pos-modifier-custom-chip">
                  <span>
                    <strong>+ {m.name}</strong> ({m.price > 0 ? formatMoney(m.price, currency) : "Free"})
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleModifier(m)}
                    className="pos-modifier-remove-btn"
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </div>
              ))}
          </section>

          {/* Cooking notes & instructions */}
          <section className="pos-modifier-group">
            <div className="pos-modifier-group__header">
              <h3 className="pos-modifier-group__title">Kitchen & Prep Note</h3>
            </div>
            <textarea
              className="pos-modifier-textarea"
              placeholder="Special instructions for the chef / kitchen (e.g. Serve hot, no onions)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </section>
        </div>

        <footer className="pos-modifier-modal__footer">
          <div className="pos-modifier-summary">
            <span className="pos-modifier-summary__breakdown">
              Base: {formatMoney(basePrice, currency)}
              {modifiersTotal > 0 ? ` + Add-ons: ${formatMoney(modifiersTotal, currency)}` : ""}
            </span>
            <span className="pos-modifier-summary__total">
              Line Total: <strong>{formatMoney(unitTotal, currency)}</strong>
            </span>
          </div>
          <div className="pos-modifier-actions">
            <button
              type="button"
              className="pos-btn-ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pos-btn-primary pos-modifier-confirm-btn"
              onClick={() => {
                onConfirm(selectedModifiers, notes.trim() || null, unitTotal);
                onClose();
              }}
            >
              <i className="fa-solid fa-check" aria-hidden="true" /> Add to Order · {formatMoney(unitTotal, currency)}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
