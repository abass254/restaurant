"use client";

import { useState } from "react";
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
  selectableSupplyProductIds,
  equivalenceUnits,
  onSaveEquivalenceUnits,
  rows,
  price,
  servingUnit,
  onServingUnitChange,
  onChange,
}: {
  label?: string;
  supplies: InventoryItem[];
  selectableSupplyProductIds?: ReadonlySet<string>;
  equivalenceUnits?: string[];
  onSaveEquivalenceUnits?: (units: string[]) => Promise<void>;
  rows: RecipeDraft[];
  /** Selling price of the dish, for the margin. */
  price: number | null;
  servingUnit: string;
  onServingUnitChange: (unit: string) => void;
  onChange: (rows: RecipeDraft[]) => void;
}) {
  const [manageMeasures, setManageMeasures] = useState(false);
  const [newMeasure, setNewMeasure] = useState("");
  const [savingMeasures, setSavingMeasures] = useState(false);
  const selectableIds =
    selectableSupplyProductIds ?? new Set(supplies.filter((item) => item.is_active).map((item) => item.product_id));
  const byProductId = new Map(supplies.map((item) => [item.product_id, item]));
  const lines = recipeDraftLines(rows);
  const { cost, priced } = recipeCost(lines, byProductId);
  const margin = price && lines.length ? Math.round(((price - cost) / price) * 100) : null;
  const measures = equivalenceUnits ?? [];

  async function updateMeasures(next: string[]): Promise<boolean> {
    if (!onSaveEquivalenceUnits || savingMeasures) return false;
    setSavingMeasures(true);
    try {
      await onSaveEquivalenceUnits(next);
      return true;
    } catch {
      // The Kitchen caller displays the save error to the merchant.
      return false;
    } finally {
      setSavingMeasures(false);
    }
  }

  async function addMeasure() {
    const name = newMeasure.trim();
    if (!name || measures.some((measure) => measure.toLowerCase() === name.toLowerCase())) return;
    if (await updateMeasures([...measures, name])) {
      if (!measures.length) onServingUnitChange(name);
      setNewMeasure("");
    }
  }

  function patch(index: number, next: Partial<RecipeDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }

  return (
    <div className="pos-menu-modal__field">
      <div className="pos-menu-modal__label-row">
        <label>{label}</label>
        <span className="pos-menu-modal__label-hint">Per equivalence unit · in each supply&apos;s base unit</span>
      </div>
      <p className="tc-group__intro">
        Choose the menu equivalence, then enter the amount of each supply used for one unit. For example, 0.1 kg of flour
        makes one chapati. Each row shows the yield from current kitchen stock; sales deduct the recipe ingredients.
      </p>
      <div className="tc-recipe__measure-tools">
        <label className="tc-recipe__serving-unit">
          <span>Menu equivalence</span>
          {equivalenceUnits ? (
            <select
              value={servingUnit}
              aria-label="Menu equivalence"
              onChange={(event) => onServingUnitChange(event.target.value)}
            >
              {!measures.includes(servingUnit) && servingUnit && (
                <option value={servingUnit}>{servingUnit} (current)</option>
              )}
              {measures.map((measure) => <option key={measure} value={measure}>{measure}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={servingUnit}
              maxLength={32}
              placeholder="e.g. plates, chapatis, sticks"
              aria-label="Menu serving unit"
              onChange={(event) => onServingUnitChange(event.target.value)}
            />
          )}
        </label>
        {onSaveEquivalenceUnits && (
          <button
            type="button"
            className="tc-recipe__manage-measures"
            onClick={() => setManageMeasures((open) => !open)}
          >
            {manageMeasures ? "Hide equivalence measures" : "Manage equivalence measures"}
          </button>
        )}
      </div>
      {manageMeasures && onSaveEquivalenceUnits && (
        <div className="tc-recipe__measure-manager">
          <p>Define the output units you use on this menu, such as plates, cups or sticks.</p>
          <div className="tc-recipe__measure-add">
            <input
              value={newMeasure}
              maxLength={32}
              placeholder="Add a measure"
              aria-label="New equivalence measure"
              onChange={(event) => setNewMeasure(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addMeasure();
                }
              }}
            />
            <button type="button" disabled={!newMeasure.trim() || savingMeasures} onClick={() => void addMeasure()}>
              Add
            </button>
          </div>
          {measures.length ? (
            <div className="tc-recipe__measure-list">
              {measures.map((measure) => (
                <span key={measure}>
                  {measure}
                  <button
                    type="button"
                    aria-label={`Remove ${measure} equivalence`}
                    disabled={savingMeasures}
                    onClick={() => void updateMeasures(measures.filter((item) => item !== measure))}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : <small>No equivalence measures configured yet.</small>}
        </div>
      )}
      {rows.length ? (
        <>
        <div className="tc-recipe__columns">
          <span>Supply</span>
          <span>Portion available</span>
          <span>Equivalence</span>
          <span>Qty per equivalence</span>
          <span />
        </div>
        <ul className="tc-group__attached">
          {rows.map((row, index) => {
            const supply = byProductId.get(row.productId);
            const unit = supply?.product?.unit || "Piece";
            const qty = parseRecipeQty(row.qty);
            const lineCost = supply?.buying_price != null && qty != null ? supply.buying_price * qty : null;
            const available = supply?.kitchen_quantity;
            const yieldCount =
              available != null && qty != null
                ? Math.floor(Math.max(available, 0) / qty)
                : null;
            return (
              <li key={`${row.productId || "new"}-${index}`} className="tc-recipe__row">
                <select
                  className="tc-group__supply"
                  aria-label="Supply"
                  data-label="Supply"
                  value={row.productId}
                  onChange={(e) => patch(index, { productId: e.target.value })}
                >
                  <option value="">Choose a supply…</option>
                  {supplies
                    .filter(
                      (item) =>
                        item.product_id === row.productId ||
                        (item.is_active && selectableIds.has(item.product_id)) &&
                        !rows.some((other) => other.productId === item.product_id),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.product_id}>
                        {inventoryProductName(item)}
                      </option>
                    ))}
                </select>
                <span className="tc-recipe__available" data-label="Portion available">
                  {supply
                    ? available == null
                      ? "Kitchen stock not tracked"
                      : <>
                          Available {formatRecipeQty(available)} {unit}
                          {qty != null && <small>Makes {yieldCount} {servingUnit.trim() || "servings"}</small>}
                        </>
                    : "Current kitchen stock"}
                </span>
                <span className="tc-recipe__equivalence" data-label="Equivalence">{servingUnit || "Choose a measure"}</span>
                <label className={`tc-group__uses${row.productId && qty == null ? " is-error" : ""}`}>
                  <span className="tc-recipe__input-label">Qty per equivalence</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.0001"
                    step="any"
                    placeholder="0.00"
                    aria-label={`Amount of ${unit} per equivalence`}
                    value={row.qty}
                    onChange={(e) => patch(index, { qty: e.target.value })}
                  />
                  <span className="tc-recipe__unit">{unit}</span>
                  {lineCost != null && <small>{formatKsh(lineCost)}</small>}
                </label>
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
        </>
      ) : null}
      <div className="tc-group__attach-row">
        <button
          type="button"
          className="tc-group__add-option"
          disabled={!selectableIds.size}
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
        <p className="tc-group__intro">Issue active supplies to the kitchen before adding recipe ingredients.</p>
      ) : !selectableIds.size ? (
        <p className="tc-group__intro">No active supplies are available. Add or issue supplies before adding recipe ingredients.</p>
      ) : null}
    </div>
  );
}

function formatRecipeQty(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}
