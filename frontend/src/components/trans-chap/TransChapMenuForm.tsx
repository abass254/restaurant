"use client";

import {
  FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
import {
  MenuOptionsField,
  TransChapMenuGroupEditor,
  TransChapMenuGroupsSheet,
  type ModifierSources,
} from "@/components/trans-chap/TransChapMenuGroupEditor";
import {
  RecipeField,
  recipeDraftHasMismatchedYield,
  parseRecipeQty,
  recipeDraftHasInvalidPortion,
  recipeDraftLines,
  type RecipeDraft,
} from "@/components/trans-chap/TransChapMenuRecipeField";
import Link from "next/link";
import {
  DEFAULT_MENU_SECTIONS,
  createMenuItem,
  deleteInventoryItem,
  fetchMenuSections,
  fetchModifierGroups,
  hasKitchenRecipe,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
  isSupplyItem,
  menuSection,
  modifierOptionInput,
  modifierRuleLabel,
  saveItemModifierGroups,
  saveModifierGroup,
  saveRecipe,
  type ModifierGroupInput,
  recipeCost,
  updateInventoryActive,
  updateMenuItem,
  type MenuSectionDef,
} from "@/lib/trans-chap-product";
import {
  fetchKitchenEquivalenceUnits,
  fetchMenuCosting,
  type MenuCosting,
} from "@/lib/restaurant-supplies";
import {
  isRestaurantStore,
} from "@/lib/onboarding";
import {
  allowsFractionalSelling,
  mergeFractionalIntoAttributes,
} from "@/lib/sell-units";
import type { InventoryItem, InventoryResponse, ModifierGroup, ModifierOption } from "@/lib/types";

type Editor = {
  item: InventoryItem | null;
  name: string;
  price: string;
  section: string;
  groupIds: string[];
  /** Edited extra prices by option id. */
  extraPrices: Record<string, string>;
  allowFractional: boolean;
};

type GroupEditorState = { group: ModifierGroup | null; attach: boolean };

function stockLine(costing: MenuCosting | undefined) {
  if (!costing) return null;
  if (!costing.has_recipe) {
    return <span className="tc-menu__card-stock is-warn">No recipe · supplies not tracked</span>;
  }
  const left = costing.portions_available;
  if (left == null) return null;
  if (costing.prepared_quantity != null) {
    return (
      <span className={`tc-menu__card-stock${left <= 0 ? " is-out" : ""}`}>
        {left} {costing.serving_unit || "servings"} ready
      </span>
    );
  }
  const more =
    costing.portions_with_store != null && costing.portions_with_store > left
      ? ` · store can cover ${costing.portions_with_store - Math.max(left, 0)} more`
      : "";
  if (left <= 0) {
    return (
      <span className="tc-menu__card-stock is-out">
        Out of stock{costing.limiting_ingredient ? ` (${costing.limiting_ingredient})` : ""}
        {more}
      </span>
    );
  }
  return (
    <span className={`tc-menu__card-stock${left <= 5 ? " is-warn" : ""}`}>
      {left} {costing.serving_unit || "servings"} left{more}
    </span>
  );
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function itemGroupIds(item: InventoryItem | null | undefined): string[] {
  return (item?.product?.modifier_groups ?? []).map((group) => group.id);
}

function itemRecipe(item: InventoryItem | null | undefined): {
  productId: string;
  quantity: number;
  batchQuantity: number;
  batchYield: number;
  servingUnit: string;
  ingredientUnit: string;
}[] {
  return (item?.product?.recipe ?? []).map((line) => ({
    productId: line.ingredient_product_id,
    quantity: line.quantity,
    batchQuantity: line.batch_quantity ?? line.quantity,
    batchYield: line.batch_yield ?? 1,
    servingUnit: line.serving_unit || item?.product?.recipe_serving_unit || "servings",
    ingredientUnit: line.ingredient_unit || line.unit || "",
  }));
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}


export function TransChapMenuForm() {
  const user = useAuthUser();
  const accountId = (user.active_account ?? user.account)?.id ?? null;
  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuSections, setMenuSections] = useState<MenuSectionDef[]>(DEFAULT_MENU_SECTIONS);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [costing, setCosting] = useState<Map<string, MenuCosting>>(new Map());
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [recipeEditor, setRecipeEditor] = useState<InventoryItem | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft[]>([]);
  const [recipeServingUnit, setRecipeServingUnit] = useState("servings");
  const [equivalenceUnits, setEquivalenceUnits] = useState<string[]>([]);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const priceRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<InventoryResponse>(apiRoutes.inventory)
      .then((data) => {
        if (alive) setItems(data.data);
      })
      .catch((err) => {
        if (alive) void showError("Could not load menu", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    fetchMenuSections()
      .then((sections) => {
        if (alive) setMenuSections(sections);
      })
      .catch(() => {
        /* keep default sections */
      });
    if (restaurant) {
      fetchKitchenEquivalenceUnits()
        .then((units) => {
          if (alive) setEquivalenceUnits(units);
        })
        .catch((err) => {
          if (alive) void showError("Could not load portion names", extractErrorMessage(err));
        });
    }
    fetchModifierGroups()
      .then((rows) => {
        if (alive) setGroups(rows);
      })
      .catch(() => {
        /* options can still be created */
      });
    return () => {
      alive = false;
    };
  }, [restaurant]);

  useEffect(() => {
    let alive = true;
    fetchMenuCosting()
      .then((rows) => {
        if (alive) setCosting(new Map(rows.map((row) => [row.inventory_item_id, row])));
      })
      .catch(() => {
        /* stock badges are optional */
      });
    return () => {
      alive = false;
    };
  }, [items]);

  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const modifierGroups = useMemo(() => groups.filter((group) => !group.is_extra), [groups]);
  const menuItems = useMemo(
    () =>
      items.filter((item) => isHotelMenuItem(item)),
    [items],
  );
  const allCount = menuItems.length;
  const activeCount = menuItems.filter((d) => d.is_active).length;
  const inactiveCount = menuItems.filter((d) => !d.is_active).length;

  async function handleToggle(dish: InventoryItem) {
    const nextState = !dish.is_active;
    setTogglingId(dish.id);
    setItems((prev) =>
      prev.map((d) => (d.id === dish.id ? { ...d, is_active: nextState } : d)),
    );
    try {
      await updateInventoryActive(dish.id, nextState);
      await toastSuccess(
        `"${inventoryProductName(dish)}" is now ${nextState ? "available" : "paused"}`,
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((d) => (d.id === dish.id ? { ...d, is_active: !nextState } : d)),
      );
      await showError("Could not update meal availability", extractErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  const supplies = useMemo(
    () =>
      items
        .filter((item) => item.is_active && isSupplyItem(item))
        .sort((a, b) => inventoryProductName(a).localeCompare(inventoryProductName(b))),
    [items],
  );
  const itemsByProductId = useMemo(() => new Map(items.map((item) => [item.product_id, item])), [items]);
  const modifierSources = useMemo<ModifierSources>(
    () => ({
      storeItems: supplies
        .filter((item) => isSaleableRole(inventoryRole(item)) && !isHotelMenuItem(item))
        .map((item) => ({ id: item.product_id, name: inventoryProductName(item) })),
      menuItems: [...menuItems]
        .sort((a, b) => inventoryProductName(a).localeCompare(inventoryProductName(b)))
        .map((item) => ({ id: item.product_id, name: inventoryProductName(item) })),
      extras: groups
        .filter((group) => group.is_extra)
        .flatMap((group) => group.options.map((option) => ({ id: option.id, name: option.name }))),
    }),
    [supplies, menuItems, groups],
  );

  /** Cost of the fixed ingredients of one plate; modifier picks are on top. */
  function plateCost(item: InventoryItem): { cost: number; priced: boolean } | null {
    const recipe = itemRecipe(item);
    return recipe.length ? recipeCost(recipe, itemsByProductId) : null;
  }

  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      menuItems
        .filter((item) => {
          if (statusFilter === "active" && !item.is_active) return false;
          if (statusFilter === "inactive" && item.is_active) return false;
          return !needle || inventoryProductName(item).toLowerCase().includes(needle);
        })
        .sort((a, b) => inventoryProductName(a).localeCompare(inventoryProductName(b))),
    [menuItems, statusFilter, needle],
  );

  const sections = useMemo(
    () =>
      menuSections
        .map((section) => ({
          ...section,
          rows: visible.filter((item) => menuSection(item, menuSections) === section.id),
        }))
        .filter((section) => section.rows.length),
    [menuSections, visible],
  );

  const exactMatch = needle
    ? menuItems.some((item) => sameName(inventoryProductName(item), needle))
    : false;

  /** Live group definitions for an item (falls back to what came with the inventory row). */
  function liveGroups(item: InventoryItem): ModifierGroup[] {
    return (item.product?.modifier_groups ?? [])
      .map((group) => groupsById.get(group.id) ?? (groups.length ? null : group))
      .filter((group): group is ModifierGroup => !!group);
  }

  function isExtraGroupId(groupId: string): boolean {
    return (
      groupsById.get(groupId)?.is_extra ??
      editor?.item?.product?.modifier_groups?.find((group) => group.id === groupId)?.is_extra ??
      false
    );
  }

  const editorExtraGroups = (editor?.groupIds ?? [])
    .filter(isExtraGroupId)
    .map(
      (id) =>
        groupsById.get(id) ?? editor?.item?.product?.modifier_groups?.find((group) => group.id === id) ?? null,
    )
    .filter((group): group is ModifierGroup => !!group);

  function extraPriceText(option: ModifierOption): string {
    return editor?.extraPrices[option.id] ?? (option.price_delta ? String(option.price_delta) : "");
  }

  /** Extra groups whose option prices were edited, ready to save. */
  function changedExtraGroups(): { group: ModifierGroup; input: ModifierGroupInput }[] | null {
    const changed: { group: ModifierGroup; input: ModifierGroupInput }[] = [];
    for (const group of editorExtraGroups) {
      let dirty = false;
      const options = [];
      for (const option of group.options) {
        const text = editor?.extraPrices[option.id];
        const input = modifierOptionInput(option);
        if (text != null) {
          const value = text.trim() ? parsePrice(text) : 0;
          if (value == null) return null;
          if (value !== (Number(option.price_delta) || 0)) {
            input.price_delta = value;
            dirty = true;
          }
        }
        options.push(input);
      }
      if (dirty) {
        changed.push({
          group,
          input: {
            name: group.name,
            min_select: group.min_select ?? 0,
            max_select: group.max_select ?? 1,
            is_extra: true,
            included: false,
            options,
          },
        });
      }
    }
    return changed;
  }

  function focusField(ref: RefObject<HTMLInputElement | null>) {
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 80);
  }

  function openNew(name = "") {
    const existing = name
      ? menuItems.find((item) => sameName(inventoryProductName(item), name))
      : undefined;
    if (existing) {
      openExisting(existing);
      return;
    }
    setEditor({
      item: null,
      name,
      price: "",
      section: menuSections[0]?.id ?? "mains",
      groupIds: [],
      extraPrices: {},
      allowFractional: false,
    });
    focusField(name ? priceRef : nameRef);
  }

  const openExisting = useCallback((item: InventoryItem) => {
    setEditor({
      item,
      name: inventoryProductName(item),
      price: item.selling_price != null ? String(item.selling_price) : "",
      section: menuSection(item, menuSections),
      groupIds: itemGroupIds(item),
      extraPrices: {},
      allowFractional: allowsFractionalSelling(item),
    });
    if (item.selling_price == null) {
      focusField(priceRef);
    }
  }, [menuSections]);

  const openRecipeEditor = useCallback((item: InventoryItem) => {
    setRecipeEditor(item);
    setRecipeServingUnit(item.product?.recipe_serving_unit || "servings");
    setRecipeDraft(
      itemRecipe(item).map((line) => {
        return {
          productId: line.productId,
          portion: String(line.batchQuantity),
          yield: String(line.batchYield),
          servingUnit: line.servingUnit,
          unit: line.ingredientUnit,
        };
      }),
    );
  }, []);

  function patchEditor(patch: Partial<Editor>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function handleGroupSaved(saved: ModifierGroup) {
    const attach = groupEditor?.attach && !groupEditor.group;
    setGroups((prev) =>
      prev.some((group) => group.id === saved.id)
        ? prev.map((group) => (group.id === saved.id ? { ...saved, item_count: group.item_count } : group))
        : [...prev, saved],
    );
    if (attach) {
      setEditor((prev) =>
        prev && !prev.groupIds.includes(saved.id) ? { ...prev, groupIds: [...prev.groupIds, saved.id] } : prev,
      );
    }
    setGroupEditor(null);
  }

  function handleGroupDeleted(groupId: string) {
    setGroups((prev) => prev.filter((group) => group.id !== groupId));
    setEditor((prev) => (prev ? { ...prev, groupIds: prev.groupIds.filter((id) => id !== groupId) } : prev));
    setGroupEditor(null);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!editor || saving) return;
    const current = editor.item;
    const name = editor.name.trim();
    const rawPrice = editor.price.trim();
    const parsedPrice = parsePrice(rawPrice);
    if (!name || (rawPrice !== "" && parsedPrice == null)) return;
    const price = rawPrice === "" ? null : parsedPrice;
    const hasAttachedModifiers = editor.groupIds.some((id) => !isExtraGroupId(id));
    if ((price == null || price <= 0) && !hasAttachedModifiers) {
      await showError(
        "Price or modifier required",
        "Enter a meal price or attach modifiers that determine the price.",
      );
      return;
    }
    const extraChanges = changedExtraGroups();
    if (!extraChanges) {
      await showError("Check extra prices", "Extra prices must be zero or more.");
      return;
    }

    const clash = menuItems.find(
      (item) => item.id !== current?.id && sameName(inventoryProductName(item), name),
    );
    if (clash) {
      await showError("Already on the menu", `"${name}" is already saved. Edit that one instead.`);
      return;
    }

    const attributes = mergeFractionalIntoAttributes(
      current?.attributes,
      editor.allowFractional,
    );
    const input = {
      name,
      price,
      productType: "meal" as const,
      section: editor.section,
      attributes,
    };
    const priorGroups = itemGroupIds(current);
    const catalogueChanged =
      !!current?.product &&
      (!sameName(current.product.name, name) ||
        current.product.product_type !== "meal" ||
        menuSection(current, menuSections) !== editor.section ||
        !sameIds(priorGroups, editor.groupIds));
    const sharedProduct =
      !!current?.product &&
      !!accountId &&
      current.product.created_by_account_id !== accountId;

    setSaving(true);
    try {
      let saved: InventoryItem;
      if (!current) {
        saved = await createMenuItem(input);
      } else if (sharedProduct && catalogueChanged) {
        // Shared catalogue rows belong to every shop, so give this shop its own copy.
        saved = await createMenuItem(input);
        await updateInventoryActive(current.id, false);
      } else {
        saved = await updateMenuItem(current, input);
      }

      const sameProduct = !!current && saved.product_id === current.product_id;
      if (!sameIds(sameProduct ? priorGroups : [], editor.groupIds)) {
        const attached = await saveItemModifierGroups(saved.product_id, editor.groupIds);
        if (saved.product) saved = { ...saved, product: { ...saved.product, modifier_groups: attached } };
      }
      for (const change of extraChanges) {
        await saveModifierGroup(change.group.id, change.input);
      }

      setItems((prev) => [
        saved,
        ...prev.filter((row) => row.id !== saved.id && row.id !== current?.id),
      ]);
      setEditor(null);
      setSearch("");
      fetchModifierGroups()
        .then(setGroups)
        .catch(() => {
          /* counts refresh next visit */
        });
      await toastSuccess(current ? `"${name}" updated` : `"${name}" added to the menu`);
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRecipe() {
    if (!recipeEditor || saving) return;
    if (!recipeServingUnit.trim()) {
      await showError("Enter a serving unit", "Name what one unit of this menu item is called, such as plates or sticks.");
      return;
    }
    if (recipeDraft.some((row) => row.productId && parseRecipeQty(row.yield) == null)) {
      await showError("Check recipe yield", "Enter how many menu portions the selected supply amount will make.");
      return;
    }
    if (recipeDraftHasMismatchedYield(recipeDraft)) {
      await showError("Check recipe yields", "Use the same menu portion count for every supply that makes the same portion.");
      return;
    }
    if (recipeDraftHasInvalidPortion(recipeDraft)) {
      await showError("Enter recipe batch amounts", "Enter the supply amount used for each recipe batch.");
      return;
    }
    const lines = recipeDraftLines(recipeDraft, supplies);
    setSaving(true);
    try {
      const saved = await saveRecipe(
        recipeEditor.product_id,
        lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          batch_quantity: line.batchQuantity,
          batch_yield: line.batchYield,
          serving_unit: line.servingUnit?.trim() || null,
          ingredient_unit: line.ingredientUnit?.trim() || null,
        })),
        recipeServingUnit.trim(),
      );
      setItems((previous) =>
        previous.map((item) =>
          item.id === recipeEditor.id && item.product
            ? {
                ...item,
                product: {
                  ...item.product,
                  recipe: saved.lines,
                  recipe_serving_unit: saved.servingUnit,
                },
              }
            : item,
        ),
      );
      await toastSuccess(`Recipe saved for "${inventoryProductName(recipeEditor)}"`);
      setRecipeEditor(null);
      setRecipeDraft([]);
    } catch (err) {
      await showError("Could not save recipe", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (saving || deletingId) return;
    const name = inventoryProductName(item);
    const ok = await confirmAction(
      `Delete "${name}"?`,
      `This permanently deletes "${name}" from your menu and inventory.`,
      "Delete menu",
    );
    if (!ok) return;
    setDeletingId(item.id);
    setSaving(true);
    try {
      await deleteInventoryItem(item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      if (editor?.item?.id === item.id) {
        setEditor(null);
      }
      await toastSuccess(`"${name}" deleted from menu`);
    } catch (err) {
      await showError("Could not delete menu", extractErrorMessage(err));
    } finally {
      setDeletingId(null);
      setSaving(false);
    }
  }

  const editorPrice = editor ? parsePrice(editor.price) : null;
  const editorPriceRaw = editor ? editor.price.trim() : "";
  const editorHasModifiers = editor ? editor.groupIds.some((id) => !isExtraGroupId(id)) : false;
  const editorHasValidPrice =
    editorPriceRaw === ""
      ? editorHasModifiers
      : editorPrice != null && (editorPrice > 0 || editorHasModifiers);
  const canSave =
    !!editor &&
    !saving &&
    !!editor.name.trim() &&
    editorHasValidPrice;
  const overlayOpen = !!editor || !!recipeEditor || !!groupEditor || showGroups;

  return (
    <div className="tc-menu">
      <div className="tc-menu__scroll">
      <div className="tc-menu__bar">
        <label className="pos-search tc-menu__search">
          <i className="fa-solid fa-magnifying-glass pos-search__icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search your menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="tc-kitchen-search-chips" style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className={`trans-chap-sales__chip ${statusFilter === "all" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("all")}
        >
          All ({allCount})
        </button>
        <button
          type="button"
          className={`trans-chap-sales__chip ${statusFilter === "active" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("active")}
        >
          Available ({activeCount})
        </button>
        <button
          type="button"
          className={`trans-chap-sales__chip ${statusFilter === "inactive" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("inactive")}
        >
          Paused ({inactiveCount})
        </button>
      </div>

      {sections.length > 1 ? (
        <nav className="tc-menu__nav" aria-label="Menu sections">
          {sections.map((section) => (
            <a key={section.id} href={`#menu-${section.id}`} className="tc-menu__chip">
              {section.label}
              <span>{section.rows.length}</span>
            </a>
          ))}
        </nav>
      ) : null}

      {needle && !exactMatch ? (
        <button type="button" className="tc-menu__add-row" onClick={() => openNew(search.trim())}>
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Add &ldquo;{search.trim()}&rdquo; to the menu
        </button>
      ) : null}

      {loading ? (
        <p className="tc-menu__empty">Loading menu…</p>
      ) : menuItems.length === 0 ? (
        <div className="tc-menu__empty">
          <p>Your menu is empty. Tap + to add the first meal you serve.</p>
          {restaurant ? (
            <Link href="/trans-chap/kitchen">Or manage meals and recipes in Kitchen</Link>
          ) : null}
        </div>
      ) : visible.length === 0 ? (
        <p className="tc-menu__empty">No meals match your search or filter.</p>
      ) : (
        sections.map((section) => (
          <section key={section.id} id={`menu-${section.id}`} className="tc-menu__section">
            <h3 className="tc-menu__section-title">{section.label}</h3>
            <ul className="tc-menu__cards">
              {section.rows.map((item) => {
                const itemGroups = liveGroups(item);
                const itemModifiers = itemGroups.filter((group) => !group.is_extra);
                const itemExtras = itemGroups.filter((group) => group.is_extra);
                const cost = plateCost(item);
                return (
                  <li key={item.id} className={item.is_active ? "" : "is-paused"}>
                    <button
                      type="button"
                      className={`tc-menu__card${item.is_active ? "" : " tc-menu__card--paused"}`}
                      onClick={() => openExisting(item)}
                    >
                      <TransChapProductThumb item={item} size="md" />
                      <span className="tc-menu__card-body">
                        <span className="tc-menu__card-head">
                          <strong>
                            {inventoryProductName(item)}
                          </strong>
                          <span
                            className={`tc-menu__card-price${
                              (item.selling_price == null || item.selling_price <= 0) && !itemModifiers.length
                                ? " is-unpriced"
                                : ""
                            }`}
                          >
                            {item.selling_price != null && item.selling_price > 0
                              ? `${itemModifiers.length || itemExtras.length ? "from " : ""}${formatKsh(item.selling_price)}`
                              : itemModifiers.length
                                ? "By modifiers"
                                : "Set price"}
                          </span>
                        </span>
                        {itemModifiers.length ? (
                          <span className="tc-menu__card-addons">
                            {itemModifiers.map((group) => (
                              <span key={group.id} className="tc-menu__addon-tag">
                                {group.name}
                                <em>{modifierRuleLabel(group).split(" · ")[0].toLowerCase()}</em>
                              </span>
                            ))}
                            {allowsFractionalSelling(item) ? (
                              <span className="tc-menu__addon-tag">
                                1/4 · 1/2 · 3/4 · Full
                              </span>
                            ) : null}
                          </span>
                        ) : allowsFractionalSelling(item) ? (
                          <span className="tc-menu__card-addons">
                            <span className="tc-menu__addon-tag">
                              1/4 · 1/2 · 3/4 · Full
                            </span>
                          </span>
                        ) : (
                          <span className="tc-menu__card-hint">No modifiers</span>
                        )}
                        {itemExtras.length ? (
                          <span className="tc-menu__card-addons" aria-label="Extras">
                            {itemExtras.map((group) => (
                              <span key={group.id} className="tc-menu__addon-tag tc-menu__extra-tag">
                                Extra: {group.name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {cost ? (
                          <span className="tc-menu__card-cost">
                            Cost {formatKsh(cost.cost)}
                            {cost.priced ? "" : "+"}
                            {item.selling_price
                              ? ` · ${Math.round(((item.selling_price - cost.cost) / item.selling_price) * 100)}% margin`
                              : ""}
                          </span>
                        ) : null}
                        {stockLine(costing.get(item.id))}
                      </span>
                    </button>
                    <div className="tc-menu__card-side">
                      <div className="tc-menu__card-status">
                        <button
                          type="button"
                          role="switch"
                          className={`theme-switch ${item.is_active ? "is-on" : ""}`}
                          aria-checked={item.is_active}
                          disabled={togglingId === item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleToggle(item);
                          }}
                          aria-label={item.is_active ? `Pause ${inventoryProductName(item)}` : `Enable ${inventoryProductName(item)}`}
                        >
                          <span className="theme-switch__thumb" aria-hidden />
                        </button>
                        <span className={`rs-badge ${item.is_active ? "rs-badge--ok" : "rs-badge--warn"}`}>
                          {item.is_active ? "Available" : "Paused"}
                        </span>
                      </div>
                      <div className="tc-menu__card-actions">
                        {restaurant ? (
                          hasKitchenRecipe(item) ? (
                            <Link
                              href="/trans-chap/kitchen"
                              className="tc-menu__recipe-action tc-menu__recipe-link"
                              title="View recipe in Kitchen"
                            >
                              <i className="fa-solid fa-utensils" aria-hidden="true" />
                              Recipe in Kitchen
                            </Link>
                          ) : (
                            <Link
                              href="/trans-chap/kitchen"
                              className="tc-menu__recipe-action tc-menu__recipe-link is-missing"
                              title="Define recipe in Kitchen"
                            >
                              <i className="fa-solid fa-utensils" aria-hidden="true" />
                              Set recipe in Kitchen
                            </Link>
                          )
                        ) : (
                          <button
                            type="button"
                            className="tc-menu__recipe-action"
                            onClick={() => openRecipeEditor(item)}
                          >
                            <i className="fa-solid fa-list-check" aria-hidden="true" />
                            {item.product?.recipe?.length ? "Edit recipe" : "Set recipe"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="tc-menu__card-del-btn"
                          title={`Delete ${inventoryProductName(item)}`}
                          aria-label={`Delete ${inventoryProductName(item)}`}
                          disabled={deletingId === item.id || saving}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(item);
                          }}
                        >
                          <i
                            className={`fa-solid ${deletingId === item.id ? "fa-spinner fa-spin" : "fa-trash-can"}`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      </div>

      {overlayOpen ? null : (
        <TransChapFab
          label="Add to menu"
          options={[
            { label: "Add meal", icon: "fa-burger", onClick: () => openNew(exactMatch ? "" : search.trim()) },
            { label: "Modifiers", icon: "fa-list-check", onClick: () => setShowGroups(true) },
          ]}
        />
      )}

      {showGroups && !groupEditor && !editor && !recipeEditor ? (
        <TransChapMenuGroupsSheet
          groups={modifierGroups}
          onClose={() => setShowGroups(false)}
          onNew={() => setGroupEditor({ group: null, attach: false })}
          onEdit={(group) => setGroupEditor({ group, attach: false })}
        />
      ) : null}

      {recipeEditor && !groupEditor && !editor ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => !saving && setRecipeEditor(null)}
          role="presentation"
        >
          <div
            className="pos-menu-modal tc-menu__recipe-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipe-editor-title"
          >
            <div className="pos-menu-modal__drag-handle" />
            <header className="pos-menu-modal__header">
              <div className="pos-menu-modal__title-row">
                <div>
                  <h2 id="recipe-editor-title" className="pos-menu-modal__title">Recipe setup</h2>
                  <p className="pos-menu-modal__label-hint">{inventoryProductName(recipeEditor)}</p>
                </div>
                <button
                  type="button"
                  className="pos-menu-modal__close-btn"
                  onClick={() => setRecipeEditor(null)}
                  disabled={saving}
                  aria-label="Close recipe setup"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="pos-menu-modal__body">
              <RecipeField
                label="Recipe batch"
                supplies={supplies}
                rows={recipeDraft}
                price={recipeEditor.selling_price}
                servingUnit={recipeServingUnit}
                onServingUnitChange={setRecipeServingUnit}
                equivalenceUnits={restaurant ? equivalenceUnits : undefined}
                onChange={setRecipeDraft}
              />
              <footer className="pos-menu-modal__footer tc-menu__footer tc-menu__recipe-footer">
                <button
                  type="button"
                  className="rs-btn"
                  onClick={() => setRecipeEditor(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    saving ||
                    !recipeServingUnit.trim() ||
                    recipeDraft.some((row) => row.productId && parseRecipeQty(row.yield) == null) ||
                    recipeDraftHasInvalidPortion(recipeDraft)
                  }
                  className="pos-menu-modal__submit-btn"
                  onClick={() => void handleSaveRecipe()}
                >
                  {saving ? "Saving…" : "Save recipe"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ) : null}

      {editor && !groupEditor && !recipeEditor ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => !saving && !groupEditor && setEditor(null)}
          role="presentation"
        >
          <div
            className="pos-menu-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-editor-title"
          >
            <div className="pos-menu-modal__drag-handle" />
            <header className="pos-menu-modal__header">
              <div className="pos-menu-modal__title-row">
                <h2 id="menu-editor-title" className="pos-menu-modal__title">
                  {editor.item ? (editor.item.selling_price != null ? "Edit meal" : "Price meal") : "New meal"}
                </h2>
                <button
                  type="button"
                  className="pos-menu-modal__close-btn"
                  onClick={() => setEditor(null)}
                  aria-label="Close"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </header>

            <form onSubmit={(e) => void handleSave(e)} className="pos-menu-modal__body">
              <div className="pos-menu-modal__field">
                <label htmlFor="menu-editor-name">Name</label>
                <div className="pos-menu-modal__input-wrap">
                  <input
                    id="menu-editor-name"
                    ref={nameRef}
                    type="text"
                    required
                    autoComplete="off"
                    placeholder="e.g. Beef stew meal"
                    value={editor.name}
                    onChange={(e) => patchEditor({ name: e.target.value })}
                    className="pos-menu-modal__text-input"
                  />
                </div>
              </div>

              <div className="pos-menu-modal__field">
                <div className="pos-menu-modal__label-row">
                  <label htmlFor="menu-editor-price">Price</label>
                  <span className="pos-menu-modal__label-hint">Optional if priced by modifiers</span>
                </div>
                <div className="pos-menu-modal__price-wrap">
                  <span className="pos-menu-modal__price-prefix">KES</span>
                  <input
                    id="menu-editor-price"
                    ref={priceRef}
                    type="text"
                    inputMode="decimal"
                    placeholder="0 (optional with modifiers)"
                    value={editor.price}
                    onChange={(e) => patchEditor({ price: e.target.value })}
                    className="pos-menu-modal__price-input"
                  />
                </div>
              </div>

              <div className="pos-menu-modal__field">
                <div className="pos-menu-modal__label-row">
                  <label>Section</label>
                  <Link
                    href="/trans-chap/settings?pane=menu-sections"
                    className="pos-menu-modal__label-hint"
                  >
                    Edit sections
                  </Link>
                </div>
                <div className="pos-menu-modal__cat-selector">
                  {menuSections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={`pos-menu-modal__cat-btn${editor.section === section.id ? " is-active" : ""}`}
                      onClick={() => patchEditor({ section: section.id })}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pos-menu-modal__field">
                <label className="trans-chap-purchase-modal__bundle-toggle">
                  <input
                    type="checkbox"
                    className="trans-chap-purchase-modal__bundle-check"
                    checked={editor.allowFractional}
                    onChange={(e) =>
                      patchEditor({ allowFractional: e.target.checked })
                    }
                  />
                  <span>
                    <strong>
                      Enable fractional selling (1/4, 1/2, 3/4, Full)
                    </strong>
                    <small>
                      Show 1/4, 1/2, 3/4, and Full portion buttons for this meal
                      on New Sale.
                    </small>
                  </span>
                </label>
              </div>

              <MenuOptionsField
                label="Modifiers"
                hint="Meal choices such as size, drink or preparation"
                groups={modifierGroups}
                attachedIds={editor.groupIds.filter((id) => !isExtraGroupId(id))}
                onChange={(groupIds) =>
                  patchEditor({
                    groupIds: [
                      ...groupIds,
                      ...editor.groupIds.filter(isExtraGroupId),
                    ],
                  })
                }
                onNewGroup={() => setGroupEditor({ group: null, attach: true })}
                onEditGroup={(group) => setGroupEditor({ group, attach: false })}
              />
              <div className="pos-menu-modal__field tc-menu__extras-note">
                <div className="pos-menu-modal__label-row">
                  <label>Extras</label>
                  <span className="pos-menu-modal__label-hint">Set up in Kitchen · priced here</span>
                </div>
                {editorExtraGroups.length ? (
                  <ul className="tc-menu__extra-prices">
                    {editorExtraGroups.flatMap((group) =>
                      group.options.map((option) => (
                        <li key={option.id}>
                          <label htmlFor={`menu-extra-price-${option.id}`}>{option.name}</label>
                          <div className="pos-menu-modal__price-wrap">
                            <span className="pos-menu-modal__price-prefix">KES</span>
                            <input
                              id={`menu-extra-price-${option.id}`}
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={extraPriceText(option)}
                              onChange={(e) =>
                                patchEditor({ extraPrices: { ...editor.extraPrices, [option.id]: e.target.value } })
                              }
                              className="pos-menu-modal__price-input"
                            />
                          </div>
                        </li>
                      )),
                    )}
                  </ul>
                ) : (
                  <p>No extras for this meal yet. Add them in Kitchen, then set their recipe for this meal.</p>
                )}
              </div>

              <footer className="pos-menu-modal__footer tc-menu__footer">
                {editor.item ? (
                  <button
                    type="button"
                    className="tc-menu__remove"
                    disabled={saving || Boolean(deletingId)}
                    onClick={() => void handleDelete(editor.item!)}
                  >
                    {deletingId === editor.item.id ? "Deleting…" : "Delete menu"}
                  </button>
                ) : null}
                <button type="submit" disabled={!canSave} className="pos-menu-modal__submit-btn">
                  {saving
                    ? "Saving…"
                    : editor.item
                      ? editor.item.selling_price != null
                        ? "Save changes"
                        : "Save price"
                      : "Add meal"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {groupEditor ? (
        <TransChapMenuGroupEditor
          key={groupEditor.group?.id ?? "new"}
          group={groupEditor.group}
          sources={modifierSources}
          defaultPortionUnit={recipeServingUnit || "portion"}
          availableUnits={editor?.item?.product?.serving_options ?? []}
          onClose={() => setGroupEditor(null)}
          onSaved={handleGroupSaved}
          onDeleted={handleGroupDeleted}
        />
      ) : null}
    </div>
  );
}
