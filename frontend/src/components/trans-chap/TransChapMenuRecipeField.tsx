"use client";

import { useState, type ReactNode } from "react";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { inventoryProductName, recipeCost } from "@/lib/trans-chap-product";
import type { InventoryItem } from "@/lib/types";
import { allSellUnits } from "@/lib/sell-units";

export type RecipeDraft = {
  productId: string;
  portion: string;
  yield: string;
  servingUnit: string;
  unit: string;
  /** Extras: the meal this row applies to. */
  menuId?: string;
};

export function parseRecipeQty(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseRecipePortion(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function recipeDraftHasInvalidPortion(rows: RecipeDraft[]): boolean {
  return rows.some((row) => row.productId && parseRecipePortion(row.portion) == null);
}

export function recipeDraftHasMismatchedYield(rows: RecipeDraft[]): boolean {
  const yields = new Map<string, number>();
  for (const row of rows) {
    if (!row.productId) continue;
    const yieldCount = parseRecipeQty(row.yield);
    if (yieldCount == null) continue;
    const key = row.servingUnit.trim().toLowerCase() || "servings";
    const saved = yields.get(key);
    if (saved != null && saved !== yieldCount) return true;
    yields.set(key, yieldCount);
  }
  return false;
}

export function recipeDraftLines(
  rows: RecipeDraft[],
  supplies?: InventoryItem[],
): {
  productId: string;
  quantity: number;
  batchQuantity: number;
  batchYield: number;
  servingUnit: string;
  ingredientUnit: string;
}[] {
  const suppliesMap = supplies ? new Map(supplies.map((s) => [s.product_id, s])) : null;
  const quantities = new Map<
    string,
    { productId: string; quantity: number; batchQuantity: number; servingUnit: string; ingredientUnit: string }
  >();
  rows.forEach((row) => {
    const portion = parseRecipePortion(row.portion);
    const yieldCount = parseRecipeQty(row.yield);
    if (!row.productId || portion == null || yieldCount == null) return;
    const servingUnit = row.servingUnit.trim() || "servings";
    const key = `${row.productId}\u0000${servingUnit.toLowerCase()}`;
    const supply = suppliesMap?.get(row.productId);
    const fallbackUnit = supply ? (allSellUnits(supply)[0]?.name || supply.product?.unit || "") : "";
    const line = quantities.get(key) ?? {
      productId: row.productId,
      quantity: 0,
      batchQuantity: 0,
      servingUnit,
      ingredientUnit: row.unit?.trim() || fallbackUnit,
    };
    line.quantity += portion / yieldCount;
    line.batchQuantity += portion;
    quantities.set(key, line);
  });
  return [...quantities.values()].map((line) => ({
    ...line,
    batchYield: line.batchQuantity / line.quantity,
  }));
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
  maxRows,
  showMoney = true,
  leadColumn,
  perUnit = false,
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
  /** Extras link one supply each. */
  maxRows?: number;
  /** The Kitchen shows portions only, never costs or margins. */
  showMoney?: boolean;
  /** Extra first column on each row, such as the meal an extra row applies to. */
  leadColumn?: {
    label: string;
    render: (row: RecipeDraft, patchRow: (next: Partial<RecipeDraft>) => void) => ReactNode;
  };
  /** The batch is always 1 unit of the supply, so only portions per unit are entered. */
  perUnit?: boolean;
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
        <span className="pos-menu-modal__label-hint">
          {perUnit ? "Portions made from 1 unit of the supply" : "A batch amount makes a number of menu portions"}
        </span>
      </div>
      <p className="tc-group__intro">
        {perUnit
          ? "Enter how many portions 1 unit of the supply makes. For example, 1 kg of chicken makes 8 sticks."
          : "Enter the supply amount for a recipe batch and how many menu portions it makes. For example, 10 kg of chicken makes 8 plates."}
      </p>
      <div className="tc-recipe__measure-tools">
        <span className="tc-recipe__measure-current">Name the menu portion for each supply</span>
        {onSaveEquivalenceUnits && (
          <button
            type="button"
            className="tc-recipe__manage-measures"
            onClick={() => setManageMeasures((open) => !open)}
          >
            {manageMeasures ? "Hide portion names" : "Manage portion names"}
          </button>
        )}
      </div>
      {manageMeasures && onSaveEquivalenceUnits && (
        <div className="tc-recipe__measure-manager">
          <p>Name the portions you sell, such as plates, cups or sticks.</p>
          <div className="tc-recipe__measure-add">
            <input
              value={newMeasure}
              maxLength={32}
              placeholder="Add a portion name"
              aria-label="New portion name"
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
                    aria-label={`Remove ${measure} portion name`}
                    disabled={savingMeasures}
                    onClick={() => void updateMeasures(measures.filter((item) => item !== measure))}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : <small>No portion names configured yet.</small>}
        </div>
      )}
      {rows.length ? (
        <>
        <div className={`tc-recipe__columns${leadColumn ? " tc-recipe__columns--lead" : ""}${perUnit ? " tc-recipe__columns--per-unit" : ""}`}>
          {leadColumn ? <span>{leadColumn.label}</span> : null}
          <span>Supply</span>
          {perUnit ? null : <span>Batch supply amount</span>}
          <span>Menu portion</span>
          <span>{perUnit ? "Menu portions per unit" : "Menu portions per batch"}</span>
          <span />
        </div>
        <ul className="tc-group__attached">
          {rows.map((row, index) => {
            const supply = byProductId.get(row.productId);
            const unitChoices = supply ? allSellUnits(supply) : [];
            const unit = unitChoices.find((choice) => choice.name === row.unit)?.name || unitChoices[0]?.name || supply?.product?.unit || "Piece";
            const factor = unitChoices.find((choice) => choice.name === unit)?.factor || 1;
            const rowServingUnit = row.servingUnit || servingUnit;
            const yieldCount = parseRecipeQty(row.yield);
            const portion = perUnit ? 1 : parseRecipePortion(row.portion);
            const qtyPerEquivalence =
              portion != null && yieldCount != null ? portion / yieldCount : null;
            const lineCost =
              supply?.buying_price != null && qtyPerEquivalence != null
                ? supply.buying_price * qtyPerEquivalence
                : null;
            const kitchenQuantity = supply?.kitchen_quantity;
            const portionIsValid = portion != null;
            const yieldIsValid = yieldCount != null && yieldCount > 0;
            const recipeLineIsValid = portionIsValid && yieldIsValid;
            return (
              <li
                key={`${row.productId || "new"}-${index}`}
                className={`tc-recipe__row${leadColumn ? " tc-recipe__row--lead" : ""}${perUnit ? " tc-recipe__row--per-unit" : ""}`}
              >
                {leadColumn ? (
                  <span className="tc-recipe__lead" data-label={leadColumn.label}>
                    {leadColumn.render(row, (next) => patch(index, next))}
                  </span>
                ) : null}
                <select
                  className="tc-group__supply"
                  aria-label="Supply"
                  data-label="Supply"
                  value={row.productId}
                  onChange={(e) => {
                    const nextSupply = byProductId.get(e.target.value);
                    const defaultUnit = nextSupply
                      ? (allSellUnits(nextSupply)[0]?.name || nextSupply.product?.unit || "Piece")
                      : "";
                    patch(index, {
                      productId: e.target.value,
                      unit: defaultUnit,
                      servingUnit: rowServingUnit,
                      portion: "",
                      yield: "",
                    });
                  }}
                >
                  <option value="">Choose a supply…</option>
                  {supplies
                    .filter((item) => {
                      return item.product_id === row.productId ||
                        (item.is_active && selectableIds.has(item.product_id));
                    })
                    .map((item) => (
                      <option key={item.id} value={item.product_id}>
                        {inventoryProductName(item)}
                      </option>
                    ))}
                </select>
                {perUnit ? null : (
                <span className="tc-recipe__available" data-label="Batch supply amount">
                  {supply ? (
                    <>
                        <span className="tc-recipe__portion-input">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.0001"
                            step="any"
                            aria-invalid={!portionIsValid || undefined}
                            aria-label={`Batch supply amount for ${inventoryProductName(supply)}`}
                            value={parseRecipePortion(row.portion) == null ? row.portion : String(Number(row.portion) / factor)}
                            onChange={(e) => {
                              const value = e.target.value;
                              patch(index, { portion: value.trim() ? String(Number(value) * factor) : "" });
                            }}
                          />
                          {unitChoices.length > 1 ? (
                            <select
                              className="tc-recipe__unit-select"
                              aria-label={`Unit for ${inventoryProductName(supply)}`}
                              value={unit}
                              onChange={(e) => patch(index, { unit: e.target.value })}
                            >
                              {unitChoices.map((choice) => <option key={choice.name} value={choice.name}>{choice.name}</option>)}
                            </select>
                          ) : <span className="tc-recipe__unit">{unit}</span>}
                        </span>
                        <small>
                          {kitchenQuantity == null
                            ? "Kitchen stock quantity is not tracked"
                            : `${formatRecipeQty(kitchenQuantity / factor)} ${unit} in kitchen now`}
                        </small>
                        {!portionIsValid && (
                          <small className="tc-recipe__portion-error">
                            Enter the supply amount for this recipe batch.
                          </small>
                        )}
                        {recipeLineIsValid && portion != null && yieldCount != null && (
                          <strong className="tc-recipe__yield-result">
                            {formatRecipeQty(portion / factor)} {unit} makes {formatRecipeQty(yieldCount)}{" "}
                            {servingLabel(rowServingUnit, yieldCount)}
                          </strong>
                        )}
                    </>
                  ) : "Choose a supply"}
                </span>
                )}
                <label className="tc-recipe__equivalence" data-label="Menu portion">
                  <select
                    aria-label={`Menu portion for ${supply ? inventoryProductName(supply) : "supply"}`}
                    value={rowServingUnit}
                    onChange={(event) => {
                      const nextUnit = event.target.value;
                      patch(index, {
                        servingUnit: nextUnit,
                      });
                    }}
                  >
                    {!measures.includes(rowServingUnit) && rowServingUnit && (
                      <option value={rowServingUnit}>{rowServingUnit}</option>
                    )}
                    {measures.map((measure) => (
                      <option key={measure} value={measure}>{measure}</option>
                    ))}
                    {!measures.length && <option value={servingUnit}>{servingUnit}</option>}
                  </select>
                </label>
                <label className={`tc-group__uses${row.productId && !yieldIsValid ? " is-error" : ""}`}>
                  <span className="tc-recipe__input-label">
                    {perUnit ? `${servingLabel(rowServingUnit, 2)} per 1 ${unit}` : "Menu portions per batch"}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.0001"
                    step="any"
                    placeholder="e.g. 8"
                    aria-label={
                      perUnit
                        ? `${servingLabel(rowServingUnit, 2)} per 1 ${unit}`
                        : `${servingLabel(rowServingUnit, 2)} made per recipe batch`
                    }
                    value={row.yield}
                    onChange={(e) => patch(index, { yield: e.target.value })}
                  />
                  {perUnit && supply ? (
                    <small>
                      {yieldIsValid && yieldCount != null
                        ? `1 ${unit} makes ${formatRecipeQty(yieldCount)} ${servingLabel(rowServingUnit, yieldCount)}`
                        : kitchenQuantity == null
                          ? "Kitchen stock not tracked"
                          : `${formatRecipeQty(kitchenQuantity)} ${unit} in kitchen now`}
                    </small>
                  ) : null}
                  {showMoney && lineCost != null && <small>{formatKsh(lineCost)} per {rowServingUnit.trim() || "portion"}</small>}
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
        {maxRows != null && rows.length >= maxRows ? null : (
          <button
            type="button"
            className="tc-group__add-option"
            disabled={!selectableIds.size}
            onClick={() =>
              onChange([
                ...rows,
                { productId: "", portion: "", yield: "", servingUnit, unit: "", menuId: rows[rows.length - 1]?.menuId },
              ])
            }
          >
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add ingredient
          </button>
        )}
        {showMoney && lines.length ? (
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

function servingLabel(unit: string, count: number): string {
  const normalized = unit.trim().toLowerCase() || "serving";
  if (count === 1 || normalized.endsWith("s")) return normalized;
  if (/(ch|sh|x|z)$/.test(normalized)) return `${normalized}es`;
  return `${normalized}s`;
}
