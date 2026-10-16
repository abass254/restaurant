"use client";

import { formatKsh } from "@/lib/trans-chap-receipt";
import { inventoryProductName, recipeCost } from "@/lib/trans-chap-product";
import type { InventoryItem } from "@/lib/types";

export type RecipeDraft = { productId: string; qty: string };

export function parseRecipeQty(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function recipeDraftLines(rows: RecipeDraft[]): { productId: string; quantity: number }[] {
  return rows
    .filter((row) => row.productId && parseRecipeQty(row.qty) != null)
    .map((row) => ({ productId: row.productId, quantity: parseRecipeQty(row.qty)! }));
}

/** "Made from" block: supplies one portion uses, with cost per plate and margin. */
export function RecipeField({
  label = "Made from",
  supplies,
  rows,
  price,
  onChange,
}: {
  label?: string;
  supplies: InventoryItem[];
  rows: RecipeDraft[];
  /** Selling price of the dish, for the margin. */
  price: number | null;
  onChange: (rows: RecipeDraft[]) => void;
}) {
  const byProductId = new Map(supplies.map((item) => [item.product_id, item]));
  const lines = recipeDraftLines(rows);
  const { cost, priced } = recipeCost(lines, byProductId);
  const margin = price && lines.length ? Math.round(((price - cost) / price) * 100) : null;

  function patch(index: number, next: Partial<RecipeDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }

  return (
    <div className="pos-menu-modal__field">
      <div className="pos-menu-modal__label-row">
        <label>{label}</label>
        <span className="pos-menu-modal__label-hint">Per portion · deducted when sold</span>
      </div>
      {rows.length ? (
        <ul className="tc-group__attached">
          {rows.map((row, index) => {
            const supply = byProductId.get(row.productId);
            const unit = supply?.product?.unit || "unit";
            const qty = parseRecipeQty(row.qty);
            const lineCost = supply?.buying_price != null && qty != null ? supply.buying_price * qty : null;
            return (
              <li key={`${row.productId || "new"}-${index}`} className="tc-recipe__row">
                <select
                  className="tc-group__supply"
                  aria-label="Supply"
                  value={row.productId}
                  onChange={(e) => patch(index, { productId: e.target.value })}
                >
                  <option value="">Choose a supply…</option>
                  {supplies
                    .filter(
                      (item) =>
                        item.product_id === row.productId ||
                        !rows.some((other) => other.productId === item.product_id),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.product_id}>
                        {inventoryProductName(item)}
                      </option>
                    ))}
                </select>
                <label className={`tc-group__uses${row.productId && qty == null ? " is-error" : ""}`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Amount of ${unit} per portion`}
                    value={row.qty}
                    onChange={(e) => patch(index, { qty: e.target.value })}
                  />
                  <span>{unit}</span>
                </label>
                <span className="tc-recipe__cost">{lineCost != null ? formatKsh(lineCost) : "—"}</span>
                <span className="tc-group__option-tools">
                  <button
                    type="button"
                    aria-label="Remove ingredient"
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="tc-group__attach-row">
        <button
          type="button"
          className="tc-group__add-option"
          disabled={!supplies.length}
          onClick={() => onChange([...rows, { productId: "", qty: "" }])}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" /> Add ingredient
        </button>
        {lines.length ? (
          <span className="tc-recipe__summary">
            Cost {formatKsh(cost)}
            {priced ? "" : " (some supplies have no buying price)"}
            {margin != null ? ` · ${margin}% margin` : ""}
          </span>
        ) : null}
      </div>
      {!supplies.length ? (
        <p className="tc-group__intro">Record supplies under Purchases first, then list what this meal uses.</p>
      ) : null}
    </div>
  );
}
