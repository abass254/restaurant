"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { Skeleton } from "@/components/app/Skeleton";
import { MotionModal } from "@/components/app/MotionModal";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import {
  buildAutoDescription,
  categoriesFor,
  getCategory,
  isFieldVisible,
  type ProductCategoryField,
} from "@/lib/product-categories";
import { pickRandomSample } from "@/lib/product-samples";
import type {
  CatalogProduct,
  CatalogProductMutationResponse,
  CatalogProductsResponse,
  InventoryItem,
  InventoryItemMutationResponse,
  InventoryImportResponse,
  InventoryResponse,
  ProductImageGenerateResponse,
  ProductType,
} from "@/lib/types";

type AddPanelView = "search" | "create";
type InventoryViewMode = "table" | "grid";

const INVENTORY_VIEW_MODE_KEY = "inventory:view_mode";

function formatPrice(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `KES ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function nameInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function itemCoverUrl(item: InventoryItem): string | null {
  return (
    item.media?.find((m) => !m.content_type?.startsWith("video/"))?.url ??
    item.product?.image_url ??
    null
  );
}

function canBulkGenerateImage(item: InventoryItem): boolean {
  return item.product?.product_type === "product";
}

function isServiceItem(item: InventoryItem): boolean {
  return item.product?.product_type === "service";
}

function isOutOfStock(item: InventoryItem): boolean {
  if (isServiceItem(item)) return false;
  const stock = item.stock_quantity;
  return stock == null || stock <= 0;
}

async function generateItemImage(
  item: InventoryItem,
  opts?: { quality?: "low" | "medium" | "high"; prompt?: string },
): Promise<InventoryItem> {
  const res = await apiFetch<ProductImageGenerateResponse>(
    apiRoutes.inventoryMediaGenerate(item.id),
    {
      method: "POST",
      body: JSON.stringify({
        prompt: opts?.prompt?.trim() || null,
        quality: opts?.quality ?? null,
      }),
    },
  );
  return res.data;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

export default function InventoryPage() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterText, setFilterText] = useState("");
  const [viewMode, setViewMode] = useState<InventoryViewMode>("table");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelView, setPanelView] = useState<AddPanelView>("search");
  const [importOpen, setImportOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setItems(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load inventory."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(INVENTORY_VIEW_MODE_KEY);
      if (stored === "grid" || stored === "table") {
        setViewMode(stored);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  function changeViewMode(mode: InventoryViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(INVENTORY_VIEW_MODE_KEY, mode);
    } catch {
      /* localStorage unavailable */
    }
  }

  const filteredItems = useMemo(() => {
    const term = filterText.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const haystacks = [
        item.product?.name,
        item.product?.brand,
        item.product?.category,
        item.product?.product_code,
        item.product?.sku,
      ];
      return haystacks.some((h) => h && h.toLowerCase().includes(term));
    });
  }, [items, filterText]);

  const selectableFilteredItems = useMemo(
    () => filteredItems.filter(canBulkGenerateImage),
    [filteredItems],
  );

  const selectedCount = selectedIds.size;
  const allSelectableSelected =
    selectableFilteredItems.length > 0 &&
    selectableFilteredItems.every((item) => selectedIds.has(item.id));
  const someSelectableSelected =
    selectableFilteredItems.some((item) => selectedIds.has(item.id)) &&
    !allSelectableSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableSelected;
    }
  }, [someSelectableSelected, selectedCount, selectableFilteredItems.length]);

  function toggleRowSelection(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelectableSelected) {
        for (const item of selectableFilteredItems) next.delete(item.id);
      } else {
        for (const item of selectableFilteredItems) next.add(item.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // After a product is added without a photo we quietly kick off an AI
  // generation. The result patches into the list when it lands — there's no
  // blocking spinner, so the user can carry on with their day.
  const maybeGenerateCover = useCallback((inventoryItem: InventoryItem) => {
    const hasPhoto =
      (inventoryItem.media?.length ?? 0) > 0 || !!inventoryItem.product?.image_url;
    const product = inventoryItem.product;
    if (!product || hasPhoto || product.product_type !== "product") return;

    void generateItemImage(inventoryItem)
      .then((updated) => {
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        void toastSuccess(`AI image ready for "${product.name}"`);
      })
      .catch(() => {
        /* Silent — optional background generation. */
      });
  }, []);

  async function handleAddFromCatalog(product: CatalogProduct) {
    try {
      const data = await apiFetch<InventoryItemMutationResponse>(
        apiRoutes.inventory,
        {
          method: "POST",
          body: JSON.stringify({ product_id: product.id }),
        },
      );
      setItems((prev) => [data.data, ...prev]);
      await toastSuccess(`Added "${product.name}" to your inventory`);
      setPanelOpen(false);
      maybeGenerateCover(data.data);
    } catch (err) {
      await showError("Could not add product", extractErrorMessage(err));
    }
  }

  async function handleBulkGenerate() {
    const selected = items.filter(
      (item) => selectedIds.has(item.id) && canBulkGenerateImage(item),
    );
    if (selected.length === 0) {
      await showError(
        "Nothing to generate",
        "Select product rows to generate images. Services are skipped.",
      );
      return;
    }

    if (selected.length > 3) {
      const confirmed = await confirmAction(
        "Generate AI images?",
        `This will generate images for ${selected.length} products. Each one can take up to a minute.`,
        "Generate",
      );
      if (!confirmed) return;
    }

    setBulkGenerating(true);
    setGeneratingIds(new Set(selected.map((item) => item.id)));
    let succeeded = 0;
    let failed = 0;
    let lastError: unknown = null;

    await runWithConcurrency(selected, 2, async (item) => {
      try {
        const updated = await generateItemImage(item);
        setItems((prev) =>
          prev.map((row) => (row.id === updated.id ? updated : row)),
        );
        succeeded += 1;
      } catch (err) {
        lastError = err;
        failed += 1;
      } finally {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    });

    setBulkGenerating(false);
    clearSelection();

    if (succeeded > 0 && failed === 0) {
      await toastSuccess(
        `Generated ${succeeded} image${succeeded === 1 ? "" : "s"}`,
      );
    } else if (succeeded > 0) {
      await showError(
        "Partial success",
        `Generated ${succeeded} image${succeeded === 1 ? "" : "s"}, ${failed} failed.`,
      );
    } else {
      await showError(
        "Generation failed",
        extractErrorMessage(
          lastError,
          "Could not generate images. Check your AI provider settings and try again.",
        ),
      );
    }
  }

  function handleItemUpdated(updated: InventoryItem) {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  async function handleDelete(item: InventoryItem) {
    const confirmed = await confirmAction(
      "Remove from inventory?",
      `"${item.product?.name ?? "This product"}" will no longer appear in your shop's inventory.`,
      "Yes, remove",
    );
    if (!confirmed) return;
    try {
      await apiFetch(apiRoutes.inventoryItem(item.id), { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setSelectedIds((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      await toastSuccess("Removed from inventory");
    } catch (err) {
      await showError("Could not remove", extractErrorMessage(err));
    }
  }

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Inventory</h1>
          <p className="app-lead">
            Products and services your shop sells. Pulled from a shared
            catalog so we can see what's common across all shops.
          </p>
        </div>
        <div className="inventory-header__actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setImportOpen(true)}
          >
            <i className="fa-solid fa-file-excel" aria-hidden="true" />
            Import Excel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setPanelView("search");
              setPanelOpen(true);
            }}
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            Add product
          </button>
        </div>
      </header>

      <div className="inventory-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter inventory by name, code, brand…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
        <div
          className="inventory-toolbar__view"
          role="group"
          aria-label="View mode"
        >
          <button
            type="button"
            className={viewMode === "table" ? "is-active" : undefined}
            onClick={() => changeViewMode("table")}
            aria-pressed={viewMode === "table"}
            title="Table view"
          >
            <i className="fa-solid fa-table-list" aria-hidden="true" />
            <span className="sr-only">Table view</span>
          </button>
          <button
            type="button"
            className={viewMode === "grid" ? "is-active" : undefined}
            onClick={() => changeViewMode("grid")}
            aria-pressed={viewMode === "grid"}
            title="Grid view"
          >
            <i className="fa-solid fa-grip" aria-hidden="true" />
            <span className="sr-only">Grid view</span>
          </button>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="inventory-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="inventory-bulk-bar__count">
            {selectedCount} selected
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={bulkGenerating}
            onClick={() => void handleBulkGenerate()}
          >
            <i
              className={`fa-solid ${bulkGenerating ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"}`}
              aria-hidden="true"
            />
            {bulkGenerating ? "Generating…" : "Generate images"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={bulkGenerating}
            onClick={clearSelection}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {error ? <p className="app-error">{error}</p> : null}

      {loading ? (
        <InventorySkeleton viewMode={viewMode} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          hasAny={items.length > 0}
          onAdd={() => {
            setPanelView("search");
            setPanelOpen(true);
          }}
        />
      ) : viewMode === "grid" ? (
        <InventoryGrid
          items={filteredItems}
          reduce={reduce}
          bulkGenerating={bulkGenerating}
          selectedIds={selectedIds}
          generatingIds={generatingIds}
          onToggleSelection={toggleRowSelection}
          onItemUpdated={handleItemUpdated}
        />
      ) : (
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th className="inventory-th-select" aria-label="Select">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="inventory-row-checkbox"
                    checked={allSelectableSelected}
                    disabled={
                      bulkGenerating || selectableFilteredItems.length === 0
                    }
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible products"
                  />
                </th>
                <th className="inventory-th-image" aria-label="Image" />
                <th>Product</th>
                <th>Code</th>
                <th>Buy</th>
                <th>Sell</th>
                <th>Stock</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <motion.tbody
              variants={reduce ? undefined : staggerContainer}
              initial={reduce ? false : "hidden"}
              animate={reduce ? undefined : "visible"}
            >
              {filteredItems.map((item) => {
                const cat = getCategory(item.product?.category);
                const coverUrl = itemCoverUrl(item);
                const productName = item.product?.name ?? `#${item.product_id}`;
                const detailHref = `/inventory/${item.id}`;
                const selectable = canBulkGenerateImage(item);
                const isSelected = selectedIds.has(item.id);
                const isGenerating = generatingIds.has(item.id);
                return (
                  <motion.tr
                    key={item.id}
                    variants={reduce ? undefined : staggerItem}
                    layout={reduce ? false : "position"}
                    className={isSelected ? "is-selected" : undefined}
                  >
                    <td className="inventory-cell-select">
                      <input
                        type="checkbox"
                        className="inventory-row-checkbox"
                        checked={isSelected}
                        disabled={bulkGenerating || !selectable}
                        onChange={() => toggleRowSelection(item.id)}
                        aria-label={
                          selectable
                            ? `Select ${productName}`
                            : `${productName} (services cannot be bulk-generated)`
                        }
                      />
                    </td>
                    <td className="inventory-cell-image">
                      <Link
                        href={detailHref}
                        className="inventory-cell-image__link"
                        aria-label={`Open ${productName}`}
                        tabIndex={-1}
                      >
                        {coverUrl ? (
                          <img
                            className="inventory-thumb"
                            src={resolveAssetUrl(coverUrl)}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span
                            className="inventory-thumb inventory-thumb--empty"
                            aria-hidden="true"
                          >
                            {nameInitial(item.product?.name)}
                          </span>
                        )}
                        {isGenerating ? (
                          <span className="inventory-thumb__generating" aria-hidden="true">
                            <i className="fa-solid fa-spinner fa-spin" />
                          </span>
                        ) : null}
                      </Link>
                    </td>
                    <td>
                      <Link
                        href={detailHref}
                        className="inventory-cell-product inventory-cell-product--link"
                      >
                        <span className="inventory-cell-product__text">
                          <strong>{productName}</strong>
                          <span className="app-muted">
                            {item.product?.brand ?? null}
                            {item.product?.brand && cat ? " · " : null}
                            {cat?.label ?? null}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <code className="inventory-code">
                        {item.product?.product_code ?? "—"}
                      </code>
                    </td>
                    <td>{formatPrice(item.buying_price)}</td>
                    <td>
                      <div className="inventory-cell-price">
                        <strong>{formatPrice(item.selling_price)}</strong>
                        {item.margin !== null ? (
                          <span className="app-muted inventory-margin">
                            {item.margin >= 0 ? "+" : ""}
                            {formatPrice(item.margin)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={item.is_low_stock ? "inventory-low" : ""}>
                        {item.stock_quantity ?? "—"}
                        {item.product?.unit ? ` ${item.product.unit}` : null}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`inventory-status-pill ${item.is_active ? "is-on" : "is-off"}`}
                      >
                        {item.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="inventory-actions-cell">
                      <Link
                        href={detailHref}
                        className="btn btn-ghost btn-sm"
                        title="Open product"
                      >
                        <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm inventory-danger"
                        onClick={() => void handleDelete(item)}
                        aria-label="Remove from inventory"
                      >
                        <i className="fa-solid fa-trash" aria-hidden="true" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      )}

      <AddProductPanel
        open={panelOpen}
        view={panelView}
        onChangeView={setPanelView}
        onClose={() => setPanelOpen(false)}
        onAddExisting={(p) => void handleAddFromCatalog(p)}
        onCreated={(p) => void handleAddFromCatalog(p)}
        existingProductIds={new Set(items.map((i) => i.product_id))}
      />

      <ImportExcelModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => void reload()}
      />
    </section>
  );
}

function stockFieldValue(value: number | null): string {
  return value !== null ? String(value) : "";
}

function parseStockField(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return parsed;
}

function InventoryGridStockFields({
  item,
  onUpdated,
}: {
  item: InventoryItem;
  onUpdated: (item: InventoryItem) => void;
}) {
  const unit = item.product?.unit;
  const [stockQty, setStockQty] = useState(() =>
    stockFieldValue(item.stock_quantity),
  );
  const [minQty, setMinQty] = useState(() =>
    stockFieldValue(item.low_stock_threshold),
  );
  const [saving, setSaving] = useState(false);
  const saveRequest = useRef(0);

  useEffect(() => {
    setStockQty(stockFieldValue(item.stock_quantity));
    setMinQty(stockFieldValue(item.low_stock_threshold));
  }, [item.id, item.stock_quantity, item.low_stock_threshold]);

  const dirty =
    parseStockField(stockQty) !== item.stock_quantity ||
    parseStockField(minQty) !== item.low_stock_threshold;

  async function persist(nextStock = stockQty, nextMin = minQty) {
    const stock_quantity = parseStockField(nextStock);
    const low_stock_threshold = parseStockField(nextMin);
    if (
      stock_quantity === item.stock_quantity &&
      low_stock_threshold === item.low_stock_threshold
    ) {
      return;
    }

    const requestId = saveRequest.current + 1;
    saveRequest.current = requestId;
    setSaving(true);
    try {
      const data = await apiFetch<InventoryItemMutationResponse>(
        apiRoutes.inventoryItem(item.id),
        {
          method: "PATCH",
          body: JSON.stringify({ stock_quantity, low_stock_threshold }),
        },
      );
      if (saveRequest.current === requestId) {
        onUpdated(data.data);
      }
    } catch (err) {
      if (saveRequest.current === requestId) {
        await showError("Could not update stock", extractErrorMessage(err));
        setStockQty(stockFieldValue(item.stock_quantity));
        setMinQty(stockFieldValue(item.low_stock_threshold));
      }
    } finally {
      if (saveRequest.current === requestId) {
        setSaving(false);
      }
    }
  }

  function adjustStock(delta: number) {
    const current = parseStockField(stockQty) ?? 0;
    const next = String(Math.max(0, current + delta));
    setStockQty(next);
    void persist(next, minQty);
  }

  return (
    <div
      className={`inventory-grid-stock${saving ? " is-saving" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="inventory-grid-stock__field">
        <span className="inventory-grid-stock__label">
          Qty{unit ? ` (${unit})` : ""}
        </span>
        <div className="inventory-grid-stock__stepper">
          <button
            type="button"
            className="inventory-grid-stock__step"
            onClick={() => adjustStock(-1)}
            disabled={saving || (parseStockField(stockQty) ?? 0) <= 0}
            aria-label="Decrease quantity"
          >
            <i className="fa-solid fa-minus" aria-hidden="true" />
          </button>
          <input
            type="number"
            min={0}
            className="inventory-grid-stock__input"
            value={stockQty}
            disabled={saving}
            onChange={(e) => setStockQty(e.target.value)}
            onBlur={() => {
              if (dirty) void persist();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            aria-label={`Stock quantity${unit ? ` in ${unit}` : ""}`}
          />
          <button
            type="button"
            className="inventory-grid-stock__step"
            onClick={() => adjustStock(1)}
            disabled={saving}
            aria-label="Increase quantity"
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="inventory-grid-stock__field">
        <span className="inventory-grid-stock__label">Min qty</span>
        <input
          type="number"
          min={0}
          className="inventory-grid-stock__input inventory-grid-stock__input--solo"
          value={minQty}
          disabled={saving}
          onChange={(e) => setMinQty(e.target.value)}
          onBlur={() => {
            if (dirty) void persist();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          placeholder="5"
          aria-label="Low-stock alert threshold"
        />
      </div>
    </div>
  );
}

function InventoryGrid({
  items,
  reduce,
  bulkGenerating,
  selectedIds,
  generatingIds,
  onToggleSelection,
  onItemUpdated,
}: {
  items: InventoryItem[];
  reduce: boolean | null;
  bulkGenerating: boolean;
  selectedIds: Set<string>;
  generatingIds: Set<string>;
  onToggleSelection: (itemId: string) => void;
  onItemUpdated: (item: InventoryItem) => void;
}) {
  return (
    <div className="inventory-grid-wrap">
      <motion.ul
        className="pos-cards"
        variants={reduce ? undefined : staggerContainer}
        initial={reduce ? false : "hidden"}
        animate={reduce ? undefined : "visible"}
      >
        {items.map((item) => {
          const cat = getCategory(item.product?.category);
          const coverUrl = itemCoverUrl(item);
          const productName = item.product?.name ?? `#${item.product_id}`;
          const detailHref = `/inventory/${item.id}`;
          const selectable = canBulkGenerateImage(item);
          const isSelected = selectedIds.has(item.id);
          const isGenerating = generatingIds.has(item.id);
          const subtitleParts = [
            cat?.label,
            item.product?.brand,
          ].filter(Boolean) as string[];
          const subtitle = subtitleParts.join(" · ");
          const hasPrice = item.selling_price !== null;
          const outOfStock = isOutOfStock(item);
          const showStockFields = !isServiceItem(item);

          return (
            <motion.li
              key={item.id}
              variants={reduce ? undefined : staggerItem}
              layout={reduce ? false : "position"}
              className={`pos-card inventory-grid-card${isSelected ? " is-selected" : ""}${!item.is_active ? " is-paused" : ""}`}
            >
              <div className="pos-card__hit">
                {selectable ? (
                  <input
                    type="checkbox"
                    className="inventory-grid-checkbox"
                    checked={isSelected}
                    disabled={bulkGenerating}
                    onChange={() => onToggleSelection(item.id)}
                    aria-label={
                      isSelected
                        ? `Deselect ${productName}`
                        : `Select ${productName}`
                    }
                  />
                ) : null}
                <Link
                  href={detailHref}
                  className="pos-card__main"
                  aria-label={`Open ${productName}`}
                >
                  <div className="pos-card__thumb" aria-hidden="true">
                    {coverUrl ? (
                      <img
                        src={resolveAssetUrl(coverUrl)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="pos-card__thumb-fallback">
                        {nameInitial(item.product?.name)}
                      </span>
                    )}
                    {isGenerating ? (
                      <span className="inventory-thumb__generating" aria-hidden="true">
                        <i className="fa-solid fa-spinner fa-spin" />
                      </span>
                    ) : null}
                  </div>

                  <div className="pos-card__info">
                    <span className="pos-card__name">{productName}</span>
                    {subtitle ? (
                      <span className="pos-card__subtitle">{subtitle}</span>
                    ) : null}
                    <span className="pos-card__price">
                      {!item.is_active ? (
                        <span className="pos-card__price-unit">Paused</span>
                      ) : outOfStock ? (
                        <span className="pos-card__price-unset">Out of stock</span>
                      ) : hasPrice && item.selling_price !== null ? (
                        <>
                          <span className="pos-card__price-amount">
                            {formatPrice(item.selling_price)}
                          </span>
                          {item.product?.unit ? (
                            <span className="pos-card__price-unit">
                              /{item.product.unit}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="pos-card__price-unset">No price set</span>
                      )}
                    </span>
                  </div>
                </Link>

                <div className="pos-card__action">
                  <Link
                    href={detailHref}
                    className="pos-card__add"
                    aria-label={`Open ${productName}`}
                    title="Open product"
                  >
                    <i
                      className="fa-solid fa-arrow-up-right-from-square"
                      aria-hidden="true"
                    />
                  </Link>
                </div>
              </div>
              {showStockFields ? (
                <InventoryGridStockFields
                  item={item}
                  onUpdated={onItemUpdated}
                />
              ) : null}
            </motion.li>
          );
        })}
      </motion.ul>
    </div>
  );
}

function InventorySkeleton({ viewMode = "table" }: { viewMode?: InventoryViewMode }) {
  if (viewMode === "grid") {
    const cards = Array.from({ length: 9 });
    return (
      <div className="inventory-grid-wrap" aria-busy="true" aria-live="polite">
        <ul className="pos-cards">
          {cards.map((_, i) => (
            <li key={i} className="pos-card inventory-grid-card">
              <div className="pos-card__hit">
                <div className="pos-card__main">
                  <Skeleton variant="rect" width={56} height={56} />
                  <div className="pos-card__info">
                    <Skeleton variant="text" height={14} width="80%" />
                    <Skeleton variant="text" height={11} width="55%" />
                    <Skeleton variant="text" height={12} width="40%" />
                  </div>
                </div>
                <Skeleton variant="circle" width={32} height={32} />
              </div>
              <div className="inventory-grid-stock">
                <Skeleton variant="rect" height={32} />
                <Skeleton variant="rect" height={32} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Six rows feels like "the table will be here" without looking like a
  // commitment to a specific item count. Matches the real columns.
  const rows = Array.from({ length: 6 });
  return (
    <div className="inventory-table-wrap" aria-busy="true" aria-live="polite">
      <table className="inventory-table">
        <thead>
          <tr>
            <th className="inventory-th-select" aria-label="Select" />
            <th className="inventory-th-image" aria-label="Image" />
            <th>Product</th>
            <th>Code</th>
            <th>Buy</th>
            <th>Sell</th>
            <th>Stock</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((_, i) => (
            <tr key={i}>
              <td className="inventory-cell-select">
                <Skeleton variant="rect" width={16} height={16} />
              </td>
              <td className="inventory-cell-image">
                <Skeleton variant="rect" width={48} height={48} />
              </td>
              <td>
                <Skeleton variant="text" height={14} width="60%" />
                <Skeleton variant="text" height={11} width="40%" />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={60} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={70} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={80} />
              </td>
              <td>
                <Skeleton variant="text" height={12} width={40} />
              </td>
              <td>
                <Skeleton variant="text" height={20} width={56} />
              </td>
              <td>
                <Skeleton variant="text" height={20} width={60} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({
  hasAny,
  onAdd,
}: {
  hasAny: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="inventory-empty">
      <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
      <h2>{hasAny ? "No matches" : "Your inventory is empty"}</h2>
      <p>
        {hasAny
          ? "Try a different filter or clear the search."
          : "Add your first product or service from the shared catalog (or create a new one)."}
      </p>
      {!hasAny ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Add your first product
        </button>
      ) : null}
    </div>
  );
}

function AddProductPanel({
  open,
  view,
  onChangeView,
  onClose,
  onAddExisting,
  onCreated,
  existingProductIds,
}: {
  open: boolean;
  view: AddPanelView;
  onChangeView: (v: AddPanelView) => void;
  onClose: () => void;
  onAddExisting: (p: CatalogProduct) => void;
  onCreated: (p: CatalogProduct) => void;
  existingProductIds: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [searching, setSearching] = useState(false);
  // Bumped every time the "Fill with sample" button is clicked. CreateView
  // watches this and (when > 0) replaces its draft with a random sample.
  const [fillSeed, setFillSeed] = useState(0);

  useEffect(() => {
    if (view !== "search") return;
    const handle = window.setTimeout(() => {
      setSearching(true);
      const url = query.trim()
        ? `${apiRoutes.products}?q=${encodeURIComponent(query.trim())}`
        : apiRoutes.products;
      void apiFetch<CatalogProductsResponse>(url)
        .then((d) => setResults(d.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, view]);

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Add product to inventory"
      panelClassName="inventory-modal--wide"
    >
      <header className="inventory-modal__head">
        <h2>Add to inventory</h2>
        <div className="inventory-modal__head-actions">
          {view === "create" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFillSeed((s) => s + 1)}
              title="Fill the form with a random sample product"
            >
              <i className="fa-solid fa-dice" aria-hidden="true" />
              Fill with sample
            </button>
          ) : null}
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="inventory-modal__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "search"}
          className={`inventory-tab${view === "search" ? " is-active" : ""}`}
          onClick={() => onChangeView("search")}
        >
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          Search catalog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "create"}
          className={`inventory-tab${view === "create" ? " is-active" : ""}`}
          onClick={() => onChangeView("create")}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Create new
        </button>
      </div>

      <div className="inventory-modal__body">
        {view === "search" ? (
          <SearchView
            query={query}
            setQuery={setQuery}
            results={results}
            searching={searching}
            existingProductIds={existingProductIds}
            onPick={onAddExisting}
            onSwitchToCreate={() => onChangeView("create")}
          />
        ) : (
          <CreateView
            onCreated={onCreated}
            onCancel={() => onChangeView("search")}
            fillSeed={fillSeed}
          />
        )}
      </div>
    </MotionModal>
  );
}

function ImportExcelModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InventoryImportResponse | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      setResult(null);
      setUploading(false);
    }
  }, [open]);

  function pickFile() {
    inputRef.current?.click();
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setError(null);
    setResult(null);
    e.target.value = "";
  }

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch<InventoryImportResponse>(apiRoutes.inventoryImport, {
        method: "POST",
        body: form,
      });
      setResult(res);
      if (res.summary.created > 0 || res.summary.updated > 0) {
        onComplete();
        await toastSuccess(res.message);
      } else if (res.summary.errors > 0) {
        await showError("Import finished with errors", res.message);
      } else {
        await toastSuccess(res.message);
      }
    } catch (err) {
      setError(extractErrorMessage(err, "Import failed."));
    } finally {
      setUploading(false);
    }
  }

  const detectedEntries = result
    ? Object.entries(result.detected_columns)
    : [];

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Import products from Excel"
      panelClassName="inventory-modal--wide"
    >
      <header className="inventory-modal__head">
        <h2>Import from Excel</h2>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body inventory-import">
        <p className="app-muted inventory-import__lead">
          Upload an <strong>.xlsx</strong> export from Odoo (Inventory → Products →
          Actions → Export). We recognise common Odoo columns such as{" "}
          <code>Name</code>, <code>Internal Reference</code>, <code>Sales Price</code>,{" "}
          <code>Cost</code>, and <code>Quantity On Hand</code>.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="inventory-import__file-input"
          onChange={onFileChange}
        />

        <button
          type="button"
          className="inventory-import__dropzone"
          onClick={pickFile}
          disabled={uploading}
        >
          <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span className="app-muted">
                {(file.size / 1024).toFixed(1)} KB — click to choose a different file
              </span>
            </>
          ) : (
            <>
              <strong>Choose an Excel file</strong>
              <span className="app-muted">.xlsx only, up to 5 MB</span>
            </>
          )}
        </button>

        {error ? <p className="app-error">{error}</p> : null}

        {result ? (
          <div className="inventory-import__results">
            <div className="inventory-import__summary">
              <span className="inventory-import__stat">
                <strong>{result.summary.created}</strong> added
              </span>
              <span className="inventory-import__stat">
                <strong>{result.summary.updated}</strong> updated
              </span>
              {result.summary.skipped ? (
                <span className="inventory-import__stat">
                  <strong>{result.summary.skipped}</strong> skipped
                </span>
              ) : null}
              {result.summary.errors ? (
                <span className="inventory-import__stat inventory-import__stat--error">
                  <strong>{result.summary.errors}</strong> failed
                </span>
              ) : null}
            </div>

            {detectedEntries.length > 0 ? (
              <details className="inventory-import__columns">
                <summary>Columns detected ({detectedEntries.length})</summary>
                <ul>
                  {detectedEntries.map(([field, header]) => (
                    <li key={field}>
                      <code>{header}</code>
                      <span className="app-muted"> → {field.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {result.rows.some((row) => row.status === "error") ? (
              <ul className="inventory-import__errors">
                {result.rows
                  .filter((row) => row.status === "error")
                  .slice(0, 8)
                  .map((row) => (
                    <li key={row.row}>
                      Row {row.row}
                      {row.name ? `: ${row.name}` : ""} — {row.message}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="inventory-import__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!file || uploading || !!result}
            onClick={() => void handleImport()}
          >
            {uploading ? "Importing…" : "Import products"}
          </button>
        </div>
      </div>
    </MotionModal>
  );
}

function SearchView({
  query,
  setQuery,
  results,
  searching,
  existingProductIds,
  onPick,
  onSwitchToCreate,
}: {
  query: string;
  setQuery: (q: string) => void;
  results: CatalogProduct[];
  searching: boolean;
  existingProductIds: Set<string>;
  onPick: (p: CatalogProduct) => void;
  onSwitchToCreate: () => void;
}) {
  return (
    <>
      <label className="inventory-modal__search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search catalog (name, code, brand, SKU)…"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          autoFocus
        />
      </label>

      {searching ? (
        <p className="app-muted">Searching…</p>
      ) : results.length === 0 ? (
        <div className="inventory-empty inventory-empty--small">
          <p>
            No catalog matches{query ? ` for "${query}"` : ""}. Be the first to
            add it.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSwitchToCreate}
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            Create new product
          </button>
        </div>
      ) : (
        <ul className="inventory-catalog-list">
          {results.map((p) => {
            const inInventory = existingProductIds.has(p.id);
            const cat = getCategory(p.category);
            return (
              <li key={p.id}>
                <div className="inventory-catalog-info">
                  <strong>
                    {p.name}
                    {p.product_code ? (
                      <span className="inventory-code-tag">{p.product_code}</span>
                    ) : null}
                  </strong>
                  <span className="app-muted">
                    {p.brand ? `${p.brand} · ` : ""}
                    {cat?.label ?? "Uncategorised"}
                    {typeof p.shops_carrying_count === "number"
                      ? ` · in ${p.shops_carrying_count} shop${p.shops_carrying_count === 1 ? "" : "s"}`
                      : null}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={inInventory}
                  onClick={() => onPick(p)}
                >
                  {inInventory ? "Already added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

type CreateDraft = {
  product_type: ProductType;
  category: string;
  name: string;
  brand: string;
  unit: string;
  sku: string;
  product_code: string;
  image_url: string;
  description: string;
  attributes: Record<string, unknown>;
};

function emptyDraft(): CreateDraft {
  return {
    product_type: "product",
    category: "",
    name: "",
    brand: "",
    unit: "",
    sku: "",
    product_code: "",
    image_url: "",
    description: "",
    attributes: {},
  };
}

function CreateView({
  onCreated,
  onCancel,
  fillSeed,
}: {
  onCreated: (p: CatalogProduct) => void;
  onCancel: () => void;
  /** When this number changes (and is > 0) replace the draft with a random sample. */
  fillSeed: number;
}) {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  // Track the last auto-generated description so we know whether the user has
  // edited it manually; if they have, we stop overwriting their text.
  const lastAuto = useRef<string>("");

  // Random-fill trigger: when the parent bumps `fillSeed`, drop in a fresh
  // sample. We compare against the current draft name to avoid picking the
  // same one twice in a row.
  useEffect(() => {
    if (fillSeed <= 0) return;
    // Service type is hidden for now — only seed product-typed samples.
    let sample = pickRandomSample(draft.name);
    let guard = 8;
    while (sample.product_type !== "product" && guard-- > 0) {
      sample = pickRandomSample(sample.name);
    }
    lastAuto.current = ""; // force the description effect to refresh.
    setDraft({
      product_type: "product",
      category: sample.product_type === "product" ? sample.category : "",
      name: sample.name,
      brand: sample.brand ?? "",
      unit: sample.unit ?? "",
      sku: sample.sku ?? "",
      product_code: "",
      image_url: "",
      description: "",
      attributes: sample.product_type === "product" ? { ...sample.attributes } : {},
    });
    // We intentionally don't depend on `draft.name` — that would re-fire the
    // effect every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillSeed]);

  const availableCats = useMemo(
    () => categoriesFor("product"),
    [],
  );
  const cat = getCategory(draft.category);

  // Whenever inputs that feed the auto-description change, refresh it — but
  // only if the user hasn't typed over the previous auto-text.
  useEffect(() => {
    const next = buildAutoDescription({
      name: draft.name,
      brand: draft.brand,
      product_type: draft.product_type,
      category: draft.category,
      attributes: draft.attributes,
    });
    setDraft((prev) => {
      if (prev.description === "" || prev.description === lastAuto.current) {
        lastAuto.current = next;
        return { ...prev, description: next };
      }
      return prev;
    });
  }, [
    draft.name,
    draft.brand,
    draft.product_type,
    draft.category,
    draft.attributes,
  ]);

  function update<K extends keyof CreateDraft>(key: K, value: CreateDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function setAttr(key: string, value: unknown) {
    setDraft((prev) => ({
      ...prev,
      attributes: { ...prev.attributes, [key]: value },
    }));
  }

  function regenerateDescription() {
    const next = buildAutoDescription({
      name: draft.name,
      brand: draft.brand,
      product_type: draft.product_type,
      category: draft.category,
      attributes: draft.attributes,
    });
    lastAuto.current = next;
    setDraft((prev) => ({ ...prev, description: next }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data = await apiFetch<CatalogProductMutationResponse>(
        apiRoutes.products,
        {
          method: "POST",
          body: JSON.stringify({
            name: draft.name.trim(),
            product_type: "product",
            category: draft.category || null,
            brand: draft.brand.trim() || null,
            unit: draft.unit.trim() || null,
            sku: draft.sku.trim() || null,
            product_code: draft.product_code.trim() || null,
            image_url: draft.image_url.trim() || null,
            description: draft.description.trim() || null,
            attributes:
              Object.keys(draft.attributes).length > 0
                ? draft.attributes
                : null,
          }),
        },
      );
      await toastSuccess("Product added to catalog");
      onCreated(data.data);
    } catch (err) {
      await showError("Could not create product", extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="inventory-create-form" onSubmit={handleSubmit}>
      <p className="app-muted inventory-create-form__hint">
        Catalog entries are shared across every shop. The price and stock are
        per-shop — you'll set those after adding.
      </p>

      {/* Category dropdown */}
      <label className="settings-field">
        <span>Category</span>
        <select
          required
          value={draft.category}
          onChange={(e) => {
            update("category", e.target.value);
            update("attributes", {}); // reset per-category fields
          }}
        >
          <option value="" disabled>
            Choose a product category…
          </option>
          {availableCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {cat?.blurb ? (
          <small className="app-muted inventory-field-help">{cat.blurb}</small>
        ) : null}
      </label>

      {/* Common fields */}
      <div className="settings-form__row">
        <label className="settings-field">
          <span>Name *</span>
          <input
            type="text"
            required
            value={draft.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. Coca-Cola 500ml"
            maxLength={255}
          />
        </label>
        <label className="settings-field">
          <span>Brand (optional)</span>
          <input
            type="text"
            value={draft.brand}
            onChange={(e) => update("brand", e.target.value)}
            placeholder="e.g. Coca-Cola"
            maxLength={120}
          />
        </label>
      </div>

      {/* Category-specific dynamic fields (only after category picked) */}
      {cat && cat.fields.length > 0 ? (
        <fieldset className="inventory-attrs">
          <legend>
            <i className={`fa-solid ${cat.icon}`} aria-hidden="true" />
            {cat.label} details
          </legend>
          <div className="inventory-attrs__grid">
            {cat.fields.map((field) => {
              if (!isFieldVisible(field, draft.attributes)) return null;
              return (
                <AttrField
                  key={field.key}
                  field={field}
                  value={draft.attributes[field.key]}
                  onChange={(v) => setAttr(field.key, v)}
                />
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {/* Identification + media (always available, collapsible later if it gets long) */}
      <div className="settings-form__row">
        <label className="settings-field">
          <span>SKU / Barcode (optional)</span>
          <input
            type="text"
            value={draft.sku}
            onChange={(e) => update("sku", e.target.value)}
            placeholder="e.g. 5449000000996"
            maxLength={120}
          />
        </label>
        <label className="settings-field">
          <span>Product code (auto if blank)</span>
          <input
            type="text"
            value={draft.product_code}
            onChange={(e) => update("product_code", e.target.value)}
            placeholder="PRD-001234"
            maxLength={64}
          />
        </label>
      </div>

      <div className="settings-form__row">
        <label className="settings-field">
          <span>Unit (optional)</span>
          <input
            type="text"
            value={draft.unit}
            onChange={(e) => update("unit", e.target.value)}
            placeholder="pcs, kg, litre…"
            maxLength={32}
          />
        </label>
        <label className="settings-field">
          <span>Photo URL (optional)</span>
          <input
            type="url"
            value={draft.image_url}
            onChange={(e) => update("image_url", e.target.value)}
            placeholder="https://…"
            maxLength={1024}
          />
        </label>
      </div>

      {/* Description with autofill */}
      <label className="settings-field">
        <span className="inventory-desc-label">
          Description
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={regenerateDescription}
            disabled={!draft.category || !draft.name}
            title="Rebuild from the fields above"
          >
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
            Regenerate
          </button>
        </span>
        <textarea
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
          rows={5}
          placeholder="Describe the product, or fill in the fields above and we'll write a first draft for you."
          maxLength={4000}
        />
        <small className="app-muted inventory-field-help">
          We auto-fill this while it matches our draft. Type your own text any
          time and we'll stop touching it.
        </small>
      </label>

      <div className="settings-actions">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={submitting || !draft.name || !draft.category}
        >
          {submitting ? "Saving…" : "Add to catalog & my inventory"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Back to search
        </button>
      </div>
    </form>
  );
}

function AttrField({
  field,
  value,
  onChange,
}: {
  field: ProductCategoryField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `attr-${field.key}`;
  switch (field.type) {
    case "select":
      return (
        <label className="settings-field" htmlFor={id}>
          <span>{field.label}</span>
          <select
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">Select…</option>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {field.help ? <small className="app-muted">{field.help}</small> : null}
        </label>
      );
    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      function toggle(v: string) {
        const set = new Set(arr);
        if (set.has(v)) set.delete(v);
        else set.add(v);
        onChange(Array.from(set));
      }
      return (
        <div className="settings-field">
          <span>{field.label}</span>
          <div className="inventory-multiselect">
            {field.options?.map((o) => {
              const on = arr.includes(o.value);
              return (
                <button
                  type="button"
                  key={o.value}
                  className={`inventory-chip${on ? " is-active" : ""}`}
                  onClick={() => toggle(o.value)}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "number":
      return (
        <label className="settings-field" htmlFor={id}>
          <span>
            {field.label}
            {field.unit ? <em className="inventory-unit"> ({field.unit})</em> : null}
          </span>
          <input
            id={id}
            type="number"
            min={0}
            value={(value as number | string) ?? ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
            placeholder={field.placeholder}
          />
        </label>
      );
    case "textarea":
      return (
        <label className="settings-field settings-field--full" htmlFor={id}>
          <span>{field.label}</span>
          <textarea
            id={id}
            rows={2}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            maxLength={2000}
          />
        </label>
      );
    case "text":
    default:
      return (
        <label className="settings-field" htmlFor={id}>
          <span>
            {field.label}
            {field.unit ? <em className="inventory-unit"> ({field.unit})</em> : null}
          </span>
          <input
            id={id}
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        </label>
      );
  }
}
