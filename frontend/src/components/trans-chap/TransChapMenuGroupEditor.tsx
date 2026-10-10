"use client";

import { FormEvent, useState } from "react";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  deleteModifierGroup,
  inventoryProductName,
  inventoryRole,
  inventoryRoleShortLabel,
  modifierRuleLabel,
  saveModifierGroup,
} from "@/lib/trans-chap-product";
import type { InventoryItem, ModifierGroup } from "@/lib/types";

type RuleKind = "pick_one" | "optional_one" | "up_to" | "custom";

/** "supply" options come from stock and deduct it; "instruction" options are kitchen notes like "No pickles". */
type OptionKind = "supply" | "instruction";

type OptionDraft = {
  key: string;
  id?: string;
  kind: OptionKind;
  name: string;
  productId: string;
  isDefault: boolean;
};

let draftSeq = 0;
function nextKey(): string {
  draftSeq += 1;
  return `opt-${draftSeq}`;
}

function blankOption(kind: OptionKind): OptionDraft {
  return { key: nextKey(), kind, name: "", productId: "", isDefault: false };
}

function supplyLabel(item: InventoryItem): string {
  const stock =
    item.stock_quantity != null
      ? ` · ${item.stock_quantity} ${item.product?.unit || "in stock"}`
      : "";
  return `${inventoryProductName(item)} (${inventoryRoleShortLabel(inventoryRole(item))}${stock})`;
}

function ruleKindOf(group: ModifierGroup | null): RuleKind {
  if (!group) return "pick_one";
  const { min_select: low, max_select: high } = group;
  if (low === 1 && high === 1) return "pick_one";
  if (low === 0 && high === 1) return "optional_one";
  if (low === 0) return "up_to";
  return "custom";
}

function parseCount(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const RULES: { kind: RuleKind; label: string }[] = [
  { kind: "pick_one", label: "Required, pick 1" },
  { kind: "optional_one", label: "Optional, pick 1" },
  { kind: "up_to", label: "Optional, up to…" },
  { kind: "custom", label: "Custom" },
];

/** Create or edit one option group, e.g. "Choose drink" with Coke / Fanta / Water. */
export function TransChapMenuGroupEditor({
  group,
  supplies,
  onClose,
  onSaved,
  onDeleted,
}: {
  group: ModifierGroup | null;
  /** Stock bought through Purchases; options are picked from these. */
  supplies: InventoryItem[];
  onClose: () => void;
  onSaved: (group: ModifierGroup) => void;
  onDeleted?: (groupId: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [rule, setRule] = useState<RuleKind>(ruleKindOf(group));
  const [minText, setMinText] = useState(String(group?.min_select ?? 1));
  const [maxText, setMaxText] = useState(String(group?.max_select ?? 3));
  const [included, setIncluded] = useState(group?.included ?? false);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    group?.options.length
      ? group.options.map((option) => ({
          key: nextKey(),
          id: option.id,
          kind: option.product_id ? "supply" : "instruction",
          name: option.name,
          productId: option.product_id ?? "",
          isDefault: option.is_default,
        }))
      : [blankOption("supply")],
  );
  const [saving, setSaving] = useState(false);

  const suppliesById = new Map(supplies.map((item) => [item.product_id, item]));
  // Options saved earlier may link to items that are no longer listed as supplies.
  const linkedElsewhere = (group?.options ?? []).filter(
    (option) => option.product_id && !suppliesById.has(option.product_id),
  );

  function optionName(option: OptionDraft): string {
    if (option.kind === "instruction") return option.name.trim();
    const supply = suppliesById.get(option.productId);
    return supply ? inventoryProductName(supply) : option.name.trim();
  }

  const filled = options.filter((option) =>
    option.kind === "supply" ? !!option.productId : !!option.name.trim(),
  );
  const [minSelect, maxSelect] =
    rule === "pick_one"
      ? [1, 1]
      : rule === "optional_one"
        ? [0, 1]
        : rule === "up_to"
          ? [0, Math.max(1, parseCount(maxText, 3))]
          : [parseCount(minText, 1), Math.max(1, parseCount(maxText, 1))];
  const ruleError =
    minSelect > maxSelect
      ? "Minimum can't be more than the maximum."
      : filled.length && minSelect > filled.length
        ? "Add more options than customers must pick."
        : null;
  const canSave = !saving && !!name.trim() && filled.length > 0 && !ruleError;

  function pickSupply(key: string, productId: string) {
    const supply = suppliesById.get(productId);
    setOptions((prev) =>
      prev.map((option) =>
        option.key === key
          ? { ...option, productId, name: supply ? inventoryProductName(supply) : option.name }
          : option,
      ),
    );
  }

  function priceTag(option: OptionDraft): string {
    if (option.kind === "instruction" || included) return "Free";
    const price = suppliesById.get(option.productId)?.selling_price;
    return price ? `+${formatKsh(Number(price))}` : "No selling price · free";
  }

  function patchOption(key: string, patch: Partial<OptionDraft>) {
    setOptions((prev) =>
      prev.map((option) => {
        if (option.key === key) return { ...option, ...patch };
        // Single-pick groups can only have one default.
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
        included,
        options: filled.map((option) => ({
          ...(option.id ? { id: option.id } : {}),
          name: optionName(option),
          price_delta: 0,
          product_id: option.kind === "supply" ? option.productId : null,
          is_default: option.isDefault,
        })),
      });
      await toastSuccess(group ? `"${saved.name}" updated` : `"${saved.name}" created`);
      onSaved(saved);
    } catch (err) {
      await showError("Could not save options", extractErrorMessage(err));
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
              {group ? "Edit options" : "New option group"}
            </h2>
            <button type="button" className="pos-menu-modal__close-btn" onClick={onClose} aria-label="Close">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>

        <form onSubmit={(e) => void handleSave(e)} className="pos-menu-modal__body">
          <div className="pos-menu-modal__field">
            <label htmlFor="group-editor-name">Question</label>
            <div className="pos-menu-modal__input-wrap">
              <input
                id="group-editor-name"
                type="text"
                autoComplete="off"
                placeholder="e.g. Choose your drink"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pos-menu-modal__text-input"
              />
            </div>
          </div>

          <div className="pos-menu-modal__field">
            <label>Rule</label>
            <div className="pos-menu-modal__cat-selector">
              {RULES.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className={`pos-menu-modal__cat-btn${rule === option.kind ? " is-active" : ""}`}
                  onClick={() => setRule(option.kind)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {rule === "up_to" || rule === "custom" ? (
              <div className="tc-group__counts">
                {rule === "custom" ? (
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
                  <span>At most</span>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={maxText}
                    onChange={(e) => setMaxText(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <p className={`tc-group__rule${ruleError ? " is-error" : ""}`}>
              {ruleError ?? modifierRuleLabel({ min_select: minSelect, max_select: maxSelect })}
            </p>
          </div>

          <div className="pos-menu-modal__field">
            <label>Pricing</label>
            <div className="pos-menu-modal__cat-selector">
              <button
                type="button"
                className={`pos-menu-modal__cat-btn${included ? "" : " is-active"}`}
                onClick={() => setIncluded(false)}
              >
                Charge selling price
              </button>
              <button
                type="button"
                className={`pos-menu-modal__cat-btn${included ? " is-active" : ""}`}
                onClick={() => setIncluded(true)}
              >
                Included in the price
              </button>
            </div>
            <p className="tc-group__rule">
              {included
                ? "Free choice, e.g. the drink that comes with a meal."
                : "Each pick adds the supply's selling price from Stocks. The cashier sets how many at the till."}
            </p>
          </div>

          <div className="pos-menu-modal__field">
            <div className="pos-menu-modal__label-row">
              <label>Options</label>
              <span className="pos-menu-modal__label-hint">Prices come from Stocks</span>
            </div>
            <ul className="tc-group__options">
              {options.map((option, index) => {
                return (
                <li key={option.key} className="tc-group__option">
                  <div className="tc-group__option-main">
                    {option.kind === "supply" ? (
                      <select
                        className="tc-group__supply"
                        aria-label="Supply"
                        value={option.productId}
                        onChange={(e) => pickSupply(option.key, e.target.value)}
                      >
                        <option value="">Choose a supply…</option>
                        {supplies.map((item) => (
                          <option key={item.id} value={item.product_id}>
                            {supplyLabel(item)}
                          </option>
                        ))}
                        {linkedElsewhere.map((linked) => (
                          <option key={linked.id} value={linked.product_id ?? ""}>
                            {linked.product_name || linked.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="e.g. No pickles"
                        aria-label="Instruction"
                        value={option.name}
                        onChange={(e) => patchOption(option.key, { name: e.target.value })}
                      />
                    )}
                  </div>
                  <div className="tc-group__option-meta">
                    <button
                      type="button"
                      className={`tc-group__default${option.isDefault ? " is-on" : ""}`}
                      aria-pressed={option.isDefault}
                      onClick={() => patchOption(option.key, { isDefault: !option.isDefault })}
                    >
                      <i className={`fa-solid ${option.isDefault ? "fa-circle-check" : "fa-circle"}`} aria-hidden="true" />
                      Default
                    </button>
                    <span className="tc-group__instruction-tag">
                      {option.kind === "supply"
                        ? option.productId
                          ? priceTag(option)
                          : ""
                        : "Kitchen instruction · free · no stock"}
                    </span>
                    <span className="tc-group__option-tools">
                      <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => moveOption(option.key, -1)}>
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
                      <button
                        type="button"
                        aria-label={`Remove ${option.name || "option"}`}
                        onClick={() => setOptions((prev) => prev.filter((row) => row.key !== option.key))}
                      >
                        <i className="fa-solid fa-xmark" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                </li>
                );
              })}
            </ul>
            <div className="tc-group__attach-row">
              <button
                type="button"
                className="tc-group__add-option"
                onClick={() => setOptions((prev) => [...prev, blankOption("supply")])}
              >
                <i className="fa-solid fa-box" aria-hidden="true" /> Add from supplies
              </button>
              <button
                type="button"
                className="tc-group__add-option"
                onClick={() => setOptions((prev) => [...prev, blankOption("instruction")])}
              >
                <i className="fa-solid fa-comment" aria-hidden="true" /> Add instruction
              </button>
            </div>
            {supplies.length === 0 ? (
              <p className="tc-group__intro">
                No supplies yet. Record a purchase first (e.g. Coke 500ml as Buy &amp; sell, cheese as Raw
                material) and it will show up here.
              </p>
            ) : null}
          </div>

          <footer className="pos-menu-modal__footer tc-menu__footer">
            {group ? (
              <button type="button" className="tc-menu__remove" disabled={saving} onClick={() => void handleDelete()}>
                Delete
              </button>
            ) : null}
            <button type="submit" disabled={!canSave} className="pos-menu-modal__submit-btn">
              {saving ? "Saving…" : group ? "Save options" : "Create group"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/** Summary line under a group, e.g. "Coke · Fanta · Water (included)". */
export function modifierOptionsSummary(group: ModifierGroup): string {
  const names = group.options
    .filter((option) => option.is_active)
    .map((option) => option.name)
    .join(" · ");
  return group.included ? `${names} (included)` : names;
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
            aria-label="Attach an option group"
            onChange={(e) => {
              if (e.target.value) onChange([...attachedIds, e.target.value]);
            }}
          >
            <option value="">Attach options…</option>
            {available.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({modifierRuleLabel(group).toLowerCase()})
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="tc-group__add-option" onClick={onNewGroup}>
          <i className="fa-solid fa-plus" aria-hidden="true" /> New group
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
              Option groups
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
            <p className="tc-menu__empty">No option groups yet.</p>
          )}
          <footer className="pos-menu-modal__footer tc-menu__footer">
            <button type="button" className="pos-menu-modal__submit-btn" onClick={onNew}>
              New option group
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
