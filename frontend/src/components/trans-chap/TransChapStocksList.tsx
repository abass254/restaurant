"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { confirmAction, showError, showInternalError, toastSuccess, internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  inventoryCoverUrl,
  inventoryProductName,
  inventoryRole,
  inventoryRoleLabel,
  isHotelMenuItem,
  updateInventoryActive,
  updateInventoryItem,
} from "@/lib/trans-chap-product";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { useAuthUser } from "@/components/app/AuthProvider";
import { isShopOwner } from "@/lib/merchant-permissions";
import type { InventoryItem, InventoryResponse, InventoryRole } from "@/lib/types";

type RoleFilter = "all" | InventoryRole;
type StocksView = "grid" | "list";

const STOCKS_VIEW_KEY = "trans-chap-stocks-view";

const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "both", label: "Buy & sell" },
  { id: "for_sale", label: "Sell only" },
  { id: "raw_material", label: "Raw" },
];

function readStocksView(): StocksView {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(STOCKS_VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function stockBadge(
  item: InventoryItem,
): { label: string; tone: "wait" | "fail" } | undefined {
  if (!item.is_active || isHotelMenuItem(item)) return undefined;
  if (isOutOfStock(item)) {
    return { label: "Out", tone: "fail" };
  }
  if (item.is_low_stock) {
    return { label: "Low", tone: "wait" };
  }
  return undefined;
}

function isOutOfStock(item: InventoryItem): boolean {
  if (isHotelMenuItem(item)) return false;
  return item.stock_quantity != null && item.stock_quantity <= 0;
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
  const user = useAuthUser();
  const canEditQty = isShopOwner(user);
  const buyHref = canEditQty
    ? "/trans-chap/purchases/new"
    : "/trans-chap/purchases/unavailable";
  const listId = useId();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [hotelOnly, setHotelOnly] = useState(false);
  const [outOnly, setOutOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [view, setView] = useState<StocksView>("grid");
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [qtySavingId, setQtySavingId] = useState<string | null>(null);

  useEffect(() => {
    setView(readStocksView());
  }, []);

  function setStocksView(next: StocksView) {
    setView(next);
    try {
      window.localStorage.setItem(STOCKS_VIEW_KEY, next);
    } catch {
      /* ignore quota / private mode */
    }
  }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(
        `${apiRoutes.inventory}?active=true`,
      );
      setItems(data.data);
      setError(null);
    } catch {
      setItems([]);
      setError(internalErrorMessage());
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
      if (!item.is_active) return false;
      if (hotelOnly && !isHotelMenuItem(item)) return false;
      if (outOnly && !isOutOfStock(item)) return false;
      if (roleFilter !== "all" && inventoryRole(item) !== roleFilter) return false;
      if (!needle) return true;
      const name = inventoryProductName(item).toLowerCase();
      const sku = (item.product?.sku || item.product?.product_code || "").toLowerCase();
      const location = (item.location || "").toLowerCase();
      const supplier = (item.supplier || "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        location.includes(needle) ||
        supplier.includes(needle)
      );
    });
  }, [hotelOnly, items, outOnly, query, roleFilter]);

  const outOfStockFiltered = useMemo(
    () => filtered.filter(isOutOfStock),
    [filtered],
  );

  async function toggleActive(item: InventoryItem) {
    if (savingId || selecting) return;
    const next = !item.is_active;
    setSavingId(item.id);
    try {
      const updated = await updateInventoryActive(item.id, next);
      setItems((prev) =>
        next
          ? prev.map((row) => (row.id === updated.id ? updated : row))
          : prev.filter((row) => row.id !== updated.id),
      );
      if (openId === item.id) setOpenId(null);
      await toastSuccess(next ? "Item enabled" : "Item disabled");
    } catch {
      await showInternalError();
    } finally {
      setSavingId(null);
    }
  }

  function qtyDraftValue(item: InventoryItem): string {
    if (Object.prototype.hasOwnProperty.call(qtyDrafts, item.id)) {
      return qtyDrafts[item.id] ?? "";
    }
    return item.stock_quantity == null ? "" : String(item.stock_quantity);
  }

  async function saveQty(item: InventoryItem) {
    if (!canEditQty || isHotelMenuItem(item) || qtySavingId === item.id || selecting) return;
    const raw = qtyDraftValue(item).trim();
    if (raw === "") {
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      await showError("Invalid quantity", "Enter a whole number 0 or higher.");
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    if (item.stock_quantity === parsed) {
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    setQtySavingId(item.id);
    try {
      const updated = await updateInventoryItem(item.id, { stock_quantity: parsed });
      setItems((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row)),
      );
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await toastSuccess("Quantity updated");
    } catch {
      await showInternalError();
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setQtySavingId(null);
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

  function selectOutOfStock() {
    setSelectedIds(new Set(outOfStockFiltered.map((item) => item.id)));
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
        const disabledIds = new Set(updated.map((item) => item.id));
        setItems((prev) => prev.filter((row) => !disabledIds.has(row.id)));
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
    <div className={`trans-chap-sales${view === "list" ? " trans-chap-sales--list" : ""}`}>
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
          <div className="trans-chap-sales__view" role="group" aria-label="Stock layout">
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${view === "grid" ? " is-on" : ""}`}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setStocksView("grid")}
            >
              <i className="fa-solid fa-table-cells" aria-hidden />
            </button>
            <button
              type="button"
              className={`trans-chap-sales__filter-btn${view === "list" ? " is-on" : ""}`}
              aria-pressed={view === "list"}
              aria-label="List view"
              title="List view"
              onClick={() => setStocksView("list")}
            >
              <i className="fa-solid fa-list" aria-hidden />
            </button>
          </div>
          <button
            type="button"
            className={`trans-chap-sales__chip${hotelOnly ? " is-active" : ""}`}
            aria-pressed={hotelOnly}
            onClick={() => setHotelOnly((value) => !value)}
          >
            Hotel
          </button>
          <button
            type="button"
            className={`trans-chap-sales__chip${outOnly ? " is-active" : ""}`}
            aria-pressed={outOnly}
            onClick={() => setOutOnly((value) => !value)}
          >
            Out of stock
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
            actionHref={buyHref}
            actionLabel="Record a purchase"
          >
            No stock yet. Add products when you buy them.
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {outOnly
              ? "No out-of-stock products match this search."
              : hotelOnly
                ? "No hotel menu items match this search."
                : roleFilter !== "all"
                  ? `No ${inventoryRoleLabel(roleFilter).toLowerCase()} items match this search.`
                  : "No products match this search."}
          </p>
        ) : view === "list" ? (
          <div className="trans-chap-stock-table-wrap">
            <table className="trans-chap-stock-table">
              <thead>
                <tr>
                  {selecting ? <th className="trans-chap-stock-table__check" scope="col"> </th> : null}
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Type</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Buy</th>
                  <th scope="col">Sell</th>
                  <th scope="col">Margin</th>
                  <th scope="col">Location</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Status</th>
                  <th scope="col">Active</th>
                  <th className="trans-chap-stock-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const name = inventoryProductName(item);
                  const hotel = isHotelMenuItem(item);
                  const picked = selectedIds.has(item.id);
                  const badge = stockBadge(item);
                  const sell =
                    item.selling_price != null ? formatKsh(item.selling_price) : "—";
                  const buy =
                    hotel
                      ? "—"
                      : item.buying_price != null
                        ? formatKsh(item.buying_price)
                        : "—";
                  const margin =
                    hotel
                      ? "—"
                      : item.margin != null
                        ? formatKsh(item.margin)
                        : item.buying_price != null && item.selling_price != null
                          ? formatKsh(item.selling_price - item.buying_price)
                          : "—";
                  const sku =
                    item.product?.sku?.trim() ||
                    item.product?.product_code?.trim() ||
                    "—";
                  const unit = item.product?.unit?.trim() || "—";
                  const location = item.location?.trim() || "—";
                  const supplier = item.supplier?.trim() || "—";
                  return (
                    <tr
                      key={item.id}
                      className={`${!item.is_active ? "is-inactive" : ""}${picked ? " is-picked" : ""}`}
                    >
                      {selecting ? (
                        <td className="trans-chap-stock-table__check">
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
                        </td>
                      ) : null}
                      <td className="trans-chap-stock-table__product">
                        <div className="trans-chap-stock-table__product-inner">
                          <TransChapProductThumb
                            src={inventoryCoverUrl(item)}
                            name={name}
                            size="sm"
                          />
                          <span>{name}</span>
                        </div>
                      </td>
                      <td className="trans-chap-stock-table__mono">{sku}</td>
                      <td>{hotel ? "Hotel menu" : inventoryRoleLabel(inventoryRole(item))}</td>
                      <td>{unit}</td>
                      <td className="trans-chap-stock-table__qty">
                        {hotel ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : canEditQty ? (
                          <label className="trans-chap-panel__qty-edit">
                            <span className="sr-only">Qty</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              value={qtyDraftValue(item)}
                              disabled={qtySavingId === item.id}
                              aria-label={`Quantity for ${name}`}
                              onChange={(event) => {
                                const value = event.target.value;
                                setQtyDrafts((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              onBlur={() => void saveQty(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                  setQtyDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          </label>
                        ) : (
                          <span className="trans-chap-stock-table__mono">
                            {item.stock_quantity == null ? "—" : item.stock_quantity}
                          </span>
                        )}
                      </td>
                      <td>{buy}</td>
                      <td>{sell}</td>
                      <td>{margin}</td>
                      <td className="trans-chap-stock-table__wrap">{location}</td>
                      <td className="trans-chap-stock-table__wrap">{supplier}</td>
                      <td>
                        {badge ? (
                          <em className={`trans-chap-panel__badge is-${badge.tone}`}>
                            {badge.label}
                          </em>
                        ) : item.is_active ? (
                          <span className="trans-chap-stock-table__muted">In stock</span>
                        ) : (
                          <span className="trans-chap-stock-table__muted">Disabled</span>
                        )}
                      </td>
                      <td>
                        {selecting ? (
                          <span className="trans-chap-stock-table__muted">—</span>
                        ) : (
                          <button
                            type="button"
                            role="switch"
                            className={`theme-switch trans-chap-panel__switch${item.is_active ? " is-on" : ""}`}
                            aria-checked={item.is_active}
                            aria-label={
                              item.is_active ? `Disable ${name}` : `Enable ${name}`
                            }
                            disabled={savingId === item.id}
                            onClick={() => void toggleActive(item)}
                          >
                            <span className="theme-switch__thumb" aria-hidden />
                          </button>
                        )}
                      </td>
                      <td className="trans-chap-stock-table__actions">
                        <div className="trans-chap-stock-table__actions-inner">
                          <Link
                            href={`/trans-chap/stocks/edit?id=${encodeURIComponent(item.id)}`}
                            className="trans-chap-panel__link"
                          >
                            {hotel || item.selling_price != null ? "Edit" : "Set price"}
                          </Link>
                          {hotel ? null : (
                            <Link
                              href={
                                canEditQty
                                  ? "/trans-chap/purchases/new"
                                  : `/trans-chap/purchases/unavailable?name=${encodeURIComponent(name)}${
                                      sku && sku !== "—"
                                        ? `&barcode=${encodeURIComponent(sku)}`
                                        : ""
                                    }`
                              }
                              className="trans-chap-panel__link"
                            >
                              Buy
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                midAction={
                  selecting || hotel || !canEditQty ? null : (
                    <label className="trans-chap-panel__qty-edit">
                      <span>Qty</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={qtyDraftValue(item)}
                        disabled={qtySavingId === item.id}
                        aria-label={`Quantity for ${name}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const value = event.target.value;
                          setQtyDrafts((prev) => ({ ...prev, [item.id]: value }));
                        }}
                        onBlur={() => void saveQty(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            (event.target as HTMLInputElement).blur();
                          }
                          if (event.key === "Escape") {
                            setQtyDrafts((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                            (event.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </label>
                  )
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
                        href={
                          canEditQty
                            ? "/trans-chap/purchases/new"
                            : `/trans-chap/purchases/unavailable?name=${encodeURIComponent(name)}`
                        }
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
            disabled={bulkSaving || !outOfStockFiltered.length}
            onClick={selectOutOfStock}
            title={
              outOfStockFiltered.length
                ? `Select ${outOfStockFiltered.length} out of stock`
                : "No out-of-stock items in this list"
            }
          >
            Out of stock
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
        options={
          canEditQty
            ? [
                { href: "/trans-chap/purchases/new", label: "Scan buy", icon: "fa-barcode" },
                {
                  href: "/trans-chap/purchases/new?mode=select",
                  label: "Select buy",
                  icon: "fa-list",
                },
                {
                  href: "/trans-chap/purchases/unavailable",
                  label: "Buy new item",
                  icon: "fa-cart-plus",
                },
                {
                  href: "/trans-chap/stocks/opening",
                  label: "Opening stock",
                  icon: "fa-boxes-stacked",
                },
                { href: "/trans-chap/stocks/menu", label: "Hotel menu", icon: "fa-utensils" },
              ]
            : [
                {
                  href: "/trans-chap/purchases/unavailable",
                  label: "Buy",
                  icon: "fa-cart-plus",
                },
                { href: "/trans-chap/stocks/menu", label: "Hotel menu", icon: "fa-utensils" },
              ]
        }
      />
      )}
    </div>
  );
}
