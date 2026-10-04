"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapFab } from "@/components/trans-chap/TransChapFab";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapViewToggle } from "@/components/trans-chap/TransChapViewToggle";
import { TransChapFilterChips, type ChipOption } from "@/components/trans-chap/TransChapFilterChips";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { isStoreAdmin } from "@/lib/merchant-permissions";
import { isRestaurantStore } from "@/lib/onboarding";
import { formatNairobiStamp24, isWithinLastDays, nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { formatCategoryLabel } from "@/lib/product-categories";
import { summarizeFailures, useTransChapListView } from "@/lib/trans-chap-list-view";
import { purchaseDraftSummary } from "@/lib/trans-chap-purchase-draft";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { inventoryRoleLabel } from "@/lib/trans-chap-product";
import type { InventoryRole } from "@/lib/types";
import {
  fetchTransChapPurchases,
  promptAndVoidTransChapPurchase,
  promptAndVoidTransChapPurchases,
  type TransChapPurchase,
} from "@/lib/trans-chap-purchases";

type WhenFilter = "all" | "today" | "week" | "month";
type StatusFilter = "all" | "received" | "voided";
type RoleFilter = "all" | InventoryRole;

const WHEN_CHIPS: ChipOption<Exclude<WhenFilter, "all">>[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
];

const STATUS_CHIPS: ChipOption<Exclude<StatusFilter, "all">>[] = [
  { id: "received", label: "Received" },
  { id: "voided", label: "Voided" },
];

const ROLE_CHIPS: ChipOption<InventoryRole>[] = [
  { id: "both", label: "Buy & sell" },
  { id: "for_sale", label: "Sell only" },
  { id: "raw_material", label: "Raw" },
];

function purchaseDateKey(row: TransChapPurchase): string | null {
  const date = parseIso(row.paidAt);
  return date ? nairobiDateKey(date) : null;
}

function purchaseRoleTag(row: TransChapPurchase): string | undefined {
  if (row.inventoryRole === "raw_material") return "Raw";
  if (row.inventoryRole === "both") return "Buy & sell";
  if (row.inventoryRole === "for_sale") return "Sell only";
  return undefined;
}

export function TransChapPurchasesList() {
  const user = useAuthUser();
  const restaurant = isRestaurantStore(user.active_account ?? user.account);
  const accountId = user.active_account?.id || user.account?.id;
  const canVoid = isStoreAdmin(user);

  const listId = useId();
  const [view, setView] = useTransChapListView("trans-chap-purchases-view");
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [when, setWhen] = useState<WhenFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [role, setRole] = useState<RoleFilter>("all");
  const [supplier, setSupplier] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkVoiding, setBulkVoiding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [draftSummary, setDraftSummary] = useState<{
    itemCount: number;
    lineCount: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchTransChapPurchases({ accountId }).then((result) => {
      if (!alive) return;
      setPurchases(result.purchases);
      setError(result.error);
      setTruncated(result.truncated);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  useEffect(() => {
    function refreshDraft() {
      setDraftSummary(purchaseDraftSummary(accountId));
    }
    refreshDraft();
    window.addEventListener("focus", refreshDraft);
    return () => window.removeEventListener("focus", refreshDraft);
  }, [accountId]);

  function mergeUpdated(updated: TransChapPurchase[]) {
    const byId = new Map(updated.map((row) => [row.id, row]));
    setPurchases((prev) => prev.map((row) => byId.get(row.id) ?? row));
  }

  async function voidPurchase(row: TransChapPurchase) {
    setVoidingId(row.id);
    try {
      const updated = await promptAndVoidTransChapPurchase(row);
      if (!updated) return;
      mergeUpdated([updated]);
      await toastSuccess("Purchase voided");
    } catch (err) {
      await showError("Could not void purchase", extractErrorMessage(err));
    } finally {
      setVoidingId(null);
    }
  }

  const todayKey = nairobiDateKey(new Date());
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return purchases.filter((row) => {
      if (needle) {
        const haystack = [
          row.productName,
          row.supplier,
          row.category,
          row.voidReason,
          String(row.quantity),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (status === "received" && row.voidedAt) return false;
      if (status === "voided" && !row.voidedAt) return false;
      if (role !== "all" && row.inventoryRole !== role) return false;
      if (supplier !== "all" && (row.supplier?.trim() || "") !== supplier) return false;
      if (when === "all") return true;
      const key = purchaseDateKey(row);
      if (!key) return false;
      if (when === "today") return key === todayKey;
      return isWithinLastDays(key, when === "week" ? 7 : 30, todayKey);
    });
  }, [purchases, query, role, status, supplier, todayKey, when]);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of purchases) {
      const name = row.supplier?.trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [purchases]);

  const roleOptions = useMemo(
    () => ROLE_CHIPS.filter((chip) => purchases.some((row) => row.inventoryRole === chip.id)),
    [purchases],
  );

  const activeFilterCount =
    Number(when !== "all") +
    Number(status !== "all") +
    Number(role !== "all") +
    Number(supplier !== "all");
  const filtersOn =
    activeFilterCount > 0 || selectedCategory !== "all" || query.trim() !== "";
  const filterSummary = [
    WHEN_CHIPS.find((chip) => chip.id === when)?.label,
    STATUS_CHIPS.find((chip) => chip.id === status)?.label,
    ROLE_CHIPS.find((chip) => chip.id === role)?.label,
    supplier !== "all" ? supplier : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function clearFilters() {
    setWhen("all");
    setStatus("all");
    setRole("all");
    setSupplier("all");
  }

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const row of purchases) {
      if (row.category) set.add(row.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [purchases]);

  const filtered = useMemo(() => {
    if (selectedCategory === "all") return searched;
    const wanted = selectedCategory.toLowerCase();
    return searched.filter((row) => (row.category || "").toLowerCase() === wanted);
  }, [searched, selectedCategory]);

  const totals = useMemo(() => {
    const received = filtered.filter((row) => !row.voidedAt);
    return {
      count: received.length,
      amount: received.reduce((sum, row) => sum + row.total, 0),
      voided: filtered.length - received.length,
    };
  }, [filtered]);

  const voidable = useMemo(() => filtered.filter((row) => !row.voidedAt), [filtered]);
  const selectedRows = voidable.filter((row) => selectedIds.has(row.id));

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

  function toggleSelectAll() {
    setSelectedIds(
      selectedRows.length === voidable.length
        ? new Set()
        : new Set(voidable.map((row) => row.id)),
    );
  }

  async function voidSelected() {
    if (!selectedRows.length || bulkVoiding) return;
    setBulkVoiding(true);
    try {
      const result = await promptAndVoidTransChapPurchases(selectedRows);
      if (!result) return;
      mergeUpdated(result.updated);
      if (result.failures.length) {
        setSelectedIds(
          new Set(
            selectedRows
              .filter((row) => !result.updated.some((u) => u.id === row.id))
              .map((row) => row.id),
          ),
        );
        await showError(
          result.updated.length
            ? `Voided ${result.updated.length}, ${result.failures.length} failed`
            : "Could not void purchases",
          summarizeFailures(result.failures),
        );
        return;
      }
      await toastSuccess(
        result.updated.length === 1
          ? "Purchase voided"
          : `${result.updated.length} purchases voided`,
      );
      stopSelecting();
    } finally {
      setBulkVoiding(false);
    }
  }

  function renderCheck(row: TransChapPurchase) {
    if (row.voidedAt) return null;
    const picked = selectedIds.has(row.id);
    return (
      <button
        type="button"
        role="checkbox"
        className={`trans-chap-panel__check${picked ? " is-on" : ""}`}
        aria-checked={picked}
        aria-label={`${picked ? "Unselect" : "Select"} ${row.productName}`}
        onClick={() => toggleSelected(row.id)}
      >
        {picked ? <i className="fa-solid fa-check" aria-hidden /> : null}
      </button>
    );
  }

  function renderVoidButton(row: TransChapPurchase) {
    if (!canVoid || row.voidedAt) return null;
    return (
      <button
        type="button"
        className="trans-chap-panel__link trans-chap-panel__void"
        disabled={voidingId === row.id || bulkVoiding}
        onClick={() => void voidPurchase(row)}
      >
        {voidingId === row.id ? "Working…" : "Void purchase"}
      </button>
    );
  }

  return (
    <div className={`trans-chap-sales${view === "list" ? " trans-chap-sales--list" : ""}`}>
      {draftSummary ? (
        <TransChapStatus
          tone="draft"
          actionHref="/trans-chap/purchases/new"
          actionLabel="Continue"
        >
          {draftSummary.lineCount === 1
            ? `You have a purchase draft (${draftSummary.itemCount} qty).`
            : `You have a purchase draft (${draftSummary.lineCount} items · ${draftSummary.itemCount} qty).`}
        </TransChapStatus>
      ) : null}
      <div className="trans-chap-sales__filters">
        <div className="trans-chap-sales__search-row">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder={
                restaurant
                  ? "Search kitchen supplies & purchases…"
                  : "Search purchases…"
              }
              aria-label={restaurant ? "Search kitchen supplies" : "Search purchases"}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`trans-chap-sales__filter-btn${filtersOpen || activeFilterCount ? " is-on" : ""}`}
            aria-expanded={filtersOpen}
            aria-controls="trans-chap-purchases-filters"
            aria-label="Filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <i className="fa-solid fa-sliders" aria-hidden />
            {activeFilterCount ? <em>{activeFilterCount}</em> : null}
          </button>
          <TransChapViewToggle view={view} onChange={setView} label="Purchases layout" />
          {canVoid && purchases.some((row) => !row.voidedAt) ? (
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
        {filtersOpen ? (
          <div id="trans-chap-purchases-filters" className="trans-chap-sales__chips">
            <TransChapFilterChips label="When" value={when} options={WHEN_CHIPS} onChange={setWhen} />
            <TransChapFilterChips label="Status" value={status} options={STATUS_CHIPS} onChange={setStatus} />
            {roleOptions.length > 1 ? (
              <TransChapFilterChips label="Type" value={role} options={roleOptions} onChange={setRole} />
            ) : null}
            {supplierOptions.length > 1 ? (
              <div className="trans-chap-sales__chips-group">
                <select
                  className={`trans-chap-sales__chip trans-chap-sales__select${supplier !== "all" ? " is-active" : ""}`}
                  value={supplier}
                  aria-label="Supplier"
                  onChange={(event) => setSupplier(event.target.value)}
                >
                  <option value="all">All suppliers</option>
                  {supplierOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {activeFilterCount ? (
              <button
                type="button"
                className="trans-chap-sales__chip trans-chap-sales__chip--clear"
                onClick={clearFilters}
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : filterSummary ? (
          <button
            type="button"
            className="trans-chap-sales__summary"
            onClick={() => setFiltersOpen(true)}
          >
            {filterSummary}
          </button>
        ) : null}
        {availableCategories.length > 1 ? (
          <div
            className="pos-category-chips"
            role="tablist"
            aria-label="Filter purchases by category"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === "all"}
              className={`pos-category-chip${selectedCategory === "all" ? " is-active" : ""}`}
              onClick={() => setSelectedCategory("all")}
            >
              <i className="fa-solid fa-layer-group" aria-hidden="true" />
              <span>All ({searched.length})</span>
            </button>
            {availableCategories.map((cat) => {
              const active = selectedCategory.toLowerCase() === cat.toLowerCase();
              const count = searched.filter(
                (row) => (row.category || "").toLowerCase() === cat.toLowerCase(),
              ).length;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`pos-category-chip${active ? " is-active" : ""}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  <span>{formatCategoryLabel(cat)}</span>
                  <span className="pos-category-chip__count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {!loading && purchases.length ? (
        <p className="trans-chap-sales__totals" aria-live="polite">
          <strong>{formatKsh(totals.amount)}</strong>
          <span>
            {totals.count} purchase{totals.count === 1 ? "" : "s"}
            {totals.voided ? ` · ${totals.voided} voided` : ""}
            {filtersOn ? " · filtered" : ""}
          </span>
        </p>
      ) : null}
      <div className="trans-chap-sales__list">
        {loading ? (
          <TransChapListSkeleton />
        ) : error && purchases.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : purchases.length === 0 ? (
          <TransChapStatus
            actionHref={
              restaurant
                ? "/trans-chap/purchases/new?mode=select"
                : "/trans-chap/purchases/new"
            }
            actionLabel={restaurant ? "Buy supplies" : "Record a purchase"}
          >
            {restaurant
              ? "No kitchen supplies or purchases yet. Record ingredients and supplies when you buy them."
              : "No purchases yet."}
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">
            {restaurant
              ? "No kitchen supplies match these filters."
              : "No purchases match these filters."}
            {activeFilterCount || selectedCategory !== "all" ? (
              <>
                {" "}
                <button
                  type="button"
                  className="trans-chap-sales__chip trans-chap-sales__chip--clear"
                  onClick={() => {
                    clearFilters();
                    setSelectedCategory("all");
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : null}
          </p>
        ) : view === "list" ? (
          <div className="trans-chap-stock-table-wrap trans-chap-stock-table-wrap--cards">
            <table className="trans-chap-stock-table trans-chap-stock-table--cards trans-chap-stock-table--purchase">
              <thead>
                <tr>
                  {selecting ? <th className="trans-chap-stock-table__check" scope="col"> </th> : null}
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Unit cost</th>
                  <th scope="col">Total</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  {canVoid ? (
                    <th className="trans-chap-stock-table__actions" scope="col">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const voided = Boolean(row.voidedAt);
                  const picked = selectedIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={`${voided ? "is-inactive" : ""}${picked ? " is-picked" : ""}`}
                    >
                      {selecting ? (
                        <td className="trans-chap-stock-table__check">{renderCheck(row)}</td>
                      ) : null}
                      <td className="trans-chap-stock-table__product">
                        <div className="trans-chap-stock-table__product-inner">
                          <span>{row.productName}</span>
                          {purchaseRoleTag(row) ? (
                            <em className="trans-chap-panel__tag">{purchaseRoleTag(row)}</em>
                          ) : null}
                        </div>
                      </td>
                      <td>{row.category ? formatCategoryLabel(row.category) : "—"}</td>
                      <td className="trans-chap-stock-table__mono">{row.quantity}</td>
                      <td>{formatKsh(row.unitCost)}</td>
                      <td className="trans-chap-stock-table__strong">{formatKsh(row.total)}</td>
                      <td className="trans-chap-stock-table__wrap">{row.supplier?.trim() || "—"}</td>
                      <td className="trans-chap-stock-table__mono">
                        {formatNairobiStamp24(row.paidAt) || "—"}
                      </td>
                      <td>
                        {voided ? (
                          <em
                            className="trans-chap-panel__badge is-fail"
                            title={row.voidReason || undefined}
                          >
                            Voided
                          </em>
                        ) : (
                          <span className="trans-chap-stock-table__muted">Received</span>
                        )}
                      </td>
                      {canVoid ? (
                        <td className="trans-chap-stock-table__actions">
                          <div className="trans-chap-stock-table__actions-inner">
                            {selecting ? null : renderVoidButton(row)}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
          {filtered.map((row) => {
            const open = !selecting && openId === row.id;
            const panelId = `${listId}-${row.id}`;
            const voided = Boolean(row.voidedAt);
            return (
              <MotionItem key={row.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="purchase"
                title={row.productName}
                tag={purchaseRoleTag(row)}
                qty={`Qty ${row.quantity}`}
                price={formatKsh(row.total)}
                badge={voided ? { label: "Voided", tone: "fail" } : undefined}
                inactive={selecting && voided}
                picking={selecting}
                picked={selectedIds.has(row.id)}
                onToggle={() => {
                  if (!selecting) setOpenId(open ? null : row.id);
                  else if (!voided) toggleSelected(row.id);
                }}
                headAction={selecting ? renderCheck(row) : undefined}
                action={renderVoidButton(row)}
              >
                <p className="trans-chap-panel__lead">
                  {voided
                    ? "This purchase was voided. Its stock was taken back out."
                    : "Stock was added for this purchase."}
                </p>
                <ul className="trans-chap-panel__lines">
                  <li>
                    <span>
                      {row.productName}
                      {row.quantity > 1 ? ` × ${row.quantity}` : ""}
                    </span>
                    <em>{formatKsh(row.total)}</em>
                  </li>
                </ul>
                <dl className="trans-chap-panel__facts">
                  <div>
                    <dt>Type</dt>
                    <dd>{inventoryRoleLabel(row.inventoryRole)}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{row.category ? formatCategoryLabel(row.category) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Unit cost</dt>
                    <dd>{formatKsh(row.unitCost)}</dd>
                  </div>
                  <div>
                    <dt>Qty</dt>
                    <dd>{row.quantity}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{formatNairobiStamp24(row.paidAt) || "—"}</dd>
                  </div>
                  <div>
                    <dt>Supplier</dt>
                    <dd>{row.supplier?.trim() || "—"}</dd>
                  </div>
                  {voided ? (
                    <>
                      <div>
                        <dt>Voided</dt>
                        <dd>{formatNairobiStamp24(row.voidedAt) || "—"}</dd>
                      </div>
                      <div>
                        <dt>Reason</dt>
                        <dd>{row.voidReason?.trim() || "—"}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </TransChapPanel>
              </MotionItem>
            );
          })}
          </MotionList>
        )}
        {truncated ? (
          <p className="trans-chap-sales__empty">Showing the most recent 2,000 purchases.</p>
        ) : null}
      </div>
      {selecting ? (
        <div className="trans-chap-bulk-bar">
          <p className="trans-chap-bulk-bar__count">
            {selectedRows.length ? `${selectedRows.length} selected` : "Tap purchases to select"}
          </p>
          <button type="button" disabled={bulkVoiding || !voidable.length} onClick={toggleSelectAll}>
            {voidable.length && selectedRows.length === voidable.length ? "None" : "All"}
          </button>
          <button
            type="button"
            className="trans-chap-bulk-bar__disable"
            disabled={bulkVoiding || !selectedRows.length}
            onClick={() => void voidSelected()}
          >
            {bulkVoiding ? "Voiding…" : "Void"}
          </button>
        </div>
      ) : (
        <TransChapFab
          label={restaurant ? "Buy supplies" : "New purchase"}
          href="/trans-chap/purchases/new"
        />
      )}
    </div>
  );
}
