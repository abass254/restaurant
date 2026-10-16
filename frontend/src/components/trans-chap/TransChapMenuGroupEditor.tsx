"use client";

import { FormEvent, useState } from "react";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import {
  deleteModifierGroup,
  inventoryProductName,
  modifierRuleLabel,
  saveModifierGroup,
} from "@/lib/trans-chap-product";
import type { InventoryItem, ModifierGroup } from "@/lib/types";

type RuleKind = "pick_one" | "optional_one" | "several";

type OptionDraft = {
  key: string;
  id?: string;
  name: string;
  /** Blank means free (part of the meal price). */
  price: string;
  /** Optional supply this choice uses up; most choices (sizes, notes) have none. */
  productId: string;
  /** Amount of the supply one pick uses, in the supply's unit. */
  qty: string;
  /** Stock link row is open. */
  tracking: boolean;
  isDefault: boolean;
};

let draftSeq = 0;
function nextKey(): string {
  draftSeq += 1;
  return `opt-${draftSeq}`;
}

function blankOption(): OptionDraft {
  return { key: nextKey(), name: "", price: "", productId: "", qty: "1", tracking: false, isDefault: false };
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
  supplies,
  onClose,
  onSaved,
  onDeleted,
}: {
  group: ModifierGroup | null;
  /** Stock bought through Purchases; an option can optionally use one of these. */
  supplies: InventoryItem[];
  onClose: () => void;
  onSaved: (group: ModifierGroup) => void;
  onDeleted?: (groupId: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [rule, setRule] = useState<RuleKind>(ruleKindOf(group));
  const [maxText, setMaxText] = useState(String(group && group.max_select > 1 ? group.max_select : 3));
  // Kept for older modifiers that require several picks; new ones start at 0.
  const [minText, setMinText] = useState(String(group && group.max_select > 1 ? group.min_select : 0));
  const showMin = !!group && group.max_select > 1 && group.min_select > 0;
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    group?.options.length
      ? group.options.map((option) => ({
          key: nextKey(),
          id: option.id,
          name: option.name,
          price: !group.included && option.price_delta ? String(option.price_delta) : "",
          productId: option.product_id ?? "",
          qty: String(option.stock_qty ?? 1),
          tracking: !!option.product_id,
          isDefault: option.is_default,
        }))
      : [blankOption(), blankOption()],
  );
  const [saving, setSaving] = useState(false);

  const suppliesById = new Map(supplies.map((item) => [item.product_id, item]));
  // Options saved earlier may link to items that are no longer listed as supplies.
  const linkedElsewhere = (group?.options ?? []).filter(
    (option) => option.product_id && !suppliesById.has(option.product_id),
  );

  const filled = options.filter((option) => !!option.name.trim());
  const [minSelect, maxSelect] =
    rule === "pick_one"
      ? [1, 1]
      : rule === "optional_one"
        ? [0, 1]
        : [showMin ? parseCount(minText, 0) : 0, Math.max(2, parseCount(maxText, 3))];
  const priceError = filled.some((option) => option.price.trim() && parseAmount(option.price) == null && Number(option.price) !== 0);
  const qtyError = filled.some((option) => option.productId && parseAmount(option.qty) == null);
  const ruleError =
    minSelect > maxSelect
      ? "Minimum can't be more than the maximum."
      : filled.length && minSelect > filled.length
        ? "Add more options than customers must pick."
        : null;
  const canSave = !saving && !!name.trim() && filled.length > 0 && !ruleError && !priceError && !qtyError;

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

  function linkSupply(option: OptionDraft, productId: string) {
    const supply = suppliesById.get(productId);
    patchOption(option.key, {
      productId,
      name: option.name.trim() || !supply ? option.name : inventoryProductName(supply),
    });
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
        included: false,
        options: filled.map((option) => ({
          ...(option.id ? { id: option.id } : {}),
          name: option.name.trim(),
          price_delta: parseAmount(option.price) ?? 0,
          product_id: option.productId || null,
          stock_qty: option.productId ? (parseAmount(option.qty) ?? 1) : 1,
          is_default: option.isDefault,
        })),
      });
      await toastSuccess(group ? `"${saved.name}" updated` : `"${saved.name}" created`);
      onSaved(saved);
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
      onDeleted?.(group.id);
    } catch (err) {
      await showError("Could not delete", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-menu-modal-backdrop tc-group-backdrop" onClick={() => !saving && onClose()} role="presentation">
      <div
        className="pos-menu-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-editor-title"
      >
        <div className="pos-menu-modal__drag-handle" />
        <header className="pos-menu-modal__header">
          <div className="pos-menu-modal__title-row">
            <h2 id="group-editor-title" className="pos-menu-modal__title">
              {group ? "Edit modifier" : "New modifier"}
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
                placeholder="e.g. Size, Drink, Extras"
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
              <label>Options</label>
              <span className="pos-menu-modal__label-hint">Leave price empty if free</span>
            </div>
            <ul className="tc-mod__options">
              {options.map((option, index) => {
                const supply = suppliesById.get(option.productId);
                const badPrice = !!option.price.trim() && parseAmount(option.price) == null && Number(option.price) !== 0;
                return (
                  <li key={option.key} className="tc-mod__option">
                    <div className="tc-mod__row">
                      <input
                        type="text"
                        className="tc-mod__name"
                        placeholder={index === 0 ? "e.g. Large" : "Option name"}
                        aria-label="Option name"
                        value={option.name}
                        onChange={(e) => patchOption(option.key, { name: e.target.value })}
                      />
                      <label className={`tc-mod__price${badPrice ? " is-error" : ""}`}>
                        <span>+KES</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          aria-label="Extra price"
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

                    {option.tracking ? (
                      <div className="tc-mod__stock">
                        <span>Uses</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Amount used per pick"
                          className={option.productId && parseAmount(option.qty) == null ? "is-error" : undefined}
                          value={option.qty}
                          onChange={(e) => patchOption(option.key, { qty: e.target.value })}
                        />
                        <select
                          aria-label="Supply used"
                          value={option.productId}
                          onChange={(e) => linkSupply(option, e.target.value)}
                        >
                          <option value="">Choose stock…</option>
                          {supplies.map((item) => (
                            <option key={item.id} value={item.product_id}>
                              {inventoryProductName(item)}
                              {item.product?.unit ? ` (${item.product.unit})` : ""}
                            </option>
                          ))}
                          {linkedElsewhere.map((linked) => (
                            <option key={linked.id} value={linked.product_id ?? ""}>
                              {linked.product_name || linked.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="tc-mod__icon"
                          aria-label="Stop tracking stock"
                          onClick={() => patchOption(option.key, { tracking: false, productId: "" })}
                        >
                          <i className="fa-solid fa-link-slash" aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}

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
                      {!option.tracking && supplies.length ? (
                        <button
                          type="button"
                          className="tc-mod__link"
                          onClick={() => patchOption(option.key, { tracking: true })}
                        >
                          <i className="fa-solid fa-box" aria-hidden="true" /> Uses stock
                        </button>
                      ) : supply ? (
                        <span className="tc-mod__note">
                          {supply.stock_quantity != null ? `${supply.stock_quantity} ${supply.product?.unit || ""} on hand` : ""}
                        </span>
                      ) : null}
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
            <button
              type="button"
              className="tc-group__add-option tc-mod__add"
              onClick={() => setOptions((prev) => [...prev, blankOption()])}
            >
              <i className="fa-solid fa-plus" aria-hidden="true" /> Add option
            </button>
          </div>

          <footer className="pos-menu-modal__footer tc-menu__footer">
            {group ? (
              <button type="button" className="tc-menu__remove" disabled={saving} onClick={() => void handleDelete()}>
                Delete
              </button>
            ) : null}
            <button type="submit" disabled={!canSave} className="pos-menu-modal__submit-btn">
              {saving ? "Saving…" : group ? "Save modifier" : "Create modifier"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/** Summary line under a group, e.g. "Small · Medium · Large +50". */
export function modifierOptionsSummary(group: ModifierGroup): string {
  return group.options
    .filter((option) => option.is_active)
    .map((option) => {
      const price = group.included ? 0 : Number(option.price_delta) || 0;
      return price > 0 ? `${option.name} +${price}` : option.name;
    })
    .join(" · ");
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
}: {
  label: string;
  hint?: string;
  groups: ModifierGroup[];
  attachedIds: string[];
  onChange: (ids: string[]) => void;
  onNewGroup: () => void;
  onEditGroup: (group: ModifierGroup) => void;
}) {
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

  return (
    <div className="pos-menu-modal__field">
      <div className="pos-menu-modal__label-row">
        <label>{label}</label>
        {hint ? <span className="pos-menu-modal__label-hint">{hint}</span> : null}
      </div>
      {attached.length ? (
        <ul className="tc-group__attached">
          {attached.map((group, index) => (
            <li key={group.id}>
              <button type="button" className="tc-group__attached-body" onClick={() => onEditGroup(group)}>
                <strong>{group.name}</strong>
                <span className="tc-group__attached-rule">{modifierRuleLabel(group)}</span>
                <span className="tc-group__attached-options">{modifierOptionsSummary(group)}</span>
              </button>
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
          ))}
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
