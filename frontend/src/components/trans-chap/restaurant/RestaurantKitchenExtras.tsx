"use client";

import { useEffect, useMemo, useState } from "react";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { fetchKitchenEquivalenceUnits, saveKitchenEquivalenceUnits } from "@/lib/restaurant-supplies";
import {
  fetchOptionAvailability,
  fetchModifierGroups,
  inventoryProductName,
  isOptionAvailable,
  saveExtraRecipes,
  setModifierOptionActive,
  type OptionAvailabilityMap,
} from "@/lib/trans-chap-product";
import type { InventoryItem, ModifierGroup, ModifierOption } from "@/lib/types";
import { RestaurantKitchenExtraForm } from "@/components/trans-chap/restaurant/RestaurantKitchenExtraForm";
import {
  RecipeField,
  parseRecipeQty,
  type RecipeDraft,
} from "@/components/trans-chap/TransChapMenuRecipeField";

const REFRESH_MS = 60_000;

type RecipeEditor = { group: ModifierGroup; option: ModifierOption };

/** Extras the kitchen offers, each with its own recipe linking it to a meal and a supply portion. */
export function RestaurantKitchenExtras({
  dishes,
  supplies,
  onDishesChange,
}: {
  dishes: InventoryItem[];
  supplies: InventoryItem[];
  onDishesChange: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
}) {
  const [extraGroups, setExtraGroups] = useState<ModifierGroup[]>([]);
  const [availability, setAvailability] = useState<OptionAvailabilityMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [extraForm, setExtraForm] = useState<{ group: ModifierGroup | null; option: ModifierOption | null } | null>(null);
  const [recipeEditor, setRecipeEditor] = useState<RecipeEditor | null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeDraft[]>([]);
  const [recipeUnit, setRecipeUnit] = useState("portions");
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [portionNames, setPortionNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([fetchOptionAvailability(), fetchModifierGroups()])
        .then(([nextAvailability, allGroups]) => {
          if (!alive) return;
          setAvailability(nextAvailability);
          setExtraGroups(allGroups.filter((group) => group.is_extra));
        })
        .catch((err) => {
          if (alive) void showError("Could not load extras", extractErrorMessage(err));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    fetchKitchenEquivalenceUnits()
      .then(setPortionNames)
      .catch((err) => void showError("Could not load portion names", extractErrorMessage(err)));
  }, []);

  const mealsByGroup = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const dish of dishes) {
      for (const group of dish.product?.modifier_groups ?? []) {
        if (!group.is_extra) continue;
        map.set(group.id, [...(map.get(group.id) ?? []), dish]);
      }
    }
    return map;
  }, [dishes]);
  const suppliesByProduct = useMemo(
    () => new Map(supplies.map((item) => [item.product_id, item])),
    [supplies],
  );
  const dishByProduct = useMemo(() => new Map(dishes.map((dish) => [dish.product_id, dish])), [dishes]);

  async function savePortionNames(units: string[]) {
    try {
      setPortionNames(await saveKitchenEquivalenceUnits(units));
    } catch (err) {
      await showError("Could not save portion names", extractErrorMessage(err));
      throw err;
    }
  }

  async function toggle(option: ModifierOption) {
    const row = availability?.get(option.id);
    const nextActive = !(row ? row.is_active : option.is_active !== false);
    setTogglingId(option.id);
    try {
      await setModifierOptionActive(option.id, nextActive);
      setAvailability(await fetchOptionAvailability());
      await toastSuccess(`"${option.name}" is now ${nextActive ? "available" : "sold out"}`);
    } catch (err) {
      await showError("Could not update extra", extractErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  function openRecipe(group: ModifierGroup, option: ModifierOption) {
    setRecipeEditor({ group, option });
    const unit = option.recipes?.[0]?.portion_unit || option.portion_unit || portionNames[0] || "portions";
    setRecipeUnit(unit);
    const saved = (option.recipes ?? []).map<RecipeDraft>((recipe) => ({
      menuId: recipe.menu_product_id,
      productId: recipe.product_id,
      portion: "1",
      yield: String(recipe.portions_per_unit),
      servingUnit: recipe.portion_unit,
      unit: "",
    }));
    const legacyPerPick = Number(option.stock_qty) || 0;
    const firstMeal = mealsByGroup.get(group.id)?.[0]?.product_id ?? "";
    setRecipeRows(
      saved.length
        ? saved
        : option.product_id
          ? [{
              menuId: firstMeal,
              productId: option.product_id,
              portion: "1",
              yield: legacyPerPick > 0 ? String(Number((1 / legacyPerPick).toFixed(3))) : "",
              servingUnit: unit,
              unit: "",
            }]
          : [{ menuId: firstMeal, productId: "", portion: "1", yield: "", servingUnit: unit, unit: "" }],
    );
  }

  async function handleSaveRecipe() {
    if (!recipeEditor || savingRecipe) return;
    const rows = recipeRows.filter((row) => row.menuId || row.productId || row.yield.trim());
    const lines = [];
    for (const row of rows) {
      const perUnit = parseRecipeQty(row.yield);
      const portionUnit = (row.servingUnit || recipeUnit).trim();
      if (!row.menuId || !row.productId || perUnit == null || !portionUnit) {
        await showError("Complete each row", "Every row needs a menu, a supply and how many portions 1 unit makes.");
        return;
      }
      lines.push({ menu_product_id: row.menuId, product_id: row.productId, portions_per_unit: perUnit, portion_unit: portionUnit });
    }
    const keys = new Set(lines.map((line) => `${line.menu_product_id}\u0000${line.product_id}`));
    if (keys.size !== lines.length) {
      await showError("Duplicate row", "Each meal can use a supply only once for this extra.");
      return;
    }
    setSavingRecipe(true);
    try {
      const saved = await saveExtraRecipes(recipeEditor.option.id, lines);
      const groupId = recipeEditor.group.id;
      const replaceOption = (group: ModifierGroup): ModifierGroup =>
        group.id === groupId
          ? { ...group, options: group.options.map((option) => (option.id === saved.id ? saved : option)) }
          : group;
      const updatedGroup = replaceOption(extraGroups.find((group) => group.id === groupId) ?? recipeEditor.group);
      const mealIds = new Set(lines.map((line) => line.menu_product_id));
      setExtraGroups((previous) => previous.map(replaceOption));
      onDishesChange((previous) =>
        previous.map((item) => {
          if (!item.product) return item;
          const groups = item.product.modifier_groups ?? [];
          const has = groups.some((group) => group.id === groupId);
          if (!has && !mealIds.has(item.product_id)) return item;
          return {
            ...item,
            product: {
              ...item.product,
              modifier_groups: has ? groups.map(replaceOption) : [...groups, updatedGroup],
            },
          };
        }),
      );
      setAvailability(await fetchOptionAvailability());
      setRecipeEditor(null);
      await toastSuccess(
        lines.length
          ? `Recipe saved for "${saved.name}" on ${mealIds.size} meal${mealIds.size === 1 ? "" : "s"}`
          : `Recipe cleared for "${saved.name}"`,
      );
    } catch (err) {
      await showError("Could not save extra recipe", extractErrorMessage(err));
    } finally {
      setSavingRecipe(false);
    }
  }

  function recipeSummary(option: ModifierOption): string | null {
    if (option.recipes?.length) {
      return option.recipes
        .map((recipe) => {
          const meal = dishByProduct.get(recipe.menu_product_id);
          const mealName = recipe.menu_name || meal?.product?.name || "Meal";
          return `${mealName}: ${recipe.portions_per_unit} ${recipe.portion_unit} per ${recipe.product_unit || "unit"} of ${recipe.product_name || "supply"}`;
        })
        .join(" · ");
    }
    if (!option.product_id) return null;
    const supply = suppliesByProduct.get(option.product_id);
    const supplyName = option.product_name || (supply ? inventoryProductName(supply) : "supply");
    return `1 ${option.portion_unit || "portion"} of ${supplyName}`;
  }

  function upsertGroup(group: ModifierGroup) {
    setExtraGroups((previous) =>
      previous.some((item) => item.id === group.id)
        ? previous.map((item) => (item.id === group.id ? group : item))
        : [...previous, group],
    );
    onDishesChange((previous) =>
      previous.map((item) =>
        item.product && (item.product.modifier_groups ?? []).some((attached) => attached.id === group.id)
          ? {
              ...item,
              product: {
                ...item.product,
                modifier_groups: (item.product.modifier_groups ?? []).map((attached) =>
                  attached.id === group.id ? group : attached,
                ),
              },
            }
          : item,
      ),
    );
    setExtraForm(null);
  }

  function removeGroup(groupId: string) {
    setExtraGroups((previous) => previous.filter((group) => group.id !== groupId));
    onDishesChange((previous) =>
      previous.map((item) =>
        item.product
          ? {
              ...item,
              product: {
                ...item.product,
                modifier_groups: (item.product.modifier_groups ?? []).filter((group) => group.id !== groupId),
              },
            }
          : item,
      ),
    );
    setExtraForm(null);
  }

  return (
    <>
      <div className="tc-kitchen-section__head">
        <div>
          <h3 className="tc-kitchen-section__title">
            <i className="fa-solid fa-list-check" aria-hidden />
            <span>Extras</span>
          </h3>
          <p className="tc-kitchen-section__subtitle">
            Add-ons customers can order with a meal. Set each extra’s recipe to choose its meal and the supply portion it uses.
          </p>
        </div>
        <button
          type="button"
          className="rs-btn rs-btn--small rs-btn--primary"
          onClick={() => setExtraForm({ group: null, option: null })}
        >
          <i className="fa-solid fa-plus" aria-hidden /> Add extra
        </button>
      </div>

      {loading ? (
        <p className="rs-empty">Loading extras…</p>
      ) : extraGroups.length === 0 ? (
        <div className="tc-kitchen-empty">
          <i className="fa-solid fa-list-check" aria-hidden />
          <h4>No extras yet</h4>
          <p>Add extras such as an extra chicken stick, then set a recipe for each one.</p>
        </div>
      ) : (
        <ul className="tc-kitchen-extras__list">
          {extraGroups.flatMap((group) =>
            group.options.map((option) => {
              const meals = mealsByGroup.get(group.id) ?? [];
              const row = availability?.get(option.id);
              const active = row ? row.is_active : option.is_active !== false;
              const available = isOptionAvailable(option, availability);
              const summary = recipeSummary(option);
              return (
                <li key={option.id} className={`tc-kitchen-extra${available ? "" : " is-off"}`}>
                  <div className="tc-kitchen-extras__name">
                    <span>
                      {option.name}
                    </span>
                    <small>
                      {summary ?? "Recipe not set"}
                      {option.recipes?.length ? null : (
                        <>
                          {" · "}
                          {meals.length ? meals.map((meal) => meal.product?.name ?? "Meal").join(", ") : "No meal yet"}
                        </>
                      )}
                    </small>
                    <span className="tc-kitchen-extra__actions">
                      <button
                        type="button"
                        className="tc-menu__recipe-action"
                        onClick={() => openRecipe(group, option)}
                      >
                        <i className="fa-solid fa-list-check" aria-hidden="true" />
                        {summary ? "Edit recipe" : "Set recipe"}
                      </button>
                      <button
                        type="button"
                        className="tc-mod__link"
                        onClick={() => setExtraForm({ group, option })}
                      >
                        Edit
                      </button>
                    </span>
                  </div>
                  <span className={`rs-badge ${available ? "rs-badge--ok" : "rs-badge--warn"} tc-kitchen-extras__pill`}>
                    {available ? "Available" : row?.reason === "out_of_stock" ? "Out of stock" : "Sold out"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className={`theme-switch ${active ? "is-on" : ""}`}
                    aria-checked={active}
                    aria-label={active ? `Mark ${option.name} sold out` : `Mark ${option.name} available`}
                    disabled={togglingId === option.id}
                    onClick={() => void toggle(option)}
                  >
                    <span className="theme-switch__thumb" aria-hidden />
                  </button>
                </li>
              );
            }),
          )}
        </ul>
      )}

      {extraForm ? (
        <RestaurantKitchenExtraForm
          key={extraForm.option?.id ?? "new"}
          group={extraForm.group}
          option={extraForm.option}
          onClose={() => setExtraForm(null)}
          onSaved={upsertGroup}
          onDeleted={(saved, groupId) => (saved ? upsertGroup(saved) : removeGroup(groupId))}
        />
      ) : null}

      {recipeEditor && !extraForm ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => !savingRecipe && setRecipeEditor(null)}
          role="presentation"
        >
          <div
            className="pos-menu-modal tc-menu__recipe-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-extra-recipe-title"
          >
            <div className="pos-menu-modal__drag-handle" />
            <header className="pos-menu-modal__header">
              <div className="pos-menu-modal__title-row">
                <div>
                  <h2 id="kitchen-extra-recipe-title" className="pos-menu-modal__title">Extra recipe</h2>
                  <p className="pos-menu-modal__label-hint">{recipeEditor.option.name}</p>
                </div>
                <button
                  type="button"
                  className="pos-menu-modal__close-btn"
                  onClick={() => setRecipeEditor(null)}
                  disabled={savingRecipe}
                  aria-label="Close extra recipe"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="pos-menu-modal__body">
              <RecipeField
                label="Made from"
                leadColumn={{
                  label: "Menu",
                  render: (row, patchRow) => (
                    <select
                      className="tc-group__supply"
                      aria-label="Menu"
                      value={row.menuId ?? ""}
                      onChange={(event) => patchRow({ menuId: event.target.value })}
                    >
                      <option value="">Choose a meal…</option>
                      {dishes.map((dish) => (
                        <option key={dish.id} value={dish.product_id}>
                          {dish.product?.name ?? "Meal"}
                        </option>
                      ))}
                    </select>
                  ),
                }}
                supplies={supplies}
                equivalenceUnits={portionNames}
                onSaveEquivalenceUnits={savePortionNames}
                rows={recipeRows}
                price={null}
                showMoney={false}
                perUnit
                servingUnit={recipeUnit}
                onServingUnitChange={setRecipeUnit}
                onChange={setRecipeRows}
              />
              <footer className="pos-menu-modal__footer tc-menu__footer tc-menu__recipe-footer">
                <button
                  type="button"
                  className="rs-btn"
                  onClick={() => setRecipeEditor(null)}
                  disabled={savingRecipe}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pos-menu-modal__submit-btn"
                  disabled={savingRecipe}
                  onClick={() => void handleSaveRecipe()}
                >
                  {savingRecipe ? "Saving…" : "Save recipe"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
