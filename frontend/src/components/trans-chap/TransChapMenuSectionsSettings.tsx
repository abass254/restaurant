"use client";

import { useEffect, useState } from "react";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import {
  DEFAULT_MENU_SECTIONS,
  fetchMenuSections,
  saveMenuSections,
} from "@/lib/trans-chap-product";

type Draft = { key: string; id?: string; label: string };

let draftSeq = 0;
function toDrafts(sections: { id: string; label: string }[]): Draft[] {
  return sections.map((s) => ({ key: `s${draftSeq++}`, id: s.id, label: s.label }));
}

export function TransChapMenuSectionsSettings() {
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(DEFAULT_MENU_SECTIONS));
  const [newLabel, setNewLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMenuSections()
      .then((sections) => {
        if (alive) setDrafts(toDrafts(sections));
      })
      .catch((err) => {
        if (alive) void showError("Could not load menu sections", extractErrorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function rename(key: string, label: string) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, label } : d)));
  }

  function move(index: number, delta: -1 | 1) {
    setDrafts((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function remove(key: string) {
    setDrafts((prev) => (prev.length > 1 ? prev.filter((d) => d.key !== key) : prev));
  }

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    if (drafts.some((d) => d.label.trim().toLowerCase() === label.toLowerCase())) {
      void showError("Already added", `"${label}" is already a section.`);
      return;
    }
    setDrafts((prev) => [...prev, { key: `s${draftSeq++}`, label }]);
    setNewLabel("");
  }

  async function save() {
    if (saving) return;
    const sections = drafts
      .map((d) => ({ id: d.id, label: d.label.trim() }))
      .filter((d) => d.label);
    if (!sections.length) {
      await showError("Add a section", "Your menu needs at least one section.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveMenuSections(sections);
      setDrafts(toDrafts(saved));
      await toastSuccess("Menu sections saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving;

  return (
    <section className="ios-settings__group" aria-label="Menu sections">
      <div className="ios-settings__card">
        {drafts.map((draft, index) => (
          <div key={draft.key} className="ios-settings__row ios-settings__row--static tc-sections__row">
            <input
              type="text"
              className="tc-sections__input"
              value={draft.label}
              maxLength={40}
              disabled={disabled}
              aria-label={`Section ${index + 1} name`}
              onChange={(e) => rename(draft.key, e.target.value)}
            />
            <span className="tc-sections__actions">
              <button
                type="button"
                aria-label={`Move ${draft.label} up`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <i className="fa-solid fa-arrow-up" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Move ${draft.label} down`}
                disabled={disabled || index === drafts.length - 1}
                onClick={() => move(index, 1)}
              >
                <i className="fa-solid fa-arrow-down" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Remove ${draft.label}`}
                disabled={disabled || drafts.length === 1}
                onClick={() => remove(draft.key)}
              >
                <i className="fa-solid fa-trash" aria-hidden />
              </button>
            </span>
          </div>
        ))}
        <form
          className="ios-settings__row ios-settings__row--static tc-sections__row"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            className="tc-sections__input"
            placeholder="New section, e.g. Breakfast"
            value={newLabel}
            maxLength={40}
            disabled={disabled}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <span className="tc-sections__actions">
            <button type="submit" disabled={disabled || !newLabel.trim()} aria-label="Add section">
              <i className="fa-solid fa-plus" aria-hidden />
            </button>
          </span>
        </form>
      </div>
      <button
        type="button"
        className="auth-split__submit tc-sections__save"
        disabled={disabled}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save sections"}
      </button>
      <p className="ios-settings__footer">
        Dishes are grouped under these sections on your menu, in this order. Dishes in a removed
        section move to the first one.
      </p>
    </section>
  );
}
