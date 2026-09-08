"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess, confirmAction } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  inventoryCoverUrl,
  inventoryProductName,
  inventoryRole,
  inventoryRoleLabel,
  isHotelMenuItem,
  updateInventoryActive,
} from "@/lib/trans-chap-product";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import type { InventoryItem, InventoryResponse, InventoryRole } from "@/lib/types";

type RoleFilter = "all" | InventoryRole;

const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "both", label: "Buy & sell" },
  { id: "for_sale", label: "Sell only" },
  { id: "raw_material", label: "Raw" },
];

function stockBadge(
  item: InventoryItem,
): { label: string; tone: "wait" | "fail" } | undefined {
  if (!item.is_active || isHotelMenuItem(item)) return undefined;
  if (item.stock_quantity != null && item.stock_quantity <= 0) {
    return { label: "Out", tone: "fail" };
  }
  if (item.is_low_stock) {
    return { label: "Low", tone: "wait" };
  }
  return undefined;
}

function stockQtyLabel(item: InventoryItem): string | undefined {
  if (isHotelMenuItem(item)) return undefined;
  if (item.stock_quantity == null) return "Qty —";
  return `Qty ${item.stock_quantity}`;
}

function roleTag(item: InventoryItem): string | undefined {
  if (isHotelMenuItem(item)) return "Hotel";
  const role = inventoryRole(item);
  if (role === "raw_material") return "Raw";
  if (role === "both") return "Buy & sell";
  return "Sell only";
}

export function TransChapStocksList() {
  const listId = useId();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [hotelOnly, setHotelOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setItems(data.data);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(extractErrorMessage(err, "Could not load stock."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (hotelOnly && !isHotelMenuItem(item)) return false;
      if (roleFilter !== "all" && inventoryRole(item) !== roleFilter) return false;
      if (!needle) return true;
      return inventoryProductName(item).toLowerCase().includes(needle);
    });
  }, [hotelOnly, items, query, roleFilter]);

  async function toggleActive(item: InventoryItem) {
    if (savingId || selecting) return;
    const next = !item.is_active;
    setSavingId(item.id);
    try {
      const updated = await updateInventoryActive(item.id, next);
      setItems((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row)),
      );
      await toastSuccess(next ? "Item enabled" : "Item disabled");
    } catch (err) {
      await showError(
        next ? "Could not enable item" : "Could not disable item",
        extractErrorMessage(err),
      );
    } finally {
      setSavingId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSelecting() {
    setOpenId(null);
    setSelecting(true);
    setSelectedIds(new Set());
  }

  function stopSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  function selectFiltered() {
    setSelectedIds(new Set(filtered.map((item) => item.id)));
  }

  async function disableSelected() {
    const targets = filtered.filter(
      (item) => selectedIds.has(item.id) && item.is_active,
    );
    if (!targets.length || bulkSaving) return;
    const ok = await confirmAction(
      `Disable ${targets.length} item${targets.length === 1 ? "" : "s"}?`,
      "They won’t show in New sale until you turn them back on.",
      "Disable",
    );
    if (!ok) return;
    setBulkSaving(true);
    try {
      const results = await Promise.allSettled(
        targets.map((item) => updateInventoryActive(item.id, false)),
      );
      const updated = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.length - updated.length;
      if (updated.length) {
        const byId = new Map(updated.map((item) => [item.id, item]));
        setItems((prev) => prev.map((row) => byId.get(row.id) ?? row));
      }
      if (failed) {
        await showError(
          "Could not disable all items",
          `${failed} item${failed === 1 ? "" : "s"} failed. Try again.`,
        );
        return;
      }
      await toastSuccess(
        targets.length === 1 ? "Item disabled" : `${targets.length} items disabled`,
      );
      stopSelecting();
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__filters">
        <div className="trans-chap-sales__search-row">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search stock…"
              aria-label="Search stock"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`trans-chap-sales__chip${hotelOnly ? " is-active" : ""}`}
            aria-pressed={hotelOnly}
            onClick={() => setHotelOnly((value) => !value)}
          >
            Hotel
          </button>
          {items.length ? (
            <button
              type="button"
              className={`trans-chap-sales__chip${selecting ? " is-active" : ""}`}
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : startSelecting())}
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : null}
        </div>
        <div className="trans-chap-sales__chips" role="group" aria-label="Stock type">
          {ROLE_FILTERS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`trans-chap-sales__chip${roleFilter === chip.id ? " is-active" : ""}`}
              aria-pressed={roleFilter === chip.id}
              onClick={() => setRoleFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="trans-chap-sales__list">
        {loading ? (
          <TransChapListSkeleton />
        ) : error && items.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : items.length === 0 ? (
          <TransChapStatus
            actionHref="/trans-chap/purchases/new"
            actionLabel="Record a purchase"
          >
            No stock yet. Add products when you buy them.
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {hotelOnly
              ? "No hotel menu items match this search."
              : roleFilter !== "all"
                ? `No ${inventoryRoleLabel(roleFilter).toLowerCase()} items match this search.`
                : "No products match this search."}
          </p>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
          {filtered.map((item) => {
            const name = inventoryProductName(item);
            const hotel = isHotelMenuItem(item);
            const picked = selectedIds.has(item.id);
            const open = !selecting && openId === item.id;
            const panelId = `${listId}-${item.id}`;
            const price =
              item.selling_price != null ? formatKsh(item.selling_price) : "—";
            return (
              <MotionItem key={item.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="stock"
                title={name}
                imageUrl={inventoryCoverUrl(item)}
                tag={roleTag(item)}
                qty={stockQtyLabel(item)}
                price={price}
                badge={stockBadge(item)}
                inactive={!item.is_active}
                picking={selecting}
                picked={picked}
                onToggle={() =>
                  selecting
                    ? toggleSelected(item.id)
                    : setOpenId(open ? null : item.id)
                }
                headAction={
                  selecting ? (
                    <button
                      type="button"
                      role="checkbox"
                      className={`trans-chap-panel__check${picked ? " is-on" : ""}`}
                      aria-checked={picked}
                      aria-label={`${picked ? "Unselect" : "Select"} ${name}`}
                      onClick={() => toggleSelected(item.id)}
                    >
                      {picked ? <i className="fa-solid fa-check" aria-hidden /> : null}
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      className={`theme-switch trans-chap-panel__switch${item.is_active ? " is-on" : ""}`}
                      aria-checked={item.is_active}
                      aria-label={item.is_active ? `Disable ${name}` : `Enable ${name}`}
                      disabled={savingId === item.id}
                      onClick={() => void toggleActive(item)}
                    >
                      <span className="theme-switch__thumb" aria-hidden />
                    </button>
                  )
                }
                action={
                  <>
                    <Link
                      href={`/trans-chap/stocks/edit?id=${encodeURIComponent(item.id)}`}
                      className="trans-chap-panel__link"
                    >
                      {hotel || item.selling_price != null ? "Edit" : "Set sell price"}
                    </Link>
                    {hotel ? null : (
                      <Link
                        href="/trans-chap/purchases/new"
                        className="trans-chap-panel__link"
                      >
                        Buy more
                      </Link>
                    )}
                  </>
                }
              >
                <dl className="trans-chap-panel__facts">
                  {hotel ? null : (
                    <div>
                      <dt>On hand</dt>
                      <dd>
                        {item.stock_quantity == null ? "Not tracked" : item.stock_quantity}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Type</dt>
                    <dd>{hotel ? "Hotel menu" : inventoryRoleLabel(inventoryRole(item))}</dd>
                  </div>
                  <div>
                    <dt>Selling price</dt>
                    <dd>{price}</dd>
                  </div>
                  {hotel ? null : (
                    <div>
                      <dt>Buying price</dt>
                      <dd>
                        {item.buying_price != null
                          ? formatKsh(item.buying_price)
                          : "—"}
                      </dd>
                    </div>
                  )}
                </dl>
              </TransChapPanel>
              </MotionItem>
            );
          })}
          </MotionList>
        )}
      </div>
      {selecting ? (
        <div className="trans-chap-bulk-bar">
          <p className="trans-chap-bulk-bar__count">
            {selectedIds.size
              ? `${selectedIds.size} selected`
              : "Tap items to select"}
          </p>
          <button type="button" disabled={bulkSaving || !filtered.length} onClick={selectFiltered}>
            All
          </button>
          <button
            type="button"
            className="trans-chap-bulk-bar__disable"
            disabled={
              bulkSaving ||
              !filtered.some((item) => selectedIds.has(item.id) && item.is_active)
            }
            onClick={() => void disableSelected()}
          >
            {bulkSaving ? "Disabling…" : "Disable"}
          </button>
        </div>
      ) : (
      <TransChapFab
        label="Add stock"
        options={[
          { href: "/trans-chap/purchases/new", label: "Scan buy", icon: "fa-barcode" },
          { href: "/trans-chap/purchases/new?mode=select", label: "Select buy", icon: "fa-list" },
          {
            href: "/trans-chap/purchases/unavailable",
            label: "Buy new item",
            icon: "fa-cart-plus",
          },
          { href: "/trans-chap/stocks/menu", label: "Hotel menu", icon: "fa-utensils" },
        ]}
      />
      )}
    </div>
  );
}
