"use client";

import {
  FormEvent,
  type RefObject,
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
} from "@/components/trans-chap/TransChapMenuGroupEditor";
import { ComboIncludesField, type ComboPart } from "@/components/trans-chap/TransChapMenuComboEditor";
import {
  RecipeField,
  parseRecipeQty,
  recipeDraftLines,
  type RecipeDraft,
} from "@/components/trans-chap/TransChapMenuRecipeField";
import Link from "next/link";
import {
  DEFAULT_MENU_SECTIONS,
  createMenuItem,
  fetchMenuSections,
  fetchModifierGroups,
  inventoryProductName,
  isHotelMenuItem,
  isMenuAddonItem,
  isMenuComboItem,
  isSupplyItem,
  menuSection,
  modifierRuleLabel,
  saveComboComponents,
  saveItemModifierGroups,
  saveRecipe,
  recipeCost,
  updateInventoryActive,
  updateMenuItem,
  type MenuSectionDef,
} from "@/lib/trans-chap-product";
import { fetchMenuCosting, type MenuCosting } from "@/lib/restaurant-supplies";
import type { InventoryItem, InventoryResponse, ModifierGroup } from "@/lib/types";

type ItemKind = "meal" | "combo";

type Editor = {
  kind: ItemKind;
  item: InventoryItem | null;
  name: string;
  price: string;
  section: string;
  groupIds: string[];
  parts: ComboPart[];
  recipe: RecipeDraft[];
};

type GroupEditorState = { group: ModifierGroup | null; attach: boolean };

function stockLine(costing: MenuCosting | undefined) {
  if (!costing) return null;
  if (!costing.has_recipe) {
    return <span className="tc-menu__card-stock is-warn">No recipe · supplies not tracked</span>;
  }
  const left = costing.portions_available;
  if (left == null) return null;
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
      {left} {left === 1 ? "portion" : "portions"} left{more}
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

function itemParts(item: InventoryItem | null | undefined): ComboPart[] {
  return (item?.product?.combo_components ?? []).map((part) => ({
    productId: part.component_product_id,
    name: part.name || "Item",
    quantity: part.quantity,
  }));
}

function itemRecipe(item: InventoryItem | null | undefined): { productId: string; quantity: number }[] {
  return (item?.product?.recipe ?? []).map((line) => ({
    productId: line.ingredient_product_id,
    quantity: line.quantity,
  }));
}

function sameRecipe(
  a: { productId: string; quantity: number }[],
  b: { productId: string; quantity: number }[],
): boolean {
  return (
    a.length === b.length &&
    a.every((line, index) => line.productId === b[index].productId && line.quantity === b[index].quantity)
  );
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameParts(a: ComboPart[], b: ComboPart[]): boolean {
  return (
    a.length === b.length &&
    a.every((part, index) => part.productId === b[index].productId && part.quantity === b[index].quantity)
  );
}

export function TransChapMenuForm() {
  const user = useAuthUser();
  const accountId = (user.active_account ?? user.account)?.id ?? null;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuSections, setMenuSections] = useState<MenuSectionDef[]>(DEFAULT_MENU_SECTIONS);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [costing, setCosting] = useState<Map<string, MenuCosting>>(new Map());
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const priceRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<InventoryResponse>(`${apiRoutes.inventory}?active=true`)
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
  }, []);

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

  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const menuItems = useMemo(
    () => items.filter((item) => item.is_active && isHotelMenuItem(item) && !isMenuAddonItem(item)),
    [items],
  );
  const dishes = useMemo(() => menuItems.filter((item) => !isMenuComboItem(item)), [menuItems]);
  const supplies = useMemo(
    () =>
      items
        .filter((item) => item.is_active && isSupplyItem(item))
        .sort((a, b) => inventoryProductName(a).localeCompare(inventoryProductName(b))),
    [items],
  );
  const itemsByProductId = useMemo(() => new Map(items.map((item) => [item.product_id, item])), [items]);

  /** Ingredient cost of one plate; a meal adds up its dishes (or their buying price). */
  function plateCost(item: InventoryItem): { cost: number; priced: boolean } | null {
    if (!isMenuComboItem(item)) {
      const recipe = itemRecipe(item);
      return recipe.length ? recipeCost(recipe, itemsByProductId) : null;
    }
    let cost = 0;
    let priced = true;
    let known = false;
    for (const part of item.product?.combo_components ?? []) {
      const dish = itemsByProductId.get(part.component_product_id);
      const recipe = itemRecipe(dish);
      if (recipe.length) {
        const sub = recipeCost(recipe, itemsByProductId);
        cost += sub.cost * part.quantity;
        priced &&= sub.priced;
        known = true;
      } else if (dish?.buying_price != null) {
        cost += dish.buying_price * part.quantity;
        known = true;
      } else {
        priced = false;
      }
    }
    return known ? { cost, priced } : null;
  }

  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      menuItems
        .filter(
          (item) =>
            !needle ||
            inventoryProductName(item).toLowerCase().includes(needle) ||
            (item.product?.combo_components ?? []).some((part) =>
              (part.name || "").toLowerCase().includes(needle),
            ),
        )
        .sort((a, b) => inventoryProductName(a).localeCompare(inventoryProductName(b))),
    [menuItems, needle],
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

  function focusField(ref: RefObject<HTMLInputElement | null>) {
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 80);
  }

  function openNew(kind: ItemKind, name = "") {
    const existing = name
      ? menuItems.find((item) => sameName(inventoryProductName(item), name))
      : undefined;
    if (existing) {
      openExisting(existing);
      return;
    }
    setEditor({
      kind,
      item: null,
      name,
      price: "",
      section: menuSections[0]?.id ?? "mains",
      groupIds: [],
      parts: [],
      recipe: [],
    });
    focusField(name ? priceRef : nameRef);
  }

  function openExisting(item: InventoryItem) {
    setEditor({
      kind: isMenuComboItem(item) ? "combo" : "meal",
      item,
      name: inventoryProductName(item),
      price: item.selling_price != null ? String(item.selling_price) : "",
      section: menuSection(item, menuSections),
      groupIds: itemGroupIds(item).filter((id) => !groups.length || groupsById.has(id)),
      parts: itemParts(item),
      recipe: itemRecipe(item).map((line) => ({ productId: line.productId, qty: String(line.quantity) })),
    });
  }

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
    const name = editor.name.trim();
    const price = parsePrice(editor.price);
    if (!name || price == null || price <= 0) return;

    const current = editor.item;
    const clash = menuItems.find(
      (item) => item.id !== current?.id && sameName(inventoryProductName(item), name),
    );
    if (clash) {
      await showError("Already on the menu", `"${name}" is already saved. Edit that one instead.`);
      return;
    }

    const input = { name, price, productType: editor.kind, section: editor.section };
    const priorGroups = itemGroupIds(current);
    const priorParts = itemParts(current);
    const priorRecipe = itemRecipe(current);
    const recipeLines = recipeDraftLines(editor.recipe);
    const catalogueChanged =
      !!current?.product &&
      (!sameName(current.product.name, name) ||
        current.product.product_type !== editor.kind ||
        menuSection(current, menuSections) !== editor.section ||
        !sameIds(priorGroups, editor.groupIds) ||
        (editor.kind === "combo" && !sameParts(priorParts, editor.parts)));
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
      if (editor.kind === "combo" && !sameParts(sameProduct ? priorParts : [], editor.parts)) {
        const parts = await saveComboComponents(
          saved.product_id,
          editor.parts.map((part) => ({ product_id: part.productId, quantity: part.quantity })),
        );
        if (saved.product) saved = { ...saved, product: { ...saved.product, combo_components: parts } };
      }
      if (editor.kind === "meal" && !sameRecipe(sameProduct ? priorRecipe : [], recipeLines)) {
        const recipe = await saveRecipe(
          saved.product_id,
          recipeLines.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
        );
        if (saved.product) saved = { ...saved, product: { ...saved.product, recipe } };
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

  async function handleRemove() {
    const current = editor?.item;
    if (!current || saving) return;
    const name = inventoryProductName(current);
    const ok = await confirmAction(
      `Remove "${name}" from the menu?`,
      "It stays in your catalogue and can be turned back on from Stocks.",
      "Remove",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await updateInventoryActive(current.id, false);
      setItems((prev) => prev.filter((row) => row.id !== current.id));
      setEditor(null);
      await toastSuccess(`"${name}" removed`);
    } catch (err) {
      await showError("Could not remove", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const editorPrice = editor ? parsePrice(editor.price) : null;
  const isCombo = editor?.kind === "combo";
  const canSave =
    !!editor &&
    !saving &&
    !!editor.name.trim() &&
    editorPrice != null &&
    editorPrice > 0 &&
    (!isCombo || editor.parts.length > 0) &&
    (isCombo || editor.recipe.every((row) => !row.productId || parseRecipeQty(row.qty) != null));
  const overlayOpen = !!editor || !!groupEditor || showGroups;

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
        <button type="button" className="tc-menu__add-row" onClick={() => openNew("meal", search.trim())}>
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Add &ldquo;{search.trim()}&rdquo; to the menu
        </button>
      ) : null}

      {loading ? (
        <p className="tc-menu__empty">Loading menu…</p>
      ) : menuItems.length === 0 ? (
        <p className="tc-menu__empty">
          Your menu is empty. Tap + to add the first dish you serve.
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.id} id={`menu-${section.id}`} className="tc-menu__section">
            <h3 className="tc-menu__section-title">{section.label}</h3>
            <ul className="tc-menu__cards">
              {section.rows.map((item) => {
                const itemGroups = liveGroups(item);
                const combo = isMenuComboItem(item);
                const parts = item.product?.combo_components ?? [];
                const cost = plateCost(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="tc-menu__card"
                      onClick={() => openExisting(item)}
                    >
                      <TransChapProductThumb item={item} size="md" />
                      <span className="tc-menu__card-body">
                        <span className="tc-menu__card-head">
                          <strong>
                            {inventoryProductName(item)}
                            {combo ? <em className="tc-menu__meal-badge">Meal</em> : null}
                          </strong>
                          <span className="tc-menu__card-price">
                            {item.selling_price != null
                              ? `${combo && itemGroups.length ? "from " : ""}${formatKsh(item.selling_price)}`
                              : "—"}
                          </span>
                        </span>
                        {combo ? (
                          <span className="tc-menu__card-hint">
                            {[
                              ...parts.map((part) =>
                                part.quantity > 1 ? `${part.quantity}× ${part.name}` : part.name || "Item",
                              ),
                              ...itemGroups.map((group) => group.name),
                            ].join(" + ") || "No dishes yet"}
                          </span>
                        ) : itemGroups.length ? (
                          <span className="tc-menu__card-addons">
                            {itemGroups.map((group) => (
                              <span key={group.id} className="tc-menu__addon-tag">
                                {group.name}
                                <em>{modifierRuleLabel(group).split(" · ")[0].toLowerCase()}</em>
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="tc-menu__card-hint">No options</span>
                        )}
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
            { label: "Add dish", icon: "fa-utensils", onClick: () => openNew("meal", exactMatch ? "" : search.trim()) },
            { label: "Add meal", icon: "fa-burger", onClick: () => openNew("combo") },
            { label: "Option groups", icon: "fa-list-check", onClick: () => setShowGroups(true) },
          ]}
        />
      )}

      {showGroups && !groupEditor ? (
        <TransChapMenuGroupsSheet
          groups={groups}
          onClose={() => setShowGroups(false)}
          onNew={() => setGroupEditor({ group: null, attach: false })}
          onEdit={(group) => setGroupEditor({ group, attach: false })}
        />
      ) : null}

      {editor ? (
        <div
          className="pos-menu-modal-backdrop"
          onClick={() => !saving && !groupEditor && setEditor(null)}
          role="presentation"
          style={groupEditor ? { display: "none" } : undefined}
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
                  {editor.item ? (isCombo ? "Edit meal" : "Edit dish") : isCombo ? "New meal" : "New dish"}
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
                    placeholder={isCombo ? "e.g. Big Mac Meal" : "e.g. Beef stew"}
                    value={editor.name}
                    onChange={(e) => patchEditor({ name: e.target.value })}
                    className="pos-menu-modal__text-input"
                  />
                </div>
              </div>

              <div className="pos-menu-modal__field">
                <label htmlFor="menu-editor-price">{isCombo ? "Meal price" : "Price"}</label>
                <div className="pos-menu-modal__price-wrap">
                  <span className="pos-menu-modal__price-prefix">KES</span>
                  <input
                    id="menu-editor-price"
                    ref={priceRef}
                    type="text"
                    required
                    inputMode="decimal"
                    placeholder="0"
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

              {isCombo ? (
                <ComboIncludesField
                  dishes={dishes}
                  parts={editor.parts}
                  onChange={(parts) => patchEditor({ parts })}
                />
              ) : (
                <RecipeField
                  supplies={supplies}
                  rows={editor.recipe}
                  price={editorPrice}
                  onChange={(recipe) => patchEditor({ recipe })}
                />
              )}

              <MenuOptionsField
                label={isCombo ? "Choices" : "Options"}
                hint={isCombo ? "e.g. Size, Choose side, Choose drink" : "e.g. Burger changes, Add-ons"}
                groups={groups}
                attachedIds={editor.groupIds}
                onChange={(groupIds) => patchEditor({ groupIds })}
                onNewGroup={() => setGroupEditor({ group: null, attach: true })}
                onEditGroup={(group) => setGroupEditor({ group, attach: false })}
              />

              <footer className="pos-menu-modal__footer tc-menu__footer">
                {editor.item ? (
                  <button
                    type="button"
                    className="tc-menu__remove"
                    disabled={saving}
                    onClick={() => void handleRemove()}
                  >
                    Remove
                  </button>
                ) : null}
                <button type="submit" disabled={!canSave} className="pos-menu-modal__submit-btn">
                  {saving
                    ? "Saving…"
                    : editor.item
                      ? "Save changes"
                      : isCombo
                        ? "Add meal"
                        : "Add dish"}
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
          supplies={supplies}
          onClose={() => setGroupEditor(null)}
          onSaved={handleGroupSaved}
          onDeleted={handleGroupDeleted}
        />
      ) : null}
    </div>
  );
}
