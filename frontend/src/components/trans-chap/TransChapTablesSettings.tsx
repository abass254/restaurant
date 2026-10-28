"use client";

import { useEffect, useState } from "react";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import {
  DEFAULT_RESTAURANT_TABLES,
  fetchRestaurantTables,
  saveRestaurantTables,
} from "@/lib/trans-chap-product";
import type { RestaurantTableDef } from "@/lib/types";

type Draft = { key: string; id?: string; label: string };

let draftSeq = 0;
function toDrafts(tables: RestaurantTableDef[]): Draft[] {
  return tables.map((t) => ({ key: `tbl_${draftSeq++}`, id: t.id, label: t.label }));
}

export function TransChapTablesSettings() {
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(DEFAULT_RESTAURANT_TABLES));
  const [newLabel, setNewLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchRestaurantTables()
      .then((tables) => {
        if (alive) setDrafts(toDrafts(tables));
      })
      .catch((err) => {
        if (alive) void showError("Could not load tables", extractErrorMessage(err));
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

  function add(labelToAdd?: string) {
    const raw = (labelToAdd ?? newLabel).trim();
    if (!raw) return;
    if (drafts.some((d) => d.label.trim().toLowerCase() === raw.toLowerCase())) {
      void showError("Already added", `"${raw}" is already in your tables list.`);
      return;
    }
    setDrafts((prev) => [...prev, { key: `tbl_${draftSeq++}`, label: raw }]);
    if (!labelToAdd) {
      setNewLabel("");
    }
  }

  async function resetToDefaults() {
    const confirmed = await confirmAction(
      "Reset tables to default?",
      "This will replace your current list with standard Table 1 through Table 6 and Takeaway.",
      "Reset",
    );
    if (!confirmed) return;
    setDrafts(toDrafts(DEFAULT_RESTAURANT_TABLES));
  }

  async function save() {
    if (saving) return;
    const tables = drafts
      .map((d) => ({ id: d.id, label: d.label.trim() }))
      .filter((d) => d.label);
    if (!tables.length) {
      await showError("Add a table", "Your restaurant needs at least one table or seating option.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRestaurantTables(tables);
      setDrafts(toDrafts(saved));
      await toastSuccess("Tables saved");
    } catch (err) {
      await showError("Could not save tables", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving;

  // Suggested next table name based on highest existing number
  const nextTableNumber = (() => {
    let max = 0;
    for (const d of drafts) {
      const match = d.label.match(/Table\s+(\d+)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }
    return max > 0 ? `Table ${max + 1}` : "Table 1";
  })();

  return (
    <section className="ios-settings__group" aria-label="Restaurant tables">
      <div className="ios-settings__card">
        {drafts.map((draft, index) => (
          <div key={draft.key} className="ios-settings__row ios-settings__row--static tc-sections__row">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: 6,
                background: "var(--app-surface-2, rgba(0,0,0,0.05))",
                color: "var(--app-text-muted)",
                fontSize: "0.75rem",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>
            <input
              type="text"
              className="tc-sections__input"
              value={draft.label}
              maxLength={40}
              disabled={disabled}
              aria-label={`Table ${index + 1} name`}
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
            placeholder="New table, e.g. Table 7 or VIP 1"
            value={newLabel}
            maxLength={40}
            disabled={disabled}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <span className="tc-sections__actions">
            <button type="submit" disabled={disabled || !newLabel.trim()} aria-label="Add table">
              <i className="fa-solid fa-plus" aria-hidden />
            </button>
          </span>
        </form>
      </div>

      <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--app-text-muted)", marginRight: "0.25rem" }}>
          Quick add:
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => add(nextTableNumber)}
          style={{
            padding: "0.25rem 0.65rem",
            fontSize: "0.8rem",
            borderRadius: 8,
            border: "1px solid var(--app-border, rgba(0,0,0,0.1))",
            background: "var(--app-surface, #ffffff)",
            color: "var(--app-primary, #2563eb)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          + {nextTableNumber}
        </button>
        {["VIP 1", "Terrace 1", "Balcony 1", "Bar Counter"].map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={disabled}
            onClick={() => add(preset)}
            style={{
              padding: "0.25rem 0.65rem",
              fontSize: "0.8rem",
              borderRadius: 8,
              border: "1px solid var(--app-border, rgba(0,0,0,0.1))",
              background: "var(--app-surface, #ffffff)",
              color: "var(--app-text, #111827)",
              cursor: "pointer",
            }}
          >
            + {preset}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem" }}>
        <button
          type="button"
          className="auth-split__submit tc-sections__save"
          style={{ flex: 1, marginTop: 0 }}
          disabled={disabled}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save tables"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void resetToDefaults()}
          style={{
            padding: "0 1rem",
            fontSize: "0.88rem",
            borderRadius: 14,
            border: "1px solid var(--app-border, rgba(0,0,0,0.1))",
            background: "transparent",
            color: "var(--app-text-muted)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Reset to standard
        </button>
      </div>

      <p className="ios-settings__footer">
        These tables appear as quick selection buttons on your POS checkout screen and print on dining
        slips and kitchen orders.
      </p>
    </section>
  );
}
