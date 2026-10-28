"use client";

import { FormEvent, useState } from "react";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { deleteModifierGroup, modifierOptionInput, saveModifierGroup } from "@/lib/trans-chap-product";
import type { ModifierGroup, ModifierOption } from "@/lib/types";

/** Name of one extra; its price is set on the meal in Menu and its supply recipe via Set recipe. */
export function RestaurantKitchenExtraForm({
  group,
  option,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** The extra's group when editing; extras created here have one option each. */
  group: ModifierGroup | null;
  option: ModifierOption | null;
  onClose: () => void;
  onSaved: (group: ModifierGroup) => void;
  onDeleted: (group: ModifierGroup | null, groupId: string) => void;
}) {
  const [name, setName] = useState(option?.name ?? "");
  const [saving, setSaving] = useState(false);
  const canSave = !saving && !!name.trim();

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const trimmed = name.trim();
      const edited = option
        ? { ...modifierOptionInput(option), name: trimmed }
        : { name: trimmed, price_delta: 0, is_default: false, product_id: null };
      const single = !group || group.options.length <= 1;
      const saved = await saveModifierGroup(group?.id ?? null, {
        name: single ? trimmed : group.name,
        min_select: group?.min_select ?? 0,
        max_select: group?.max_select ?? 1,
        is_extra: true,
        included: false,
        options: group
          ? group.options.map((item) => (item.id === option?.id ? edited : modifierOptionInput(item)))
          : [edited],
      });
      onSaved(saved);
      await toastSuccess(option ? `"${trimmed}" updated` : `"${trimmed}" added`);
    } catch (err) {
      await showError("Could not save extra", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!group || !option || saving) return;
    const ok = await confirmAction(
      `Delete "${option.name}"?`,
      "Customers will no longer be able to add it to a meal.",
      "Delete",
    );
    if (!ok) return;
    setSaving(true);
    try {
      if (group.options.length <= 1) {
        await deleteModifierGroup(group.id);
        onDeleted(null, group.id);
      } else {
        const saved = await saveModifierGroup(group.id, {
          name: group.name,
          min_select: Math.min(group.min_select ?? 0, group.options.length - 1),
          max_select: group.max_select ?? 1,
          is_extra: true,
          included: false,
          options: group.options.filter((item) => item.id !== option.id).map(modifierOptionInput),
        });
        onDeleted(saved, group.id);
      }
      await toastSuccess(`"${option.name}" deleted`);
    } catch (err) {
      await showError("Could not delete extra", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-menu-modal-backdrop" onClick={() => !saving && onClose()} role="presentation">
      <div
        className="pos-menu-modal tc-extra-form"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kitchen-extra-form-title"
      >
        <div className="pos-menu-modal__drag-handle" />
        <header className="pos-menu-modal__header">
          <div className="pos-menu-modal__title-row">
            <h2 id="kitchen-extra-form-title" className="pos-menu-modal__title">
              {option ? "Edit extra" : "New extra"}
            </h2>
            <button
              type="button"
              className="pos-menu-modal__close-btn"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>
        <form onSubmit={(event) => void handleSave(event)} className="pos-menu-modal__body">
          <div className="pos-menu-modal__field">
            <label htmlFor="kitchen-extra-name">Extra name</label>
            <input
              id="kitchen-extra-name"
              type="text"
              autoComplete="off"
              autoFocus
              maxLength={120}
              placeholder="e.g. Extra chicken"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="pos-menu-modal__text-input"
            />
            <small className="tc-extra-form__hint">
              After saving, use Set recipe to choose the meal and the supply portion. Set its price on the meal in Menu.
            </small>
          </div>
          <footer className="pos-menu-modal__footer tc-menu__footer">
            {option ? (
              <button type="button" className="tc-menu__remove" disabled={saving} onClick={() => void handleDelete()}>
                Delete
              </button>
            ) : null}
            <button type="submit" disabled={!canSave} className="pos-menu-modal__submit-btn">
              {saving ? "Saving…" : option ? "Save extra" : "Add extra"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
