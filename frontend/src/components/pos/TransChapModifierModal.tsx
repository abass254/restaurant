"use client";

import { useId, useMemo, useState } from "react";
import { formatMoney } from "@/lib/orders";
import { formatQty } from "@/lib/restaurant-supplies";
import {
  isOptionAvailable,
  itemModifierGroups,
  modifierOptionPrice,
  modifierRuleLabel,
  optionUnavailableLabel,
  type OptionAvailabilityMap,
} from "@/lib/trans-chap-product";
import type { InventoryItem, ModifierGroup, ModifierOption, OrderItemModifier } from "@/lib/types";

export type ModifierPickResult = {
  /** Chosen option ids, in the order the till asked; the server prices these. */
  optionIds: string[];
  /** Display copy of the picks plus free-form extras. */
  modifiers: OrderItemModifier[];
  notes: string | null;
  unitPrice: number;
  /** Line name, e.g. "Big Mac Meal (Large)". */
  name: string;
};

export type TransChapModifierModalProps = {
  onClose: () => void;
  item: InventoryItem;
  initialOptionIds?: string[] | null;
  initialModifiers?: OrderItemModifier[] | null;
  initialNotes?: string | null;
  currency?: string;
  /** Sold-out / out-of-stock state per option; unavailable options show but can't be picked. */
  availability?: OptionAvailabilityMap | null;
  onConfirm: (result: ModifierPickResult) => void;
};

type Entry = { label: string | null; group: ModifierGroup };

const MAX_COUNT = 20;

function pickableOptions(group: ModifierGroup, availability: OptionAvailabilityMap | null) {
  return group.options.filter((option) => isOptionAvailable(option, availability));
}

/** Multi-pick extras can repeat even when free; other repeats must carry a price. */
function countable(group: ModifierGroup, option: ModifierOption): boolean {
  return (
    !group.included &&
    group.max_select > 1 &&
    (group.is_extra || modifierOptionPrice(option, group) > 0)
  );
}

function initialCounts(initialOptionIds: string[] | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of initialOptionIds ?? []) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

function initialSelection(
  entries: Entry[],
  initialOptionIds: string[] | null | undefined,
  availability: OptionAvailabilityMap | null,
): string[][] {
  if (initialOptionIds) {
    const picks = entries.map(() => [] as string[]);
    for (const id of new Set(initialOptionIds)) {
      const index = entries.findIndex((entry) =>
        pickableOptions(entry.group, availability).some((o) => o.id === id),
      );
      if (index >= 0) picks[index].push(id);
    }
    return picks;
  }
  return entries.map(({ group }) =>
    pickableOptions(group, availability)
      .filter((option) => option.is_default)
      .slice(0, Math.max(1, group.max_select))
      .map((option) => option.id),
  );
}

/** Asks the item's option groups (and, for meals, each included dish's groups) at the till. */
export function TransChapModifierModal({
  onClose,
  item,
  initialOptionIds,
  initialModifiers,
  initialNotes,
  currency = "KES",
  availability = null,
  onConfirm,
}: TransChapModifierModalProps) {
  const headingId = useId();
  const entries = useMemo<Entry[]>(() => itemModifierGroups(item), [item]);
  const [selection, setSelection] = useState<string[][]>(() =>
    initialSelection(entries, initialOptionIds, availability),
  );
  const [counts, setCounts] = useState<Record<string, number>>(() => initialCounts(initialOptionIds));
  const [custom, setCustom] = useState<OrderItemModifier[]>(() =>
    (initialModifiers ?? []).filter((mod) => !mod.option_id && mod.group !== "Includes"),
  );
  const [notes, setNotes] = useState<string>(() => initialNotes || "");

  const basePrice = item.selling_price ?? 0;
  const baseName = item.product?.name ?? "Menu item";

  const picked = useMemo(
    () =>
      entries
        .flatMap((entry, index) =>
          selection[index].map((id) => ({
            entry,
            option: pickableOptions(entry.group, availability).find((o) => o.id === id)!,
          })),
        )
        .filter((pick) => pick.option)
        .map((pick) => ({
          ...pick,
          count: countable(pick.entry.group, pick.option) ? (counts[pick.option.id] ?? 1) : 1,
          unitPrice: modifierOptionPrice(pick.option, pick.entry.group),
        })),
    [entries, selection, counts, availability],
  );
  const optionsTotal = picked.reduce((sum, pick) => sum + pick.unitPrice * pick.count, 0);
  const customTotal = custom.reduce((sum, mod) => sum + (Number(mod.price) || 0), 0);
  const unitTotal = basePrice + optionsTotal + customTotal;
  const missing = entries.filter((entry, index) => selection[index].length < (entry.group.min_select || 0));
  const exhausted = entries.filter(
    (entry) => pickableOptions(entry.group, availability).length < (entry.group.min_select || 0),
  );
  const entryName = (entry: Entry) => (entry.label ? `${entry.label} ${entry.group.name}` : entry.group.name);

  const sizePick =
    item.product?.product_type === "combo"
      ? picked.find((pick) => pick.entry.label == null && /size/i.test(pick.entry.group.name))
      : undefined;
  const lineName = sizePick ? `${baseName} (${sizePick.option.name})` : baseName;

  function toggle(index: number, optionId: string) {
    const { group } = entries[index];
    if (!selection[index].includes(optionId)) setCount(optionId, 1);
    setSelection((prev) =>
      prev.map((ids, i) => {
        if (i !== index) return ids;
        if (ids.includes(optionId)) {
          // Required single-choice groups switch rather than clear.
          if (group.max_select === 1 && group.min_select >= 1) return ids;
          return ids.filter((id) => id !== optionId);
        }
        if (group.max_select === 1) return [optionId];
        if (ids.length >= group.max_select) return ids;
        return [...ids, optionId];
      }),
    );
  }

  function setCount(optionId: string, count: number) {
    setCounts((prev) => ({ ...prev, [optionId]: Math.min(MAX_COUNT, Math.max(1, count)) }));
  }

  function confirm() {
    if (missing.length) return;
    onConfirm({
      optionIds: picked.flatMap((pick) => Array<string>(pick.count).fill(pick.option.id)),
      modifiers: [
        ...picked.map((pick) => ({
          name: pick.option.name,
          price: pick.unitPrice * pick.count,
          group: pick.entry.label ?? pick.entry.group.name,
          option_id: pick.option.id,
          ...(pick.count > 1 ? { quantity: pick.count } : {}),
        })),
        ...custom,
      ],
      notes: notes.trim() || null,
      unitPrice: unitTotal,
      name: lineName,
    });
    onClose();
  }

  function renderGroups(isExtra: boolean) {
    return entries.map((entry, index) => {
      const { group, label } = entry;
      if (group.is_extra !== isExtra) return null;
      const chosen = selection[index];
      const single = group.max_select === 1;
      const full = !single && chosen.length >= group.max_select;
      const required = (group.min_select || 0) > 0;
      const done = chosen.length >= (group.min_select || 0);
      return (
        <section key={`${label ?? ""}-${group.id}`} className="pos-modifier-group">
          <div className="pos-modifier-group__header">
            <h4 className="pos-modifier-group__title">
              {label ? <span className="pos-modifier-group__parent">{label}: </span> : null}
              {group.name}
            </h4>
            <span
              className={`pos-modifier-group__hint${required ? (done ? " is-done" : " is-required") : ""}`}
            >
              {modifierRuleLabel(group)}
            </span>
          </div>
          <div className="pos-modifier-chips">
            {group.options
              .filter((option) => option.is_active !== false || availability?.has(option.id))
              .map((option) => {
                const active = chosen.includes(option.id);
                const unavailable = optionUnavailableLabel(option, availability);
                const price = modifierOptionPrice(option, group);
                const count = counts[option.id] ?? 1;
                const portion =
                  isExtra && option.product_id
                    ? `${formatQty(option.stock_qty ?? 1, option.product_unit || "units")} ${option.product_name ?? "supply"} per extra`
                    : null;
                return (
                  <span key={option.id} className="pos-modifier-chip-wrap">
                    <button
                      type="button"
                      className={`pos-modifier-chip${active ? " is-selected" : ""}${unavailable ? " is-unavailable" : ""}`}
                      aria-pressed={active}
                      disabled={!active && (full || !!unavailable)}
                      onClick={() => toggle(index, option.id)}
                    >
                      <span className="pos-modifier-chip__check">
                        <i
                          className={
                            active
                              ? single
                                ? "fa-solid fa-circle-dot"
                                : "fa-solid fa-square-check"
                              : single
                                ? "fa-regular fa-circle"
                                : "fa-regular fa-square"
                          }
                          aria-hidden="true"
                        />
                      </span>
                      <span className="pos-modifier-chip__label">{option.name}</span>
                      <span className="pos-modifier-chip__price">
                        {unavailable ?? (price > 0 ? `+${formatMoney(price, currency)}` : "Free")}
                      </span>
                    </button>
                    {portion ? <small className="pos-modifier-chip__portion">{portion}</small> : null}
                    {active && countable(group, option) ? (
                      <span className="pos-modifier-stepper" role="group" aria-label={`How many ${option.name}`}>
                        <button
                          type="button"
                          aria-label={`One less ${option.name}`}
                          disabled={count <= 1}
                          onClick={() => setCount(option.id, count - 1)}
                        >
                          <i className="fa-solid fa-minus" aria-hidden="true" />
                        </button>
                        <strong>{count}×</strong>
                        <button
                          type="button"
                          aria-label={`One more ${option.name}`}
                          disabled={count >= MAX_COUNT}
                          onClick={() => setCount(option.id, count + 1)}
                        >
                          <i className="fa-solid fa-plus" aria-hidden="true" />
                        </button>
                      </span>
                    ) : null}
                  </span>
                );
              })}
          </div>
        </section>
      );
    });
  }

  return (
    <div
      className="pos-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pos-modifier-modal">
        <header className="pos-modifier-modal__header">
          <div className="pos-modifier-modal__title-row">
            <span className="pos-modifier-modal__badge">
              <i className="fa-solid fa-burger" aria-hidden="true" /> Meal
            </span>
            <button
              type="button"
              className="pos-modifier-modal__close-btn"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
          <h2 id={headingId} className="pos-modifier-modal__item-name">
            {lineName}
          </h2>
          <div className="pos-modifier-modal__base-tag">Base: {formatMoney(basePrice, currency)}</div>
        </header>

        <div className="pos-modifier-modal__body">
          {entries.some(({ group }) => !group.is_extra) ? (
            <section className="pos-modifier-category">
              <h3 className="pos-modifier-category__title">Modifiers</h3>
              {renderGroups(false)}
            </section>
          ) : null}
          {entries.some(({ group }) => group.is_extra) ? (
            <section className="pos-modifier-category">
              <h3 className="pos-modifier-category__title">Meal extras</h3>
              <p className="pos-modifier-category__hint">
                Each selected extra uses its configured supply portion.
              </p>
              {renderGroups(true)}
            </section>
          ) : null}
          {custom.length ? (
            <section className="pos-modifier-group">
              <div className="pos-modifier-group__header">
                <h3 className="pos-modifier-group__title">Previously added extras</h3>
                <span className="pos-modifier-group__hint">Not linked to stock</span>
              </div>
              {custom.map((mod, index) => (
                <div key={`${mod.name}-${index}`} className="pos-modifier-custom-chip">
                  <span>
                    <strong>+ {mod.name}</strong> ({mod.price > 0 ? formatMoney(mod.price, currency) : "Free"})
                  </span>
                  <button
                    type="button"
                    onClick={() => setCustom((prev) => prev.filter((_, i) => i !== index))}
                    className="pos-modifier-remove-btn"
                    aria-label={`Remove ${mod.name}`}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </section>
          ) : null}

          <section className="pos-modifier-group">
            <div className="pos-modifier-group__header">
              <h3 className="pos-modifier-group__title">Kitchen note</h3>
            </div>
            <textarea
              className="pos-modifier-textarea"
              placeholder="e.g. Serve hot, no onions"
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </section>
        </div>

        <footer className="pos-modifier-modal__footer">
          <div className="pos-modifier-summary">
            <span className="pos-modifier-summary__breakdown">
              {exhausted.length
                ? `No ${exhausted.map(entryName).join(", ")} available`
                : missing.length
                ? `Choose: ${missing.map(entryName).join(", ")}`
                : `Base ${formatMoney(basePrice, currency)}${
                    optionsTotal + customTotal > 0
                      ? ` + extras ${formatMoney(optionsTotal + customTotal, currency)}`
                      : ""
                  }`}
            </span>
            <span className="pos-modifier-summary__total">
              Each: <strong>{formatMoney(unitTotal, currency)}</strong>
            </span>
          </div>
          <div className="pos-modifier-actions">
            <button type="button" className="pos-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="pos-btn-primary pos-modifier-confirm-btn"
              disabled={missing.length > 0}
              onClick={confirm}
            >
              <i className="fa-solid fa-check" aria-hidden="true" /> Add to order · {formatMoney(unitTotal, currency)}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
