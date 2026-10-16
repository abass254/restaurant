"use client";

import { useEffect, useState } from "react";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { formatQty } from "@/lib/restaurant-supplies";
import {
  fetchModifierGroups,
  fetchOptionAvailability,
  isOptionAvailable,
  mealBlockedBy,
  modifierRuleLabel,
  setModifierOptionActive,
  type OptionAvailabilityMap,
} from "@/lib/trans-chap-product";
import type { InventoryItem, ModifierGroup, ModifierOption } from "@/lib/types";

const REFRESH_MS = 60_000;

/** Kitchen view of every modifier option: stock left, and a Sold out switch for the day. */
export function RestaurantKitchenModifiers({ dishes }: { dishes: InventoryItem[] }) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [availability, setAvailability] = useState<OptionAvailabilityMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([fetchModifierGroups(), fetchOptionAvailability()])
        .then(([nextGroups, nextAvailability]) => {
          if (!alive) return;
          setGroups(nextGroups);
          setAvailability(nextAvailability);
        })
        .catch(() => {
          /* keep the last good view */
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

  async function toggle(option: ModifierOption) {
    const row = availability?.get(option.id);
    const nextActive = !(row ? row.is_active : option.is_active !== false);
    setTogglingId(option.id);
    const patch = (isActive: boolean) =>
      setAvailability((prev) => {
        const next = new Map(prev ?? []);
        const current = next.get(option.id);
        if (current) {
          const reason = !isActive ? "sold_out" : current.reason === "sold_out" ? null : current.reason;
          next.set(option.id, { ...current, is_active: isActive, reason, available: reason == null });
        }
        return next;
      });
    patch(nextActive);
    try {
      await setModifierOptionActive(option.id, nextActive);
      await toastSuccess(`"${option.name}" is now ${nextActive ? "available" : "sold out"}`);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      patch(!nextActive);
      await showError("Could not update option", extractErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  const used = groups.filter((group) => (group.item_count ?? 0) > 0 && group.options.length > 0);
  const blocked = dishes
    .filter((dish) => dish.is_active)
    .map((dish) => ({ dish, group: mealBlockedBy(dish, availability) }))
    .filter((row): row is { dish: InventoryItem; group: ModifierGroup } => !!row.group);

  if (loading) return <p className="rs-empty">Loading modifiers…</p>;
  if (used.length === 0) return null;

  return (
    <>
      <div className="tc-kitchen-section__head">
        <div>
          <h3 className="tc-kitchen-section__title">
            <i className="fa-solid fa-list-check" aria-hidden />
            <span>Modifier options</span>
          </h3>
          <p className="tc-kitchen-section__subtitle">
            Mark choices like Ugali or Fanta sold out. Options also show out of stock when their supply runs low.
          </p>
        </div>
      </div>

      {blocked.length ? (
        <div className="tc-kitchen-modifiers__warn" role="status">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden />
          <span>
            Can&apos;t be sold right now:{" "}
            {blocked.map(({ dish, group }) => `${dish.product?.name ?? "Meal"} (no ${group.name})`).join(", ")}
          </span>
        </div>
      ) : null}

      <div className="tc-kitchen-modifiers">
        {used.map((group) => (
          <div key={group.id} className="rs-card tc-kitchen-modifiers__group">
            <p className="tc-kitchen-modifiers__group-head">
              <strong>{group.name}</strong>
              <span>{modifierRuleLabel(group)}</span>
            </p>
            <ul>
              {group.options.map((option) => {
                const row = availability?.get(option.id);
                const active = row ? row.is_active : option.is_active !== false;
                const available = isOptionAvailable(option, availability);
                const status = available ? "Available" : row?.reason === "out_of_stock" ? "Out of stock" : "Sold out";
                const stock =
                  row?.on_hand != null
                    ? `${formatQty(row.on_hand, row.unit)} in ${row.location === "kitchen" ? "kitchen" : "store"}`
                    : null;
                return (
                  <li key={option.id} className={available ? undefined : "is-off"}>
                    <div className="tc-kitchen-modifiers__name">
                      <span>{option.name}</span>
                      {stock || row?.reason === "out_of_stock" ? (
                        <small>
                          {stock}
                          {row?.reason === "out_of_stock" && active ? " · issue more from Inventory" : ""}
                        </small>
                      ) : null}
                    </div>
                    <span
                      className={`rs-badge ${available ? "rs-badge--ok" : "rs-badge--warn"} tc-kitchen-modifiers__pill`}
                    >
                      {status}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      className={`theme-switch ${active ? "is-on" : ""}`}
                      aria-checked={active}
                      aria-label={active ? `Mark ${option.name} sold out` : `Mark ${option.name} available`}
                      disabled={togglingId === option.id}
                      onClick={() => void toggle(option)}
                    >
                      <span className="theme-switch__thumb" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
