"use client";

import { FormEvent, useMemo, useState } from "react";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import {
  deleteModifierGroup,
  modifierOptionInput,
  modifierRuleLabel,
  saveModifierGroup,
} from "@/lib/trans-chap-product";
import type { ModifierGroup, ModifierOption, ModifierSourceKind } from "@/lib/types";

type RuleKind = "pick_one" | "optional_one" | "several";

export type SourceChoice = {
  id: string;
  name: string;
  /** Defined UoMs on this item (from Unit conversions + base unit, or meal serving units). */
  units?: string[];
  /** True when the item has stock currently released in the kitchen. */
  inKitchen?: boolean;
  /** Inventory role: "raw_material" | "for_sale" | "not_for_sale" */
  role?: string;
};

/** What a modifier option can use for stock: kitchen items, raw materials, store items, menu items and extras. */
export type ModifierSources = {
  storeItems: SourceChoice[];
  rawMaterials?: SourceChoice[];
  menuItems: SourceChoice[];
  extras: SourceChoice[];
};

type ItemCategory = "" | "raw_material" | "buy_sell" | "menu" | "extra";

type OptionDraft = {
  key: string;
  id?: string;
  name: string;
  /** Blank means free (part of the meal price). */
  price: string;
  /** Portion multiplier/amount (e.g. 1 portion, 0.5 portion, 2 portions). */
  portion: string;
  portionUnit: string;
  /** Meal serving unit (e.g. Servings, Plate, Cup). */
  mealPortionUnit: string;
  /** Category filter in Column 2 ("Raw / Buy sell"). */
  itemCategory: ItemCategory;
  /** Extra recipe, set from Kitchen and carried through unchanged when the extra is renamed or repriced. */
  recipe: Pick<ModifierOption, "product_id" | "stock_qty" | "batch_yield" | "portion_unit"> | null;
  sourceKind: ModifierSourceKind | "";
  /** Product id for a store or menu item, option id for an extra. */
  sourceId: string;
  isDefault: boolean;
};

const SOURCE_LABELS: { kind: ModifierSourceKind | ""; label: string }[] = [
  { kind: "", label: "Nothing (note only)" },
  { kind: "store_item", label: "Store item" },
  { kind: "menu", label: "Menu item" },
  { kind: "extra", label: "Extra" },
];

let draftSeq = 0;
function nextKey(): string {
  draftSeq += 1;
  return `opt-${draftSeq}`;
}

function blankOption(defaultPortionUnit: string = ""): OptionDraft {
  return {
    key: nextKey(),
    name: "",
    price: "",
    portion: "1",
    portionUnit: defaultPortionUnit,
    mealPortionUnit: defaultPortionUnit || "servings",
    itemCategory: "",
    recipe: null,
    sourceKind: "",
    sourceId: "",
    isDefault: false,
  };
}

function inferItemCategory(
  sources: ModifierSources | undefined,
  sourceKind: ModifierSourceKind | "" | null | undefined,
  sourceId: string,
): ItemCategory {
  if (!sourceKind) return "";
  if (sourceKind === "menu") return "menu";
  if (sourceKind === "extra") return "extra";
  if (sourceKind === "store_item") {
    if (sources?.rawMaterials?.some((item) => item.id === sourceId)) {
      return "raw_material";
    }
    const found = allSupplyChoices(sources).find((item) => item.id === sourceId);
    if (found?.role === "raw_material") {
      return "raw_material";
    }
    return "buy_sell";
  }
  return "";
}

function allSupplyChoices(sources: ModifierSources | undefined): SourceChoice[] {
  if (!sources) return [];
  const seen = new Set<string>();
  const out: SourceChoice[] = [];
  for (const item of [...(sources.rawMaterials ?? []), ...(sources.storeItems ?? [])]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function findSourceChoice(
  sources: ModifierSources | undefined,
  kind: ModifierSourceKind | "",
  id: string,
): SourceChoice | undefined {
  if (!sources || !kind || !id) return undefined;
  if (kind === "store_item") {
    return allSupplyChoices(sources).find((c) => c.id === id);
  }
  if (kind === "menu") {
    return sources.menuItems.find((c) => c.id === id);
  }
  return sources.extras.find((c) => c.id === id);
}

function parseAmount(value: string): number | null {
  const parsed = Number(value.trim());
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCount(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function ruleKindOf(group: ModifierGroup | null): RuleKind {
  if (!group) return "pick_one";
  if (group.max_select === 1) return group.min_select >= 1 ? "pick_one" : "optional_one";
  return "several";
}

const RULES: { kind: RuleKind; label: string }[] = [
  { kind: "pick_one", label: "Must pick 1" },
  { kind: "optional_one", label: "Can pick 1" },
  { kind: "several", label: "Can pick several" },
];

/** Create or edit one modifier, e.g. "Size" (Small / Medium / Large +50) or "Drink" (Coke / Fanta). */
export function TransChapMenuGroupEditor({
  group,
  isExtra = group?.is_extra ?? false,
  sources,
  isKitchen = false,
  defaultPortionUnit = "",
  availableUnits = [],
  onClose,
  onSaved,
  onDeleted,
}: {
  group: ModifierGroup | null;
  /** Extras are add-ons whose supply recipe is set separately in Kitchen. */
  isExtra?: boolean;
  /** Modifiers only: what an option can use for stock. */
  sources?: ModifierSources;
  /** When edited from Kitchen, options are portion-wise and no cash/prices are shown or defined. */
  isKitchen?: boolean;
  defaultPortionUnit?: string;
  availableUnits?: string[];
  onClose: () => void;
  onSaved: (group: ModifierGroup) => void | Promise<void>;
  onDeleted?: (groupId: string) => void | Promise<void>;
}) {
  const mealUnit = (defaultPortionUnit || "servings").trim();
  const unitOptions = useMemo(() => {
    const seenLower = new Set<string>();
    const out: string[] = [];
    const addUnit = (u?: string | null) => {
      const trimmed = (u ?? "").trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (seenLower.has(lower)) return;
      seenLower.add(lower);
      out.push(trimmed);
    };
    addUnit(mealUnit);
    for (const u of availableUnits ?? []) addUnit(u);
    for (const preset of ["Servings", "Plate", "Cup", "Bowl", "Piece"]) addUnit(preset);
    return out;
  }, [mealUnit, availableUnits]);

  const [name, setName] = useState(group?.name ?? "");
  const [rule, setRule] = useState<RuleKind>(group ? ruleKindOf(group) : isExtra ? "optional_one" : "pick_one");
  const [maxText, setMaxText] = useState(String(group && group.max_select > 1 ? group.max_select : 3));
  // Kept for older modifiers that require several picks; new ones start at 0.
  const [minText, setMinText] = useState(String(group && group.max_select > 1 ? group.min_select : 0));
  const showMin = !!group && group.max_select > 1 && group.min_select > 0;
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    group?.options.length
      ? group.options.map((option) => {
        const srcKind = (!isExtra && option.source_kind) || "";
        const srcId =
          option.source_kind === "extra"
            ? option.source_option_id ?? ""
            : option.source_product_id ?? "";
        const cat = inferItemCategory(sources, srcKind, srcId);
        const picked = findSourceChoice(sources, srcKind, srcId);
        return {
          key: nextKey(),
          id: option.id,
          name: option.name,
          price: !group.included && option.price_delta ? String(option.price_delta) : "",
          portion: option.stock_qty != null ? String(option.stock_qty) : "1",
          portionUnit: srcId ? (option.portion_unit || picked?.units?.[0] || "") : "",
          mealPortionUnit: !srcId ? (option.portion_unit || defaultPortionUnit || "Servings") : (defaultPortionUnit || "Servings"),
          itemCategory: cat,
          recipe: isExtra && option.product_id
            ? {
              product_id: option.product_id,
              stock_qty: option.stock_qty,
              batch_yield: option.batch_yield,
              portion_unit: option.portion_unit,
            }
            : null,
          sourceKind: srcKind,
          sourceId: srcId,
          isDefault: option.is_default,
        };
      })
      : [blankOption(defaultPortionUnit), blankOption(defaultPortionUnit)],
  );
  const showSources = !isExtra && !!sources;
  const [quickPicks, setQuickPicks] = useState<Set<string> | null>(null);
  const [quickSearch, setQuickSearch] = useState("");
  const takenStoreIds = new Set(
    options.filter((row) => row.sourceKind === "store_item" && row.sourceId).map((row) => row.sourceId),
  );
  const quickNeedle = quickSearch.trim().toLowerCase();
  const quickChoices = (sources?.storeItems ?? []).filter(
    (item) => !quickNeedle || item.name.toLowerCase().includes(quickNeedle),
  );

  function toggleQuickPick(id: string) {
    setQuickPicks((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function closeQuickAdd() {
    setQuickPicks(null);
    setQuickSearch("");
  }

  function addQuickPicks() {
    if (!quickPicks?.size || !sources) return;
    const picks = allSupplyChoices(sources).filter((item) => quickPicks.has(item.id) && !takenStoreIds.has(item.id));
    setOptions((prev) => [
      ...prev.filter((row) => row.name.trim() || row.sourceId),
      ...picks.map((item) => ({
        ...blankOption(defaultPortionUnit),
        name: item.name,
        portionUnit: item.units?.[0] || "",
        itemCategory: inferItemCategory(sources, "store_item", item.id),
        sourceKind: "store_item" as const,
        sourceId: item.id,
      })),
    ]);
    closeQuickAdd();
  }
  const [saving, setSaving] = useState(false);

  const filled = options.filter((option) => !!option.name.trim());
  const [minSelect, maxSelect] =
    rule === "pick_one"
      ? [1, 1]
      : rule === "optional_one"
        ? [0, 1]
        : [showMin ? parseCount(minText, 0) : 0, Math.max(2, parseCount(maxText, 3))];
  const priceError = filled.some((option) => option.price.trim() && parseAmount(option.price) == null && Number(option.price) !== 0);
  const portionError = !isExtra && filled.some((option) => option.portion.trim() && (Number(option.portion) <= 0 || !Number.isFinite(Number(option.portion))));
  const ruleError =
    minSelect > maxSelect
      ? "Minimum can't be more than the maximum."
      : filled.length && minSelect > filled.length
        ? "Add more options than customers must pick."
        : null;
  const canSave =
    !saving && !!name.trim() && filled.length > 0 && !ruleError && !priceError && !portionError;

  function patchOption(key: string, patch: Partial<OptionDraft>) {
    setOptions((prev) =>
      prev.map((option) => {
        if (option.key === key) return { ...option, ...patch };
        // Single-pick modifiers can only have one default.
        if (patch.isDefault && maxSelect === 1) return { ...option, isDefault: false };
        return option;
      }),
    );
  }

  function moveOption(key: string, step: -1 | 1) {
    setOptions((prev) => {
      const index = prev.findIndex((option) => option.key === key);
      const target = index + step;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = await saveModifierGroup(group?.id ?? null, {
        name: name.trim(),
        min_select: minSelect,
        max_select: maxSelect,
        is_extra: isExtra,
        included: false,
        options: filled.map((option) => {
          const portionNum = Number(option.portion);
          const stockQty = Number.isFinite(portionNum) && portionNum > 0 ? portionNum : (option.recipe?.stock_qty ?? 1);
          const picked = findSourceChoice(sources, option.sourceKind, option.sourceId);
          const effectiveUnit =
            option.sourceKind && option.sourceId
              ? option.portionUnit || picked?.units?.[0] || option.mealPortionUnit || defaultPortionUnit
              : option.mealPortionUnit || option.portionUnit || defaultPortionUnit || option.recipe?.portion_unit || "";
          const portionUnit = effectiveUnit.trim() || null;
          return {
            ...(option.id ? { id: option.id } : {}),
            name: option.name.trim(),
            price_delta: parseAmount(option.price) ?? 0,
            ...(option.recipe
              ? {
                product_id: option.recipe.product_id,
                stock_qty: stockQty,
                batch_yield: option.recipe.batch_yield,
                portion_unit: portionUnit ?? option.recipe.portion_unit,
              }
              : {
                product_id: null,
                stock_qty: stockQty,
                batch_yield: 1,
                portion_unit: portionUnit,
              }),
            ...(!isExtra && option.sourceKind && option.sourceId
              ? option.sourceKind === "extra"
                ? { source_kind: "extra" as const, source_option_id: option.sourceId, source_product_id: null }
                : { source_kind: option.sourceKind, source_product_id: option.sourceId, source_option_id: null }
              : { source_kind: null, source_product_id: null, source_option_id: null }),
            is_default: option.isDefault,
          };
        }),
      });
      await onSaved(saved);
      await toastSuccess(group ? `"${saved.name}" updated` : `"${saved.name}" created`);
    } catch (err) {
      await showError("Could not save modifier", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!group || saving) return;
    const used = group.item_count ?? 0;
    const ok = await confirmAction(
      `Delete "${group.name}"?`,
      used
        ? `It is used by ${used} menu item${used === 1 ? "" : "s"}; they will stop asking this question.`
        : "Menu items will stop asking this question.",
      "Delete",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteModifierGroup(group.id);
      await toastSuccess(`"${group.name}" deleted`);
      await onDeleted?.(group.id);
    } catch (err) {
      await showError("Could not delete", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-menu-modal-backdrop tc-group-backdrop" onClick={() => !saving && onClose()} role="presentation">
      <div
        className="pos-menu-modal tc-group-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-editor-title"
      >
        <div className="pos-menu-modal__drag-handle" />
        <header className="pos-menu-modal__header">
          <div className="pos-menu-modal__title-row">
            <h2 id="group-editor-title" className="pos-menu-modal__title">
              {isExtra ? (group ? "Edit extras" : "Add extras") : group ? "Edit modifier" : "New modifier"}
            </h2>
            <button type="button" className="pos-menu-modal__close-btn" onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>

        <form onSubmit={(e) => void handleSave(e)} className="pos-menu-modal__body tc-mod">
          <div className="pos-menu-modal__field">
            <label htmlFor="group-editor-name">Name</label>
            <div className="pos-menu-modal__input-wrap">
              <input
                id="group-editor-name"
                type="text"
                autoComplete="off"
                placeholder={isExtra ? "e.g. Extra cheese, Avocado" : "e.g. Size, Drink"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pos-menu-modal__text-input"
              />
            </div>
          </div>

          <div className="pos-menu-modal__field">
            <label>Customer</label>
            <div className="tc-mod__rules" role="radiogroup" aria-label="How many can be picked">
              {RULES.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  role="radio"
                  aria-checked={rule === option.kind}
                  className={`pos-menu-modal__cat-btn${rule === option.kind ? " is-active" : ""}`}
                  onClick={() => setRule(option.kind)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {rule === "several" ? (
              <div className="tc-group__counts">
                {showMin ? (
                  <label>
                    <span>At least</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={minText}
                      onChange={(e) => setMinText(e.target.value)}
                    />
                  </label>
                ) : null}
                <label>
                  <span>Up to</span>
                  <input
                    type="number"
                    min={2}
                    inputMode="numeric"
                    value={maxText}
                    onChange={(e) => setMaxText(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
            {ruleError ? <p className="tc-group__rule is-error">{ruleError}</p> : null}
          </div>

          <div className="pos-menu-modal__field">
            <div className="pos-menu-modal__label-row">
              <label>{isExtra ? "Extras" : "Options"}</label>
              <span className="pos-menu-modal__label-hint">
                {isExtra
                  ? "Set each extra’s recipe from Kitchen after saving"
                  : "Modifier · Raw / Buy sell · Item · Item UOM · Portion (serving, plate, cup etc) · Amount"}
              </span>
            </div>
            {!isExtra ? (
              <div className={`tc-mod__columns${showSources ? " tc-mod__columns--with-item" : ""}`}>
                <span>Modifier</span>
                {showSources ? <span>Raw / Buy sell</span> : null}
                {showSources ? <span>Item</span> : null}
                {showSources ? <span>Item UOM</span> : null}
                <span>Portion</span>
                <span>Amount</span>
                <span aria-hidden="true" />
              </div>
            ) : null}
            <ul className="tc-mod__options">
              {options.map((option, index) => {
                const badPrice = !!option.price.trim() && parseAmount(option.price) == null && Number(option.price) !== 0;
                const badPortion = !isExtra && !!option.portion.trim() && (Number(option.portion) <= 0 || !Number.isFinite(Number(option.portion)));
                const pickedChoice = findSourceChoice(sources, option.sourceKind, option.sourceId);

                const itemUomSet = new Set<string>();
                if (pickedChoice?.units?.length) {
                  for (const u of pickedChoice.units) {
                    if (u?.trim()) itemUomSet.add(u.trim());
                  }
                }
                if (pickedChoice && option.portionUnit?.trim()) {
                  itemUomSet.add(option.portionUnit.trim());
                }
                const itemUomOptions = Array.from(itemUomSet);
                const currentItemUom =
                  pickedChoice
                    ? option.portionUnit?.trim() || pickedChoice.units?.[0] || ""
                    : "";

                const portionUnitSet = new Set<string>(unitOptions);
                if (option.mealPortionUnit?.trim()) {
                  portionUnitSet.add(option.mealPortionUnit.trim());
                }
                const mealPortionUnits = Array.from(portionUnitSet);
                const currentMealPortion = option.mealPortionUnit?.trim() || mealUnit;

                const allSupplies = allSupplyChoices(sources);
                const rawList =
                  (sources?.rawMaterials?.length ?? 0) > 0
                    ? sources!.rawMaterials!
                    : allSupplies.filter((item) => item.role === "raw_material" || item.role === "supply" || item.role === "both");
                const rawChoices = rawList.length > 0 ? rawList : allSupplies;
                const buySellChoices = (sources?.storeItems?.length ?? 0) > 0 ? sources!.storeItems : allSupplies;

                const categoryItems: SourceChoice[] =
                  option.itemCategory === "raw_material"
                    ? rawChoices
                    : option.itemCategory === "buy_sell"
                      ? buySellChoices
                      : option.itemCategory === "menu"
                        ? sources?.menuItems ?? []
                        : option.itemCategory === "extra"
                          ? sources?.extras ?? []
                          : [];

                return (
                  <li key={option.key} className="tc-mod__option">
                    <div className={`tc-mod__row${!isExtra ? " tc-mod__row--ordered" : ""}${showSources ? " tc-mod__row--with-item" : ""}`}>
                      {/* 1. Modifier */}
                      <input
                        type="text"
                        className="tc-mod__name"
                        placeholder={index === 0 ? (isKitchen ? `e.g. XL, Regular` : "e.g. Large") : "Option name"}
                        aria-label="Modifier option name"
                        value={option.name}
                        onChange={(e) => patchOption(option.key, { name: e.target.value })}
                      />

                      {/* 2. Raw / Buy sell (Category Dropdown) */}
                      {showSources ? (
                        <select
                          className="tc-mod__type-select"
                          aria-label={`Item type for ${option.name || "this option"}`}
                          value={option.itemCategory}
                          onChange={(e) => {
                            const nextCat = e.target.value as ItemCategory;
                            if (!nextCat) {
                              patchOption(option.key, {
                                itemCategory: "",
                                sourceKind: "",
                                sourceId: "",
                                portionUnit: "",
                              });
                              return;
                            }
                            const nextKind: ModifierSourceKind =
                              nextCat === "menu"
                                ? "menu"
                                : nextCat === "extra"
                                  ? "extra"
                                  : "store_item";
                            patchOption(option.key, {
                              itemCategory: nextCat,
                              sourceKind: nextKind,
                              sourceId: "",
                              portionUnit: "",
                            });
                          }}
                        >
                          <option value="">None</option>
                          <option value="raw_material">Raw Material</option>
                          <option value="buy_sell">Buy &amp; Sell</option>
                          {(sources?.menuItems.length ?? 0) > 0 ? (
                            <option value="menu">Kitchen Meal</option>
                          ) : null}
                          {(sources?.extras.length ?? 0) > 0 ? (
                            <option value="extra">Extra</option>
                          ) : null}
                        </select>
                      ) : null}

                      {/* 3. Item (Inventory Dropdown) */}
                      {showSources ? (
                        <select
                          className="tc-mod__item-select"
                          aria-label={`Inventory item for ${option.name || "this option"}`}
                          disabled={!option.itemCategory}
                          value={option.sourceId}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            if (!nextId) {
                              patchOption(option.key, {
                                sourceId: "",
                                portionUnit: "",
                              });
                              return;
                            }
                            const nextKind: ModifierSourceKind =
                              option.itemCategory === "menu"
                                ? "menu"
                                : option.itemCategory === "extra"
                                  ? "extra"
                                  : "store_item";
                            const picked = findSourceChoice(sources, nextKind, nextId);
                            const nextUnit = picked?.units?.[0] || "";
                            patchOption(option.key, {
                              sourceKind: nextKind,
                              sourceId: nextId,
                              portionUnit: nextUnit,
                              ...(picked && !option.name.trim() ? { name: picked.name } : {}),
                            });
                          }}
                        >
                          <option value="">
                            {option.itemCategory ? "Select item…" : "—"}
                          </option>
                          {categoryItems.map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {choice.name}
                              {choice.inKitchen && option.itemCategory !== "menu" && option.itemCategory !== "extra"
                                ? " (Kitchen)"
                                : ""}
                            </option>
                          ))}
                        </select>
                      ) : null}

                      {/* 4. Item UOM (Dropdown) */}
                      {showSources ? (
                        <select
                          className="tc-mod__uom-select"
                          aria-label={`Item UOM for ${option.name || "option"}`}
                          disabled={!pickedChoice}
                          value={currentItemUom}
                          onChange={(e) => patchOption(option.key, { portionUnit: e.target.value })}
                        >
                          {pickedChoice ? (
                            itemUomOptions.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))
                          ) : (
                            <option value="">—</option>
                          )}
                        </select>
                      ) : null}

                      {/* 5. Portion (serving, plate, cup etc + qty) */}
                      {!isExtra ? (
                        <div className="tc-mod__portion-cell">
                          <select
                            className="tc-mod__unit-select"
                            aria-label={`Portion unit for ${option.name || "option"}`}
                            value={currentMealPortion}
                            onChange={(e) => patchOption(option.key, { mealPortionUnit: e.target.value })}
                          >
                            {mealPortionUnits.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0.01"
                            max="100000"
                            placeholder="1"
                            className={`tc-mod__qty-input${badPortion ? " is-error" : ""}`}
                            aria-label={`Quantity`}
                            value={option.portion}
                            onChange={(e) => patchOption(option.key, { portion: e.target.value })}
                          />
                        </div>
                      ) : null}

                      {/* 6. Amount (+KES) & Remove */}
                      <label className={`tc-mod__price${badPrice ? " is-error" : ""}`}>
                        <span>+KES</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          aria-label={isExtra ? "Extra price" : "Option price"}
                          value={option.price}
                          onChange={(e) => patchOption(option.key, { price: e.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="tc-mod__icon"
                        aria-label={`Remove ${option.name || "option"}`}
                        onClick={() => setOptions((prev) => prev.filter((row) => row.key !== option.key))}
                      >
                        <i className="fa-solid fa-xmark" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="tc-mod__meta">
                      <button
                        type="button"
                        className={`tc-group__default${option.isDefault ? " is-on" : ""}`}
                        aria-pressed={option.isDefault}
                        onClick={() => patchOption(option.key, { isDefault: !option.isDefault })}
                      >
                        <i
                          className={`fa-solid ${option.isDefault ? "fa-circle-check" : "fa-circle"}`}
                          aria-hidden="true"
                        />
                        Default
                      </button>
                      <span className="tc-group__option-tools">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={index === 0}
                          onClick={() => moveOption(option.key, -1)}
                        >
                          <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={index === options.length - 1}
                          onClick={() => moveOption(option.key, 1)}
                        >
                          <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {showSources && sources.storeItems.length ? (
              quickPicks ? (
                <div className="tc-mod__quick">
                  <div className="tc-mod__quick-head">
                    <strong>Add from store</strong>
                    <input
                      type="search"
                      placeholder="Search e.g. soda"
                      aria-label="Search store items"
                      value={quickSearch}
                      onChange={(e) => setQuickSearch(e.target.value)}
                    />
                  </div>
                  <ul className="tc-mod__quick-list">
                    {quickChoices.map((item) => {
                      const added = takenStoreIds.has(item.id);
                      return (
                        <li key={item.id}>
                          <label className={added ? "is-added" : ""}>
                            <input
                              type="checkbox"
                              disabled={added}
                              checked={added || quickPicks.has(item.id)}
                              onChange={() => toggleQuickPick(item.id)}
                            />
                            <span>{item.name}</span>
                            {added ? <small>Added</small> : null}
                          </label>
                        </li>
                      );
                    })}
                    {!quickChoices.length ? <li className="tc-mod__quick-empty">No store items match.</li> : null}
                  </ul>
                  <div className="tc-mod__quick-actions">
                    <button type="button" className="rs-btn rs-btn--small" onClick={closeQuickAdd}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rs-btn rs-btn--small rs-btn--primary"
                      disabled={!quickPicks.size}
                      onClick={addQuickPicks}
                    >
                      Add {quickPicks.size || ""} as options
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="tc-group__add-option tc-mod__add"
                  onClick={() => setQuickPicks(new Set())}
                >
                  <i className="fa-solid fa-list-check" aria-hidden="true" /> Add from store (e.g. drinks)
                </button>
              )
            ) : null}
            <button
              type="button"
              className="tc-group__add-option tc-mod__add"
              onClick={() => setOptions((prev) => [...prev, blankOption(defaultPortionUnit)])}
            >
              <i className="fa-solid fa-plus" aria-hidden="true" /> {isExtra ? "Add extra" : "Add option"}
            </button>
          </div>

          <footer className="pos-menu-modal__footer tc-menu__footer">
            {group ? (
              <button type="button" className="tc-menu__remove" disabled={saving} onClick={() => void handleDelete()}>
                Delete
              </button>
            ) : null}
            <button type="submit" disabled={!canSave} className="pos-menu-modal__submit-btn">
              {saving ? "Saving…" : isExtra ? (group ? "Save extras" : "Create extras") : group ? "Save modifier" : "Create modifier"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/** Summary line under a group, e.g. "Small · Medium · Large +50", or portion-wise "Half (0.5 portion) · Full (1 portion)". */
export function modifierOptionsSummary(
  group: ModifierGroup,
  showMoney: boolean = true,
  defaultPortionUnit?: string,
): string {
  return group.options
    .filter((option) => option.is_active)
    .map((option) => {
      const parts: string[] = [];
      const unit = (option.portion_unit || defaultPortionUnit || "").trim();
      if (unit) {
        const qty = option.stock_qty ?? 1;
        parts.push(`${qty} ${unit}`);
      } else if (option.stock_qty != null && option.stock_qty !== 1) {
        parts.push(`${option.stock_qty}x`);
      }
      if (showMoney) {
        const price = group.included ? 0 : Number(option.price_delta) || 0;
        if (price > 0) {
          parts.push(`+KSh ${price.toLocaleString()}`);
        }
      }
      if (parts.length > 0) {
        return `${option.name} (${parts.join(" · ")})`;
      }
      return option.name;
    })
    .join(" · ");
}

function groupPortionQty(group: ModifierGroup): number {
  const active = group.options.find((opt) => opt.is_active !== false) ?? group.options[0];
  const qty = Number(active?.stock_qty);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function groupPortionUnit(group: ModifierGroup, fallbackUnit?: string): string {
  const active = group.options.find((opt) => opt.is_active !== false && opt.portion_unit?.trim()) ??
    group.options.find((opt) => opt.portion_unit?.trim());
  return (active?.portion_unit || fallbackUnit || "servings").trim();
}

/** The ordered option groups attached to a dish or meal, with attach / reorder / edit. */
export function MenuOptionsField({
  label,
  hint,
  groups,
  attachedIds,
  onChange,
  onNewGroup,
  onEditGroup,
  showMoney = true,
  servingUnit,
  onUpdateGroup,
}: {
  label: string;
  hint?: string;
  groups: ModifierGroup[];
  attachedIds: string[];
  onChange: (ids: string[]) => void;
  onNewGroup: () => void;
  onEditGroup: (group: ModifierGroup) => void;
  showMoney?: boolean;
  servingUnit?: string;
  onUpdateGroup?: (group: ModifierGroup, persist?: boolean) => void | Promise<void>;
}) {
  const [portionDrafts, setPortionDrafts] = useState<Record<string, string>>({});
  const byId = new Map(groups.map((group) => [group.id, group]));
  const attached = attachedIds.map((id) => byId.get(id)).filter((g): g is ModifierGroup => !!g);
  const available = groups.filter((group) => !attachedIds.includes(group.id));

  function move(id: string, step: -1 | 1) {
    const index = attachedIds.indexOf(id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= attachedIds.length) return;
    const next = [...attachedIds];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function applyPortionToGroup(group: ModifierGroup, qty: number): ModifierGroup {
    const unit = groupPortionUnit(group, servingUnit);
    return {
      ...group,
      options: group.options.map((opt) => ({
        ...opt,
        stock_qty: qty,
        portion_unit: (opt.portion_unit || unit).trim() || null,
      })),
    };
  }

  function handlePortionInputChange(group: ModifierGroup, raw: string) {
    setPortionDrafts((prev) => ({ ...prev, [group.id]: raw }));
    const parsed = Number(raw.trim());
    if (raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
      const nextGroup = applyPortionToGroup(group, parsed);
      void onUpdateGroup?.(nextGroup, false);
    }
  }

  async function commitPortionInput(group: ModifierGroup) {
    const raw = portionDrafts[group.id];
    setPortionDrafts((prev) => {
      if (!(group.id in prev)) return prev;
      const next = { ...prev };
      delete next[group.id];
      return next;
    });
    if (raw === undefined) return;
    const parsed = Number(raw.trim());
    if (!raw.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    const nextGroup = applyPortionToGroup(group, parsed);
    if (onUpdateGroup) {
      await onUpdateGroup(nextGroup, true);
      return;
    }
    try {
      await saveModifierGroup(group.id, {
        name: nextGroup.name,
        min_select: nextGroup.min_select,
        max_select: nextGroup.max_select,
        is_extra: nextGroup.is_extra,
        included: Boolean(nextGroup.included),
        options: nextGroup.options.map((opt) => ({
          ...modifierOptionInput(opt),
          stock_qty: opt.stock_qty ?? parsed,
          portion_unit: opt.portion_unit ?? groupPortionUnit(group, servingUnit),
        })),
      });
    } catch (err) {
      await showError("Could not update modifier portion", extractErrorMessage(err));
    }
  }

  return (
    <div className="pos-menu-modal__field">
      <div className="pos-menu-modal__label-row">
        <label>{label}</label>
        {hint ? <span className="pos-menu-modal__label-hint">{hint}</span> : null}
      </div>
      {attached.length ? (
        <ul className="tc-group__attached">
          {attached.map((group, index) => {
            const unitLabel = groupPortionUnit(group, servingUnit);
            const draftVal =
              portionDrafts[group.id] !== undefined
                ? portionDrafts[group.id]
                : String(groupPortionQty(group));
            return (
              <li key={group.id}>
                <button type="button" className="tc-group__attached-body" onClick={() => onEditGroup(group)}>
                  <strong>{group.name}</strong>
                  <span className="tc-group__attached-rule">{modifierRuleLabel(group)}</span>
                  <span className="tc-group__attached-options">
                    {modifierOptionsSummary(group, showMoney, servingUnit)}
                  </span>
                </button>
                <label
                  className="tc-group__attached-portion"
                  onClick={(e) => e.stopPropagation()}
                  title={`Portion per serving (${unitLabel})`}
                >
                  <span className="tc-group__attached-portion-label">Portion per serving</span>
                  <span className="tc-group__attached-portion-control">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="100000"
                      step="any"
                      placeholder="1"
                      aria-label={`Portion per serving for ${group.name}`}
                      value={draftVal}
                      onChange={(e) => handlePortionInputChange(group, e.target.value)}
                      onBlur={() => void commitPortionInput(group)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    <span className="tc-group__attached-portion-unit">{unitLabel}</span>
                  </span>
                </label>
                <span className="tc-group__option-tools">
                  <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(group.id, -1)}>
                    <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === attached.length - 1}
                    onClick={() => move(group.id, 1)}
                  >
                    <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Detach ${group.name}`}
                    onClick={() => onChange(attachedIds.filter((id) => id !== group.id))}
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
        {available.length ? (
          <select
            className="tc-menu__select"
            value=""
            aria-label="Attach a modifier"
            onChange={(e) => {
              if (e.target.value) onChange([...attachedIds, e.target.value]);
            }}
          >
            <option value="">Attach modifier…</option>
            {available.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({modifierRuleLabel(group).toLowerCase()})
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="tc-group__add-option" onClick={onNewGroup}>
          <i className="fa-solid fa-plus" aria-hidden="true" /> New modifier
        </button>
      </div>
    </div>
  );
}

/** Sheet listing every option group the shop has, with how many items use each. */
export function TransChapMenuGroupsSheet({
  groups,
  onClose,
  onNew,
  onEdit,
}: {
  groups: ModifierGroup[];
  onClose: () => void;
  onNew: () => void;
  onEdit: (group: ModifierGroup) => void;
}) {
  return (
    <div className="pos-menu-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="pos-menu-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="groups-sheet-title"
      >
        <div className="pos-menu-modal__drag-handle" />
        <header className="pos-menu-modal__header">
          <div className="pos-menu-modal__title-row">
            <h2 id="groups-sheet-title" className="pos-menu-modal__title">
              Modifiers
            </h2>
            <button type="button" className="pos-menu-modal__close-btn" onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="pos-menu-modal__body">
          <p className="tc-group__intro">
            Questions the till asks, like &ldquo;Choose your drink&rdquo; or &ldquo;Size&rdquo;. Attach them to
            dishes and meals.
          </p>
          {groups.length ? (
            <ul className="tc-group__attached">
              {groups.map((group) => (
                <li key={group.id}>
                  <button type="button" className="tc-group__attached-body" onClick={() => onEdit(group)}>
                    <strong>{group.name}</strong>
                    <span className="tc-group__attached-rule">
                      {modifierRuleLabel(group)} ·{" "}
                      {group.item_count
                        ? `${group.item_count} item${group.item_count === 1 ? "" : "s"}`
                        : "not used yet"}
                    </span>
                    <span className="tc-group__attached-options">{modifierOptionsSummary(group)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tc-menu__empty">No modifiers yet.</p>
          )}
          <footer className="pos-menu-modal__footer tc-menu__footer">
            <button type="button" className="pos-menu-modal__submit-btn" onClick={onNew}>
              New modifier
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
