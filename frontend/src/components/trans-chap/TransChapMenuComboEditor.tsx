"use client";

import { inventoryProductName } from "@/lib/trans-chap-product";
import type { InventoryItem } from "@/lib/types";

export type ComboPart = { productId: string; name: string; quantity: number };

/** "Includes" block of the meal editor: the dishes that come in the meal (Big Mac ×1). */
export function ComboIncludesField({
  dishes,
  parts,
  onChange,
}: {
  dishes: InventoryItem[];
  parts: ComboPart[];
  onChange: (parts: ComboPart[]) => void;
}) {
  const available = dishes.filter((dish) => !parts.some((part) => part.productId === dish.product_id));

  function setQuantity(productId: string, quantity: number) {
    onChange(
      parts.map((part) =>
        part.productId === productId ? { ...part, quantity: Math.min(20, Math.max(1, quantity)) } : part,
      ),
    );
  }

  return (
    <div className="pos-menu-modal__field">
      <div className="pos-menu-modal__label-row">
        <label>Includes</label>
        <span className="pos-menu-modal__label-hint">Their options are asked too</span>
      </div>
      {parts.length ? (
        <ul className="tc-group__attached">
          {parts.map((part) => (
            <li key={part.productId}>
              <span className="tc-group__attached-body">
                <strong>{part.name}</strong>
              </span>
              <span className="tc-combo__qty">
                <button
                  type="button"
                  aria-label={`Fewer ${part.name}`}
                  disabled={part.quantity <= 1}
                  onClick={() => setQuantity(part.productId, part.quantity - 1)}
                >
                  <i className="fa-solid fa-minus" aria-hidden="true" />
                </button>
                <span>×{part.quantity}</span>
                <button
                  type="button"
                  aria-label={`More ${part.name}`}
                  onClick={() => setQuantity(part.productId, part.quantity + 1)}
                >
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${part.name}`}
                  onClick={() => onChange(parts.filter((row) => row.productId !== part.productId))}
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {available.length ? (
        <select
          className="tc-menu__select"
          value=""
          aria-label="Add a dish to this meal"
          onChange={(e) => {
            const dish = available.find((item) => item.product_id === e.target.value);
            if (dish) {
              onChange([
                ...parts,
                { productId: dish.product_id, name: inventoryProductName(dish), quantity: 1 },
              ]);
            }
          }}
        >
          <option value="">Add a dish…</option>
          {available.map((dish) => (
            <option key={dish.id} value={dish.product_id}>
              {inventoryProductName(dish)}
            </option>
          ))}
        </select>
      ) : parts.length ? null : (
        <p className="tc-group__intro">Add dishes to your menu first, then build meals from them.</p>
      )}
    </div>
  );
}
