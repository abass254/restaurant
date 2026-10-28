"use client";

import { useEffect, useState } from "react";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import {
  DEFAULT_RESTAURANT_STATIONS,
  fetchRestaurantStations,
  saveRestaurantStations,
} from "@/lib/trans-chap-product";
import type { RestaurantStationDef } from "@/lib/types";

type Draft = { key: string; id?: string; label: string };

let draftSeq = 0;
function toDrafts(stations: RestaurantStationDef[]): Draft[] {
  return stations.map((s) => ({ key: `stn_${draftSeq++}`, id: s.id, label: s.label }));
}

function isKitchenStation(draft: Draft): boolean {
  return (
    draft.id === "kitchen" ||
    draft.label.trim().toLowerCase() === "kitchen" ||
    draft.label.trim().toLowerCase().includes("kitchen")
  );
}

export function TransChapStationsSettings() {
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(DEFAULT_RESTAURANT_STATIONS));
  const [newLabel, setNewLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchRestaurantStations()
      .then((stations) => {
        if (alive) setDrafts(toDrafts(stations));
      })
      .catch((err) => {
        if (alive) void showError("Could not load stations", extractErrorMessage(err));
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
    const item = drafts.find((d) => d.key === key);
    if (!item) return;
    const isKitchen = isKitchenStation(item);
    const otherKitchenCount = drafts.filter((d) => d.key !== key && isKitchenStation(d)).length;
    if (isKitchen && otherKitchenCount === 0) {
      void showError("Kitchen required", "Kitchen must be one of the stations for food preparation.");
      return;
    }
    setDrafts((prev) => (prev.length > 1 ? prev.filter((d) => d.key !== key) : prev));
  }

  function add(labelToAdd?: string) {
    const raw = (labelToAdd ?? newLabel).trim();
    if (!raw) return;
    if (drafts.some((d) => d.label.trim().toLowerCase() === raw.toLowerCase())) {
      void showError("Already added", `"${raw}" is already defined as a station.`);
      return;
    }
    setDrafts((prev) => [...prev, { key: `stn_${draftSeq++}`, label: raw }]);
    if (!labelToAdd) {
      setNewLabel("");
    }
  }

  async function resetToDefaults() {
    const confirmed = await confirmAction(
      "Reset stations to default?",
      "This will reset your stations to Kitchen, Bar, and Grill.",
      "Reset",
    );
    if (!confirmed) return;
    setDrafts(toDrafts(DEFAULT_RESTAURANT_STATIONS));
  }

  async function save() {
    if (saving) return;
    const stations = drafts
      .map((d) => ({ id: d.id, label: d.label.trim() }))
      .filter((d) => d.label);
    if (!stations.length) {
      await showError("Add a station", "Your restaurant needs at least one station.");
      return;
    }
    const hasKitchen = stations.some(
      (s) => s.id === "kitchen" || s.label.toLowerCase().includes("kitchen"),
    );
    if (!hasKitchen) {
      await showError("Kitchen required", "Kitchen must be one of the stations.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRestaurantStations(stations);
      setDrafts(toDrafts(saved));
      await toastSuccess("Stations saved");
    } catch (err) {
      await showError("Could not save stations", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving;

  return (
    <section className="ios-settings__group" aria-label="Restaurant stations">
      <div className="ios-settings__card">
        {drafts.map((draft, index) => {
          const isKitchen = isKitchenStation(draft);
          return (
            <div key={draft.key} className="ios-settings__row ios-settings__row--static tc-sections__row">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: isKitchen
                    ? "color-mix(in srgb, var(--app-primary, #2563eb) 12%, transparent)"
                    : "var(--app-surface-2, rgba(0,0,0,0.05))",
                  color: isKitchen ? "var(--app-primary, #2563eb)" : "var(--app-text-muted)",
                  flexShrink: 0,
                }}
              >
                <i
                  className={isKitchen ? "fa-solid fa-kitchen-set" : "fa-solid fa-fire-burner"}
                  aria-hidden
                  style={{ fontSize: "0.95rem" }}
                />
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="text"
                  className="tc-sections__input"
                  value={draft.label}
                  maxLength={40}
                  disabled={disabled}
                  aria-label={`Station ${index + 1} name`}
                  onChange={(e) => rename(draft.key, e.target.value)}
                />
                {isKitchen ? (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "0.15rem 0.45rem",
                      borderRadius: 6,
                      background: "color-mix(in srgb, var(--app-primary, #2563eb) 12%, transparent)",
                      color: "var(--app-primary, #2563eb)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Core Kitchen
                  </span>
                ) : null}
              </div>
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
                  disabled={disabled || (isKitchen && drafts.filter(isKitchenStation).length <= 1)}
                  onClick={() => remove(draft.key)}
                >
                  <i className="fa-solid fa-trash" aria-hidden />
                </button>
              </span>
            </div>
          );
        })}
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
            placeholder="New station, e.g. Bar, Grill, or Bakery"
            value={newLabel}
            maxLength={40}
            disabled={disabled}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <span className="tc-sections__actions">
            <button type="submit" disabled={disabled || !newLabel.trim()} aria-label="Add station">
              <i className="fa-solid fa-plus" aria-hidden />
            </button>
          </span>
        </form>
      </div>

      <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--app-text-muted)", marginRight: "0.25rem" }}>
          Common stations:
        </span>
        {["Bar", "Grill", "Pastry & Bakery", "Coffee Bar", "Cold Prep", "Pizza Station"].map((preset) => {
          const already = drafts.some((d) => d.label.trim().toLowerCase() === preset.toLowerCase());
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled || already}
              onClick={() => add(preset)}
              style={{
                padding: "0.25rem 0.65rem",
                fontSize: "0.8rem",
                borderRadius: 8,
                border: "1px solid var(--app-border, rgba(0,0,0,0.1))",
                background: "var(--app-surface, #ffffff)",
                color: already ? "var(--app-text-muted)" : "var(--app-text, #111827)",
                cursor: already ? "default" : "pointer",
                opacity: already ? 0.6 : 1,
              }}
            >
              + {preset}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem" }}>
        <button
          type="button"
          className="auth-split__submit tc-sections__save"
          style={{ flex: 1, marginTop: 0 }}
          disabled={disabled}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save stations"}
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
        Define preparation stations across your venue. Kitchen is always configured as the primary
        station for cooking meals and recipe ingredient preparation.
      </p>
    </section>
  );
}
