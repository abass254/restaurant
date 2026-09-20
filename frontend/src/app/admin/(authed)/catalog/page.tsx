"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { Skeleton } from "@/components/app/Skeleton";
import type { AdminCatalogProductsResponse, CatalogProduct, MealAddon } from "@/lib/types";

export type ProductTypeFilter = "all" | "retail" | "meal" | "addon" | "service";

export type SortKey =
  | "name"
  | "code"
  | "type"
  | "category"
  | "brand"
  | "unit"
  | "qty"
  | "shops"
  | "image"
  | "status";

export type SortDirection = "asc" | "desc";
export type FilterTab = "all" | "active" | "disabled" | "missing" | "ready" | "in_shops";
export type ViewMode = "grid" | "table";

export type ColumnKey =
  | "image"
  | "code"
  | "type"
  | "category"
  | "brand"
  | "unit"
  | "qty"
  | "shops"
  | "image_status"
  | "status"
  | "actions";

const COLUMN_DEFINITIONS: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: "image", label: "Thumbnail", defaultVisible: true },
  { key: "code", label: "Barcode / SKU", defaultVisible: true },
  { key: "type", label: "Product Type", defaultVisible: true },
  { key: "category", label: "Category", defaultVisible: true },
  { key: "brand", label: "Brand", defaultVisible: true },
  { key: "unit", label: "Unit", defaultVisible: true },
  { key: "qty", label: "Total Stock Qty", defaultVisible: true },
  { key: "shops", label: "Shops Carrying", defaultVisible: true },
  { key: "image_status", label: "Image Status", defaultVisible: true },
  { key: "status", label: "Status (Active/Off)", defaultVisible: true },
  { key: "actions", label: "Actions", defaultVisible: true },
];

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  image: true,
  code: true,
  type: true,
  category: true,
  brand: true,
  unit: true,
  qty: true,
  shops: true,
  image_status: true,
  status: true,
  actions: true,
};

function canGenerateCatalogImage(product: CatalogProduct): boolean {
  return product.product_type !== "service" && !product.image_url;
}

function shopsLabel(count: number): string {
  return `${count} shop${count === 1 ? "" : "s"}`;
}

function imageStatus(product: CatalogProduct): {
  label: string;
  tone: "success" | "warning" | "muted";
} {
  if (product.image_url && product.primary_image_locked) {
    return { label: "Locked", tone: "success" };
  }
  if (product.image_url) {
    return { label: "Ready", tone: "success" };
  }
  return { label: "Missing", tone: "warning" };
}

async function generateCatalogImage(productId: string): Promise<CatalogProduct> {
  const res = await apiFetch<{ data: CatalogProduct; message: string }>(
    apiRoutes.adminCatalogGenerateImage(productId),
    { method: "POST", body: JSON.stringify({}) },
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

function compareProducts(
  a: CatalogProduct,
  b: CatalogProduct,
  key: SortKey,
  direction: SortDirection,
): number {
  let diff = 0;
  if (key === "name") {
    diff = (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    if (diff === 0) {
      diff = (a.brand || "").localeCompare(b.brand || "", undefined, { sensitivity: "base" });
    }
  } else if (key === "code") {
    const codeA = (a.product_code || a.sku || "").trim();
    const codeB = (b.product_code || b.sku || "").trim();
    if (!codeA && codeB) return 1;
    if (codeA && !codeB) return -1;
    diff = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: "base" });
  } else if (key === "type") {
    diff = (a.product_type || "").localeCompare(b.product_type || "");
  } else if (key === "category") {
    diff = (a.category || "").localeCompare(b.category || "");
  } else if (key === "brand") {
    diff = (a.brand || "").localeCompare(b.brand || "");
  } else if (key === "unit") {
    diff = (a.unit || "").localeCompare(b.unit || "");
  } else if (key === "qty") {
    const qtyA = a.total_quantity ?? 0;
    const qtyB = b.total_quantity ?? 0;
    diff = qtyA - qtyB;
  } else if (key === "shops") {
    const countA = a.shops_carrying_count ?? 0;
    const countB = b.shops_carrying_count ?? 0;
    diff = countA - countB;
  } else if (key === "image") {
    const scoreA = a.image_url ? (a.primary_image_locked ? 2 : 1) : 0;
    const scoreB = b.image_url ? (b.primary_image_locked ? 2 : 1) : 0;
    diff = scoreA - scoreB;
  } else if (key === "status") {
    const statusA = a.is_active !== false ? 1 : 0;
    const statusB = b.is_active !== false ? 1 : 0;
    diff = statusA - statusB;
  }
  return direction === "asc" ? diff : -diff;
}

function SortIcon({
  columnKey,
  activeKey,
  direction,
}: {
  columnKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
}) {
  if (columnKey !== activeKey) {
    return (
      <span className="admin-sort-indicator" aria-hidden="true">
        ⇅
      </span>
    );
  }
  return (
    <span className="admin-sort-indicator is-active" aria-hidden="true">
      {direction === "asc" ? "↑" : "↓"}
    </span>
  );
}

export default function AdminCatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>("all");
  const [activeMealForAddons, setActiveMealForAddons] = useState<CatalogProduct | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [previewProduct, setPreviewProduct] = useState<CatalogProduct | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Column Visibility state with localStorage
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(DEFAULT_COLUMNS);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef<HTMLDivElement | null>(null);

  // Row selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<Set<string>>(() => new Set());
  const [bulkStatusBusy, setBulkStatusBusy] = useState(false);

  // Load saved column visibility
  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin_catalog_columns");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === "object" && parsed !== null) {
          setColumns((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      // fallback to defaults
    }
  }, []);

  // Close column picker on outside click
  useEffect(() => {
    if (!colPickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setColPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [colPickerOpen]);

  const toggleColumn = (key: ColumnKey) => {
    setColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("admin_catalog_columns", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const setAllColumns = (val: boolean) => {
    const next: Record<ColumnKey, boolean> = {
      image: val,
      code: val,
      type: val,
      category: val,
      brand: val,
      unit: val,
      qty: val,
      shops: val,
      image_status: val,
      status: true, // keep status visible
      actions: true, // keep actions visible
    };
    setColumns(next);
    try {
      localStorage.setItem("admin_catalog_columns", JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const resetDefaultColumns = () => {
    setColumns(DEFAULT_COLUMNS);
    try {
      localStorage.setItem("admin_catalog_columns", JSON.stringify(DEFAULT_COLUMNS));
    } catch {
      // ignore
    }
  };

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const url = q?.trim()
        ? `${apiRoutes.adminCatalogProducts}?q=${encodeURIComponent(q.trim())}`
        : apiRoutes.adminCatalogProducts;
      const res = await apiFetch<AdminCatalogProductsResponse>(url);
      setProducts(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!previewProduct) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewProduct(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewProduct]);

  const missingImageProducts = useMemo(
    () => products.filter(canGenerateCatalogImage),
    [products],
  );

  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.is_active !== false).length;
    const disabled = products.filter((p) => p.is_active === false).length;
    const missing = products.filter(canGenerateCatalogImage).length;
    const ready = products.filter((p) => Boolean(p.image_url)).length;
    const inShops = products.filter((p) => (p.shops_carrying_count ?? 0) > 0).length;
    const totalQty = products.reduce((acc, p) => acc + (p.total_quantity ?? 0), 0);
    const pctReady = total > 0 ? Math.round((ready / total) * 100) : 0;
    const retailCount = products.filter((p) => p.product_type === "retail" || p.product_type === "product").length;
    const mealCount = products.filter((p) => p.product_type === "meal").length;
    const addonCount = products.filter((p) => p.product_type === "addon").length;
    const serviceCount = products.filter((p) => p.product_type === "service").length;
    return { total, active, disabled, missing, ready, inShops, totalQty, pctReady, retailCount, mealCount, addonCount, serviceCount };
  }, [products]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(
        key === "shops" || key === "qty" || key === "status" ? "desc" : "asc",
      );
    }
  }, [sortKey]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      if (typeFilter === "retail" && product.product_type !== "retail" && product.product_type !== "product") return false;
      if (typeFilter === "meal" && product.product_type !== "meal") return false;
      if (typeFilter === "addon" && product.product_type !== "addon") return false;
      if (typeFilter === "service" && product.product_type !== "service") return false;

      if (filterTab === "active") return product.is_active !== false;
      if (filterTab === "disabled") return product.is_active === false;
      if (filterTab === "missing") return canGenerateCatalogImage(product);
      if (filterTab === "ready") return Boolean(product.image_url);
      if (filterTab === "in_shops") return (product.shops_carrying_count ?? 0) > 0;
      return true;
    });
  }, [products, filterTab, typeFilter]);

  const handleMealUpdated = useCallback((updatedMeal: CatalogProduct) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === updatedMeal.id ? updatedMeal : p))
    );
    setActiveMealForAddons((curr) => (curr?.id === updatedMeal.id ? updatedMeal : curr));
  }, []);

  const displayedProducts = useMemo(() => {
    const list = [...filteredProducts];
    list.sort((a, b) => compareProducts(a, b, sortKey, sortDirection));
    return list;
  }, [filteredProducts, sortKey, sortDirection]);

  async function handleCopyCode(code: string, event?: React.MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((curr) => (curr === code ? null : curr)), 1800);
      await toastSuccess(`Copied "${code}" to clipboard`);
    } catch {
      // fallback
    }
  }

  function markGenerating(id: string, on: boolean) {
    setGeneratingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Toggle single product status (active/disabled)
  async function handleToggleStatus(product: CatalogProduct, event?: React.ChangeEvent<HTMLInputElement> | React.MouseEvent) {
    event?.stopPropagation();
    const targetStatus = !(product.is_active !== false);

    setStatusUpdatingIds((prev) => new Set(prev).add(product.id));
    // Optimistic update
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, is_active: targetStatus } : p)),
    );

    try {
      const res = await apiFetch<{ data: CatalogProduct; message: string }>(
        apiRoutes.adminCatalogProduct(product.id),
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: targetStatus }),
        },
      );
      await toastSuccess(res.message);
    } catch (err) {
      // Revert on error
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, is_active: !targetStatus } : p)),
      );
      await showError("Failed to update product status", extractErrorMessage(err));
    } finally {
      setStatusUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  }

  // Bulk status update
  async function handleBulkStatus(active: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBulkStatusBusy(true);
    // Optimistic update
    setProducts((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, is_active: active } : p)),
    );

    try {
      const res = await apiFetch<{ message: string; count: number }>(
        apiRoutes.adminCatalogBulkStatus,
        {
          method: "POST",
          body: JSON.stringify({ product_ids: ids, is_active: active }),
        },
      );
      await toastSuccess(res.message);
      setSelectedIds(new Set());
    } catch (err) {
      void load(query);
      await showError("Bulk update failed", extractErrorMessage(err));
    } finally {
      setBulkStatusBusy(false);
    }
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedProducts.length && displayedProducts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedProducts.map((p) => p.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function handleGenerateOne(product: CatalogProduct) {
    if (!canGenerateCatalogImage(product) || generatingIds.has(product.id)) return;
    markGenerating(product.id, true);
    try {
      const updated = await generateCatalogImage(product.id);
      setProducts((prev) =>
        prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
      );
      await toastSuccess(`AI image ready for "${updated.name}"`);
    } catch (err) {
      await showError("Could not generate image", extractErrorMessage(err));
    } finally {
      markGenerating(product.id, false);
    }
  }

  async function handleGenerateMissing() {
    const targets = products.filter(canGenerateCatalogImage);
    if (targets.length === 0) {
      await showError(
        "Nothing to generate",
        "Every product in this list already has a primary image (or is a service).",
      );
      return;
    }

    if (targets.length > 3) {
      const confirmed = await confirmAction(
        "Generate missing AI images?",
        `This will generate images for ${targets.length} products without a primary image. Each one can take up to a minute.`,
        "Generate",
      );
      if (!confirmed) return;
    }

    setBulkGenerating(true);
    let succeeded = 0;
    let failed = 0;

    await runWithConcurrency(targets, 2, async (product) => {
      markGenerating(product.id, true);
      try {
        const updated = await generateCatalogImage(product.id);
        setProducts((prev) =>
          prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
        );
        succeeded += 1;
      } catch {
        failed += 1;
      } finally {
        markGenerating(product.id, false);
      }
    });

    setBulkGenerating(false);

    if (failed === 0) {
      await toastSuccess(
        `Generated ${succeeded} image${succeeded === 1 ? "" : "s"}`,
      );
    } else if (succeeded > 0) {
      await showError(
        `Generated ${succeeded}, ${failed} failed`,
        "Check your AI provider settings and retry the ones that failed.",
      );
    } else {
      await showError(
        "Could not generate images",
        "Check your AI provider settings and try again.",
      );
    }
  }

  const visibleColumnsCount = useMemo(() => {
    return Object.values(columns).filter(Boolean).length;
  }, [columns]);

  return (
    <section className="admin-section">
      {/* Page Header */}
      <header className="admin-section__head" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <i className="fa-solid fa-boxes-stacked" style={{ color: "#0d9488" }} />
            Shared Platform Catalog
          </h1>
          <p className="admin-section__lead">
            Manage canonical catalog profiles, quantities, product types, enable/disable products, and assign primary photography.
          </p>
        </div>
        {missingImageProducts.length > 0 ? (
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={bulkGenerating || loading}
            onClick={() => void handleGenerateMissing()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              fontWeight: 700,
              boxShadow: "0 2px 8px rgba(13, 148, 136, 0.25)",
            }}
          >
            <i className={`fa-solid ${bulkGenerating ? "fa-spin fa-circle-notch" : "fa-wand-magic-sparkles"}`} />
            {bulkGenerating
              ? "Generating…"
              : `Generate Missing AI Images (${missingImageProducts.length})`}
          </button>
        ) : null}
      </header>

      {/* KPI Overview Stat Cards */}
      <div className="admin-stat-grid" style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          className={`admin-stat admin-stat--indigo admin-stat--clickable ${filterTab === "all" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("all")}
          title="Filter to all products"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-boxes-stacked" />
          </div>
          <div className="admin-stat__body">
            <span className="admin-stat__label">Total Catalog Items</span>
            <span className="admin-stat__value">
              {loading ? <Skeleton width={48} height={28} /> : stats.total}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`admin-stat admin-stat--emerald admin-stat--clickable ${filterTab === "active" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("active")}
          title="Filter to enabled/active products"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-circle-check" />
          </div>
          <div className="admin-stat__body">
            <span className="admin-stat__label">Active / Enabled</span>
            <span className="admin-stat__value" style={{ color: "#059669" }}>
              {loading ? <Skeleton width={48} height={28} /> : stats.active}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`admin-stat admin-stat--indigo admin-stat--clickable ${filterTab === "in_shops" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("in_shops")}
          title="Filter to products carried by merchant shops"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-cubes" />
          </div>
          <div className="admin-stat__body">
            <span className="admin-stat__label">Total Stock Quantity</span>
            <span className="admin-stat__value">
              {loading ? <Skeleton width={48} height={28} /> : stats.totalQty.toLocaleString()}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`admin-stat admin-stat--amber admin-stat--clickable ${filterTab === "missing" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("missing")}
          title="Filter to products needing images"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-triangle-exclamation" />
          </div>
          <div className="admin-stat__body">
            <span className="admin-stat__label">Missing Images</span>
            <span
              className="admin-stat__value"
              style={{ color: stats.missing > 0 ? "#b45309" : undefined }}
            >
              {loading ? <Skeleton width={48} height={28} /> : stats.missing}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`admin-stat admin-stat--emerald admin-stat--clickable ${filterTab === "ready" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("ready")}
          title="Filter to products with images ready"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-image" />
          </div>
          <div className="admin-stat__body">
            <span className="admin-stat__label">Images Ready</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.45rem" }}>
              <span className="admin-stat__value">
                {loading ? <Skeleton width={48} height={28} /> : stats.ready}
              </span>
              {!loading && (
                <span style={{ fontSize: "0.82rem", color: "#059669", fontWeight: 700 }}>
                  {stats.pctReady}%
                </span>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Catalogue Type Classification Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.45rem",
          flexWrap: "wrap",
          marginBottom: "1.1rem",
          padding: "0.45rem 0.65rem",
          background: "var(--color-surface, #fff)",
          border: "1px solid var(--color-border, #e8e2d8)",
          borderRadius: "12px",
        }}
      >
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-text-subtle)", padding: "0 0.35rem" }}>
          Catalogue:
        </span>
        <button
          type="button"
          className={`admin-catalog-tab-btn ${typeFilter === "all" ? "is-active" : ""}`}
          onClick={() => setTypeFilter("all")}
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", borderRadius: "8px" }}
        >
          <span>All Items</span>
          <span className="admin-catalog-tab-count">{stats.total}</span>
        </button>
        <button
          type="button"
          className={`admin-catalog-tab-btn ${typeFilter === "retail" ? "is-active" : ""}`}
          onClick={() => setTypeFilter("retail")}
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", borderRadius: "8px" }}
        >
          <i className="fa-solid fa-box" style={{ color: typeFilter === "retail" ? "#fff" : "#4338ca", fontSize: "0.78rem" }} />
          <span>Retail Products</span>
          <span className="admin-catalog-tab-count">{stats.retailCount}</span>
        </button>
        <button
          type="button"
          className={`admin-catalog-tab-btn ${typeFilter === "meal" ? "is-active" : ""}`}
          onClick={() => setTypeFilter("meal")}
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", borderRadius: "8px" }}
        >
          <i className="fa-solid fa-utensils" style={{ color: typeFilter === "meal" ? "#fff" : "#c2410c", fontSize: "0.78rem" }} />
          <span>Hotel Meals</span>
          <span className="admin-catalog-tab-count">{stats.mealCount}</span>
        </button>
        <button
          type="button"
          className={`admin-catalog-tab-btn ${typeFilter === "addon" ? "is-active" : ""}`}
          onClick={() => setTypeFilter("addon")}
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", borderRadius: "8px" }}
        >
          <i className="fa-solid fa-puzzle-piece" style={{ color: typeFilter === "addon" ? "#fff" : "#7c3aed", fontSize: "0.78rem" }} />
          <span>Add-ons & Modifiers</span>
          <span className="admin-catalog-tab-count">{stats.addonCount}</span>
        </button>
        <button
          type="button"
          className={`admin-catalog-tab-btn ${typeFilter === "service" ? "is-active" : ""}`}
          onClick={() => setTypeFilter("service")}
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", borderRadius: "8px" }}
        >
          <i className="fa-solid fa-hand-sparkles" style={{ color: typeFilter === "service" ? "#fff" : "#be185d", fontSize: "0.78rem" }} />
          <span>Services</span>
          <span className="admin-catalog-tab-count">{stats.serviceCount}</span>
        </button>
      </div>

      {/* Pro Toolbar matching Reference Screenshot */}
      <div className="admin-pro-toolbar">

        <div className="admin-pro-toolbar__left">
          {/* Filters Toggle Button */}
          <button
            type="button"
            className={`admin-filter-btn ${showFilters ? "is-active" : ""}`}
            onClick={() => setShowFilters((prev) => !prev)}
            title="Toggle quick filter tabs"
          >
            <i className="fa-solid fa-sliders" />
            <span>Filters</span>
          </button>

          {/* Search Box */}
          <form
            className="admin-pro-search-box"
            onSubmit={(e) => {
              e.preventDefault();
              void load(query);
            }}
          >
            <i className="fa-solid fa-magnifying-glass admin-pro-search-box__icon" />
            <input
              type="search"
              className="admin-pro-search-box__input"
              placeholder="Code, name, brand, category, SKU…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.trim() && (
              <button
                type="button"
                className="admin-catalog-search-box__clear"
                onClick={() => {
                  setQuery("");
                  void load("");
                }}
                title="Clear search"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </form>
        </div>

        <div className="admin-pro-toolbar__actions">
          {/* Enable/Disable Columns Picker */}
          <div className="admin-col-picker" ref={colPickerRef}>
            <button
              type="button"
              className={`admin-col-picker__btn ${colPickerOpen ? "is-active" : ""}`}
              onClick={() => setColPickerOpen((prev) => !prev)}
              title="Customize table columns"
            >
              <i className="fa-solid fa-table-columns" />
              <span>Columns</span>
              <span className="admin-col-picker__badge">
                {visibleColumnsCount}
              </span>
            </button>

            {colPickerOpen && (
              <div className="admin-col-picker__dropdown">
                <div className="admin-col-picker__header">
                  <span>Toggle Columns</span>
                  <div style={{ display: "flex", gap: "0.6rem" }}>
                    <button
                      type="button"
                      className="admin-col-picker__quick-btn"
                      onClick={() => setAllColumns(true)}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="admin-col-picker__quick-btn"
                      onClick={resetDefaultColumns}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className="admin-col-picker__list">
                  {COLUMN_DEFINITIONS.map((def) => (
                    <label key={def.key} className="admin-col-picker__item">
                      <input
                        type="checkbox"
                        checked={Boolean(columns[def.key])}
                        onChange={() => toggleColumn(def.key)}
                      />
                      <span>{def.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {missingImageProducts.length > 0 ? (
            <button
              type="button"
              className="admin-btn--pro-secondary"
              disabled={bulkGenerating || loading}
              onClick={() => void handleGenerateMissing()}
              title="Generate AI product photography"
            >
              <i className={`fa-solid ${bulkGenerating ? "fa-spin fa-circle-notch" : "fa-wand-magic-sparkles"}`} />
              <span>AI Images ({missingImageProducts.length})</span>
            </button>
          ) : null}

          {/* View Mode Switcher */}
          <div className="admin-view-switcher" role="group" aria-label="Catalog layout view">
            <button
              type="button"
              className={`admin-view-btn ${viewMode === "table" ? "is-active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Detailed Table View"
            >
              <i className="fa-solid fa-table-list" />
            </button>
            <button
              type="button"
              className={`admin-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Product Grid Cards View"
            >
              <i className="fa-solid fa-table-cells-large" />
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            className="admin-btn--pro-primary"
            onClick={() => void load(query)}
            disabled={loading}
            title="Refresh Catalog Products"
          >
            <i className={`fa-solid fa-arrows-rotate ${loading ? "fa-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Collapsible Filter Tabs / Pills */}
      {showFilters && (
        <div className="admin-catalog-tabs" style={{ marginBottom: "1.25rem", animation: "fadeIn 0.15s ease" }}>
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "all" ? "is-active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            <span>All</span>
            <span className="admin-catalog-tab-count">{stats.total}</span>
          </button>
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "active" ? "is-active" : ""}`}
            onClick={() => setFilterTab("active")}
          >
            <i
              className="fa-solid fa-circle-check"
              style={{ color: filterTab === "active" ? "#fff" : "#059669", fontSize: "0.8rem" }}
            />
            <span>Active</span>
            <span className="admin-catalog-tab-count">{stats.active}</span>
          </button>
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "disabled" ? "is-active" : ""}`}
            onClick={() => setFilterTab("disabled")}
          >
            <i
              className="fa-solid fa-ban"
              style={{ color: filterTab === "disabled" ? "#fff" : "#94a3b8", fontSize: "0.8rem" }}
            />
            <span>Disabled</span>
            <span className="admin-catalog-tab-count">{stats.disabled}</span>
          </button>
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "missing" ? "is-active" : ""}`}
            onClick={() => setFilterTab("missing")}
          >
            <i
              className="fa-solid fa-triangle-exclamation"
              style={{ color: filterTab === "missing" ? "#fff" : "#b45309", fontSize: "0.8rem" }}
            />
            <span>Missing Image</span>
            <span className="admin-catalog-tab-count">{stats.missing}</span>
          </button>
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "ready" ? "is-active" : ""}`}
            onClick={() => setFilterTab("ready")}
          >
            <i
              className="fa-solid fa-image"
              style={{ color: filterTab === "ready" ? "#fff" : "#059669", fontSize: "0.8rem" }}
            />
            <span>Images Ready</span>
            <span className="admin-catalog-tab-count">{stats.ready}</span>
          </button>
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "in_shops" ? "is-active" : ""}`}
            onClick={() => setFilterTab("in_shops")}
          >
            <i
              className="fa-solid fa-store"
              style={{ color: filterTab === "in_shops" ? "#fff" : "#4338ca", fontSize: "0.8rem" }}
            />
            <span>In Merchant Shops</span>
            <span className="admin-catalog-tab-count">{stats.inShops}</span>
          </button>
        </div>
      )}


      {/* Bulk Selection Floating Bar */}
      {selectedIds.size > 0 && (
        <div className="admin-catalog-bulk-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--color-text)" }}>
              {selectedIds.size} product{selectedIds.size === 1 ? "" : "s"} selected
            </span>
          </div>
          <div className="admin-catalog-bulk-bar__actions">
            <button
              type="button"
              className="admin-btn admin-btn--sm admin-btn--primary"
              disabled={bulkStatusBusy}
              onClick={() => void handleBulkStatus(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <i className="fa-solid fa-check" />
              <span>Enable Selected</span>
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--sm admin-btn--ghost"
              disabled={bulkStatusBusy}
              onClick={() => void handleBulkStatus(false)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#b91c1c" }}
            >
              <i className="fa-solid fa-ban" />
              <span>Disable Selected</span>
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--sm admin-btn--ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Active Sort & Summary Bar */}
      {!loading && displayedProducts.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "var(--color-text-subtle)",
          }}
        >
          <span>
            Showing <strong>{displayedProducts.length}</strong> of {stats.total} product{stats.total === 1 ? "" : "s"}
            {query.trim() ? ` matching "${query.trim()}"` : ""}
            {" · "}
            Sorted by{" "}
            <strong style={{ color: "var(--color-text)" }}>
              {sortKey === "name"
                ? `Product (${sortDirection === "asc" ? "A → Z" : "Z → A"})`
                : sortKey === "code"
                ? `Code / SKU (${sortDirection === "asc" ? "A → Z" : "Z → A"})`
                : sortKey === "type"
                ? `Type (${sortDirection === "asc" ? "A → Z" : "Z → A"})`
                : sortKey === "category"
                ? `Category (${sortDirection === "asc" ? "A → Z" : "Z → A"})`
                : sortKey === "brand"
                ? `Brand (${sortDirection === "asc" ? "A → Z" : "Z → A"})`
                : sortKey === "qty"
                ? `Stock Qty (${sortDirection === "desc" ? "Highest first" : "Lowest first"})`
                : sortKey === "shops"
                ? `Shops (${sortDirection === "desc" ? "Highest first" : "Lowest first"})`
                : sortKey === "status"
                ? `Status (${sortDirection === "desc" ? "Active first" : "Disabled first"})`
                : `Image (${sortDirection === "asc" ? "Missing first" : "Locked first"})`}
            </strong>
          </span>

          {(sortKey !== "name" || sortDirection !== "asc" || filterTab !== "all" || typeFilter !== "all" || query.trim()) && (
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ fontSize: "0.78rem", padding: "0.2rem 0.55rem" }}
              onClick={() => {
                setSortKey("name");
                setSortDirection("asc");
                setFilterTab("all");
                setTypeFilter("all");
                setQuery("");
                void load("");
              }}
              title="Reset search, filters and sort order"
            >
              <i className="fa-solid fa-arrows-rotate" aria-hidden="true" /> Reset filters & sort
            </button>
          )}
        </div>
      )}

      {/* Loading Skeleton State */}
      {loading ? (
        viewMode === "grid" ? (
          <div className="admin-catalog-cards-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="admin-catalog-card" style={{ pointerEvents: "none" }}>
                <Skeleton variant="rect" height={220} />
                <div className="admin-catalog-card__body">
                  <Skeleton width="85%" height={20} />
                  <Skeleton width="50%" height={16} />
                  <Skeleton width="40%" height={16} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-table-wrap--cards">
            <table className="admin-table--cards admin-table--catalog admin-table--skeleton">
              <thead>
                <tr>
                  <th className="admin-col-index">#</th>
                  <th>Code</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Brand</th>
                  <th>Unit</th>
                  <th>Stock Qty</th>
                  <th>Shops</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td className="admin-col-index">
                      <span className="admin-index-num">{i + 1}</span>
                    </td>
                    <td><Skeleton width={80} height={16} /></td>
                    <td>
                      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                        <Skeleton variant="rect" width={34} height={34} />
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <Skeleton width={180} height={16} />
                          <Skeleton width={100} height={13} />
                        </div>
                      </div>
                    </td>
                    <td><Skeleton width={60} height={20} /></td>
                    <td><Skeleton width={70} height={20} /></td>
                    <td><Skeleton width={60} height={16} /></td>
                    <td><Skeleton width={40} height={16} /></td>
                    <td><Skeleton width={50} height={20} /></td>
                    <td><Skeleton width={60} height={20} /></td>
                    <td><Skeleton width={70} height={22} /></td>
                    <td><Skeleton width={80} height={28} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : displayedProducts.length === 0 ? (
        /* Empty State */
        <div className="admin-catalog-empty">
          <div className="admin-catalog-empty__icon">
            <i className="fa-solid fa-box-open" />
          </div>
          <h3 className="admin-catalog-empty__title">No products found</h3>
          <p className="admin-catalog-empty__lead">
            {query.trim()
              ? `No catalog items matched your search query "${query.trim()}".`
              : filterTab === "disabled"
              ? "No disabled catalog products found. All products are currently active."
              : filterTab === "missing"
              ? "Great job! All products in the catalog currently have images assigned."
              : filterTab === "in_shops"
              ? "None of the products in the catalog are currently carried by merchant shops."
              : "There are no catalog products available at this time."}
          </p>
          {(query.trim() || filterTab !== "all") && (
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--sm"
              onClick={() => {
                setFilterTab("all");
                setQuery("");
                void load("");
              }}
            >
              <i className="fa-solid fa-arrows-rotate" />
              Reset filters & search
            </button>
          )}
        </div>
      ) : viewMode === "grid" ? (
        /* Visual Product Cards Grid View */
        <div className="admin-catalog-cards-grid">
          {displayedProducts.map((product) => {
            const canGenerate = canGenerateCatalogImage(product);
            const isGenerating = generatingIds.has(product.id);
            const shops = product.shops_carrying_count ?? 0;
            const status = imageStatus(product);
            const code = product.product_code || product.sku;
            const isActive = product.is_active !== false;

            return (
              <div
                key={product.id}
                className="admin-catalog-card"
                style={{ opacity: isActive ? 1 : 0.68 }}
              >
                {/* Media Image Box */}
                <div
                  className="admin-catalog-card__media-wrap"
                  onClick={() => product.image_url && setPreviewProduct(product)}
                >
                  {product.brand ? (
                    <span className="admin-catalog-card__badge-brand" title={product.brand}>
                      {product.brand}
                    </span>
                  ) : null}

                  <span
                    className={`admin-badge--product-type admin-badge--${product.product_type === "product" ? "retail" : product.product_type} admin-catalog-card__badge-type`}
                    title={`Type: ${product.product_type}`}
                  >
                    <i
                      className={`fa-solid ${
                        product.product_type === "meal"
                          ? "fa-utensils"
                          : product.product_type === "addon"
                          ? "fa-puzzle-piece"
                          : product.product_type === "service"
                          ? "fa-hand-sparkles"
                          : "fa-box"
                      }`}
                    />
                    <span>
                      {product.product_type === "meal"
                        ? "Meal"
                        : product.product_type === "addon"
                        ? "Add-on"
                        : product.product_type === "service"
                        ? "Service"
                        : "Retail"}
                    </span>
                  </span>

                  {product.image_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveAssetUrl(product.image_url)}
                        alt={product.name}
                        className="admin-catalog-card__img"
                        loading="lazy"
                      />
                      <span className="admin-catalog-card__zoom-hint" title="Click to view high-res image">
                        <i className="fa-solid fa-magnifying-glass-plus" />
                      </span>
                    </>
                  ) : (
                    <div className="admin-catalog-card__empty-icon">
                      <i className="fa-solid fa-image" />
                      <span className="admin-catalog-card__empty-text">No image</span>
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div className="admin-catalog-card__body">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <h3 className="admin-catalog-card__title">
                      <Link
                        href={`/admin/catalog/${product.id}`}
                        className="admin-catalog-card__title-link"
                        title={product.name}
                      >
                        {product.name}
                      </Link>
                    </h3>

                    {/* Active/Disable Quick Toggle */}
                    <div
                      className="admin-status-toggle"
                      onClick={(e) => e.stopPropagation()}
                      title={isActive ? "Product enabled" : "Product disabled"}
                    >
                      <label className="admin-switch">
                        <input
                          type="checkbox"
                          checked={isActive}
                          disabled={statusUpdatingIds.has(product.id)}
                          onChange={(e) => void handleToggleStatus(product, e)}
                        />
                        <span className="admin-switch__track" />
                      </label>
                    </div>
                  </div>

                  <div className="admin-catalog-card__meta-row" style={{ marginTop: "0.4rem" }}>
                    {code ? (
                      <button
                        type="button"
                        className="admin-catalog-card__code-chip"
                        onClick={(e) => void handleCopyCode(code, e)}
                        title="Click to copy barcode / SKU"
                      >
                        <i className={`fa-solid ${copiedCode === code ? "fa-check" : "fa-barcode"}`} />
                        <span>{code}</span>
                      </button>
                    ) : (
                      <span style={{ fontSize: "0.76rem", color: "var(--color-text-subtle)" }}>No code</span>
                    )}

                    {product.product_type === "meal" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveMealForAddons(product);
                        }}
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        style={{ padding: "0.15rem 0.5rem", fontSize: "0.72rem", height: "auto" }}
                        title="Manage add-ons linked to this meal"
                      >
                        <i className="fa-solid fa-puzzle-piece" style={{ marginRight: "0.25rem", color: "#7c3aed" }} />
                        <span>
                          {product.addons?.length
                            ? `${product.addons.length} Add-on${product.addons.length === 1 ? "" : "s"}`
                            : "+ Add-ons"}
                        </span>
                      </button>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.78rem" }}>
                    <span
                      className={
                        shops > 0
                          ? "admin-pill admin-pill--neutral admin-catalog-card__shops-chip"
                          : "admin-pill admin-pill--muted admin-catalog-card__shops-chip"
                      }
                      title={`${shops} merchant store${shops === 1 ? "" : "s"} carry this item`}
                    >
                      <i className="fa-solid fa-store" style={{ fontSize: "0.72rem" }} />
                      <span>{shopsLabel(shops)}</span>
                    </span>

                    <span
                      className={`admin-qty-pill ${(product.total_quantity ?? 0) > 0 ? "is-in-stock" : "is-zero"}`}
                      title="Total aggregated on-hand stock across all shops"
                    >
                      <i className="fa-solid fa-boxes-stacked" />
                      <span>{product.total_quantity ?? 0} {product.unit || "units"}</span>
                    </span>
                  </div>

                  {product.category ? (
                    <div style={{ marginTop: "0.45rem" }}>
                      <span className="admin-category-tag" title={product.category}>
                        {product.category}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Card Actions Footer */}
                <div className="admin-catalog-card__footer">
                  {canGenerate ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={isGenerating || bulkGenerating}
                      onClick={() => void handleGenerateOne(product)}
                    >
                      {isGenerating ? (
                        <>
                          <i className="fa-solid fa-spin fa-circle-notch" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-wand-magic-sparkles" style={{ color: "#0d9488" }} />
                          Generate AI
                        </>
                      )}
                    </button>
                  ) : null}
                  <Link
                    href={`/admin/catalog/${product.id}`}
                    className="admin-btn admin-btn--primary admin-btn--sm"
                  >
                    <span>Manage</span>
                    <i className="fa-solid fa-arrow-right" style={{ fontSize: "0.75rem" }} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Comprehensive Table View with Configurable Columns */
        <div className="admin-table-wrap--cards">
          <table className="admin-table--cards admin-table--catalog">
            <thead>
              <tr>
                {/* Numbered Row Index & Bulk Selection Header (Unified) */}
                <th className="admin-col-index">
                  <div className={`admin-index-box${selectedIds.size > 0 ? " is-selected" : ""}`}>
                    <span className="admin-index-num">#</span>
                    <input
                      type="checkbox"
                      className="admin-index-check"
                      checked={
                        displayedProducts.length > 0 &&
                        selectedIds.size === displayedProducts.length
                      }
                      onChange={toggleSelectAll}
                      aria-label="Select all products on page"
                    />
                  </div>
                </th>

                {/* Code / SKU Column */}
                {columns.code && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "code" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "code"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("code")}
                      title={`Sort by Code / SKU (${
                        sortKey === "code" && sortDirection === "asc"
                          ? "Descending"
                          : "Ascending"
                      })`}
                    >
                      <span>Code</span>
                      <SortIcon
                        columnKey="code"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Product Name Column */}
                <th
                  className={`admin-table__th--sortable ${sortKey === "name" ? "is-active" : ""}`}
                  aria-sort={
                    sortKey === "name"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="admin-table__sort-btn"
                    onClick={() => handleSort("name")}
                    title={`Sort by Product name (${
                      sortKey === "name" && sortDirection === "asc" ? "Z to A" : "A to Z"
                    })`}
                  >
                    <span>Name</span>
                    <SortIcon
                      columnKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                    />
                  </button>
                </th>

                {/* Product Type Column */}
                {columns.type && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "type" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "type"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("type")}
                      title="Sort by Type"
                    >
                      <span>Type</span>
                      <SortIcon
                        columnKey="type"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Category Column */}
                {columns.category && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "category" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "category"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("category")}
                      title="Sort by Category"
                    >
                      <span>Category</span>
                      <SortIcon
                        columnKey="category"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Brand Column */}
                {columns.brand && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "brand" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "brand"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("brand")}
                      title="Sort by Brand"
                    >
                      <span>Brand</span>
                      <SortIcon
                        columnKey="brand"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Unit Column */}
                {columns.unit && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "unit" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "unit"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("unit")}
                      title="Sort by Unit"
                    >
                      <span>Unit</span>
                      <SortIcon
                        columnKey="unit"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Total Stock Qty Column */}
                {columns.qty && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "qty" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "qty"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("qty")}
                      title="Sort by Total Stock Quantity"
                    >
                      <span>Total Qty</span>
                      <SortIcon
                        columnKey="qty"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Shops Carrying Column */}
                {columns.shops && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "shops" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "shops"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("shops")}
                      title={`Sort by Shops carrying (${
                        sortKey === "shops" && sortDirection === "desc"
                          ? "Lowest first"
                          : "Highest first"
                      })`}
                    >
                      <span>Shops</span>
                      <SortIcon
                        columnKey="shops"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Image Status Column */}
                {columns.image_status && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "image" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "image"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("image")}
                      title={`Sort by Image status (${
                        sortKey === "image" && sortDirection === "asc"
                          ? "Locked/Ready first"
                          : "Missing first"
                      })`}
                    >
                      <span>Image</span>
                      <SortIcon
                        columnKey="image"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Product Active / Disabled Status Column */}
                {columns.status && (
                  <th
                    className={`admin-table__th--sortable ${sortKey === "status" ? "is-active" : ""}`}
                    aria-sort={
                      sortKey === "status"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="admin-table__sort-btn"
                      onClick={() => handleSort("status")}
                      title="Sort by Active / Disabled status"
                    >
                      <span>Status</span>
                      <SortIcon
                        columnKey="status"
                        activeKey={sortKey}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                )}

                {/* Actions Header */}
                {columns.actions && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {displayedProducts.map((product, index) => {
                const canGenerate = canGenerateCatalogImage(product);
                const isGenerating = generatingIds.has(product.id);
                const shops = product.shops_carrying_count ?? 0;
                const status = imageStatus(product);
                const code = product.product_code || product.sku;
                const isActive = product.is_active !== false;
                const isSelected = selectedIds.has(product.id);
                const isUpdatingStatus = statusUpdatingIds.has(product.id);

                return (
                  <tr
                    key={product.id}
                    style={{
                      backgroundColor: isSelected
                        ? "rgba(37, 99, 235, 0.05)"
                        : undefined,
                      opacity: isActive ? 1 : 0.65,
                    }}
                  >
                    {/* Numbered Index with hover / selection checkbox */}
                    <td className="admin-col-index">
                      <div className={`admin-index-box${isSelected ? " is-selected" : ""}`}>
                        <span className="admin-index-num">{index + 1}</span>
                        <input
                          type="checkbox"
                          className="admin-index-check"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(product.id)}
                          aria-label={`Select ${product.name}`}
                        />
                      </div>
                    </td>

                    {/* Code / SKU */}
                    {columns.code && (
                      <td className="admin-cell-code">
                        {code ? (
                          <button
                            type="button"
                            className="admin-catalog-code-btn"
                            onClick={(e) => void handleCopyCode(code, e)}
                            title="Click to copy barcode / SKU"
                          >
                            <span>{code}</span>
                            <i className={`fa-solid ${copiedCode === code ? "fa-check" : "fa-copy"}`} style={{ fontSize: "0.68rem", opacity: 0.5 }} />
                          </button>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                    )}

                    {/* Product Name with inline Thumbnail and subtitle */}
                    <td className="admin-cell-name">
                      <div className="admin-product-cell-wrap">
                        {columns.image && (
                          product.image_url ? (
                            <div
                              className="admin-product-thumb-wrap"
                              onClick={() => setPreviewProduct(product)}
                              title="Click to preview image"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={resolveAssetUrl(product.image_url)}
                                alt=""
                                className="admin-product-thumb"
                              />
                            </div>
                          ) : (
                            <div className="admin-product-thumb-wrap admin-product-thumb-wrap--empty">
                              <i className="fa-solid fa-box" />
                            </div>
                          )
                        )}
                        <div className="admin-product-cell-text">
                          <Link
                            href={`/admin/catalog/${product.id}`}
                            className="admin-product-title"
                          >
                            <strong>{product.name}</strong>
                          </Link>
                          <span className="admin-product-sub">
                            {product.category || product.brand || product.description || "General item"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Type (Retail / Meal / Add-on / Service) */}
                    {columns.type && (
                      <td className="admin-cell-text">
                        <span
                          className={`admin-badge--product-type admin-badge--${product.product_type === "product" ? "retail" : product.product_type}`}
                          title={`Type: ${product.product_type}`}
                        >
                          <i
                            className={`fa-solid ${
                              product.product_type === "meal"
                                ? "fa-utensils"
                                : product.product_type === "addon"
                                ? "fa-puzzle-piece"
                                : product.product_type === "service"
                                ? "fa-hand-sparkles"
                                : "fa-box"
                            }`}
                          />
                          <span>
                            {product.product_type === "meal"
                              ? "Meal"
                              : product.product_type === "addon"
                              ? "Add-on"
                              : product.product_type === "service"
                              ? "Service"
                              : "Retail"}
                          </span>
                        </span>

                        {product.product_type === "meal" && (
                          <div style={{ marginTop: "0.25rem" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMealForAddons(product);
                              }}
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              style={{ padding: "0.15rem 0.45rem", fontSize: "0.72rem", height: "auto" }}
                              title="Manage add-ons linked to this meal"
                            >
                              <i className="fa-solid fa-puzzle-piece" style={{ marginRight: "0.25rem", color: "#7c3aed" }} />
                              <span>
                                {product.addons?.length
                                  ? `${product.addons.length} Add-on${product.addons.length === 1 ? "" : "s"}`
                                  : "+ Add-ons"}
                              </span>
                            </button>
                          </div>
                        )}
                      </td>
                    )}

                    {/* Category */}
                    {columns.category && (
                      <td className="admin-cell-text">
                        <span>{product.category || "—"}</span>
                      </td>
                    )}

                    {/* Brand */}
                    {columns.brand && (
                      <td className="admin-cell-text">
                        <span>{product.brand || "—"}</span>
                      </td>
                    )}

                    {/* Unit */}
                    {columns.unit && (
                      <td className="admin-cell-text">
                        <span>{product.unit || "Piece"}</span>
                      </td>
                    )}

                    {/* Total Stock Qty */}
                    {columns.qty && (
                      <td className="admin-cell-qty">
                        <span>{(product.total_quantity ?? 0).toLocaleString()}</span>
                      </td>
                    )}

                    {/* Shops Carrying */}
                    {columns.shops && (
                      <td className="admin-cell-shops">
                        <span>{shops}</span>
                      </td>
                    )}

                    {/* Image Status */}
                    {columns.image_status && (
                      <td className="admin-cell-text">
                        <span className={`admin-pill admin-pill--${status.tone}`}>
                          {status.label}
                        </span>
                      </td>
                    )}

                    {/* Status (Active / Disabled Toggle) */}
                    {columns.status && (
                      <td className="admin-cell-status">
                        <div
                          className="admin-status-toggle"
                          style={{ justifyContent: "center" }}
                          title={isActive ? "Product operational (active)" : "Product disabled"}
                        >
                          <label className="admin-switch">
                            <input
                              type="checkbox"
                              checked={isActive}
                              disabled={isUpdatingStatus}
                              onChange={(e) => void handleToggleStatus(product, e)}
                            />
                            <span className="admin-switch__track" />
                          </label>
                          <span
                            style={{
                              fontSize: "0.82rem",
                              fontWeight: 600,
                              color: isActive ? "#0f172a" : "#94a3b8",
                            }}
                          >
                            {isActive ? "Operational" : "Disabled"}
                          </span>
                        </div>
                      </td>
                    )}

                    {/* Row Actions */}
                    {columns.actions && (
                      <td className="admin-cell-actions">
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          {canGenerate ? (
                            <button
                              type="button"
                              className="admin-btn--pro-secondary"
                              style={{ padding: "0.32rem 0.55rem", fontSize: "0.76rem" }}
                              disabled={isGenerating || bulkGenerating}
                              onClick={() => void handleGenerateOne(product)}
                              title="Generate AI photo"
                            >
                              <i className="fa-solid fa-wand-magic-sparkles" style={{ color: "#0d9488" }} />
                            </button>
                          ) : null}
                          <Link
                            href={`/admin/catalog/${product.id}`}
                            className="admin-btn--pro-secondary"
                            style={{ padding: "0.32rem 0.65rem", fontSize: "0.76rem" }}
                          >
                            <span>Manage</span>
                          </Link>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* High-Resolution Image Lightbox Modal */}
      {previewProduct && previewProduct.image_url ? (
        <div
          className="admin-catalog-lightbox-backdrop"
          onClick={() => setPreviewProduct(null)}
        >
          <div
            className="admin-catalog-lightbox-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-catalog-lightbox-modal__header">
              <div>
                <strong style={{ fontSize: "1rem", color: "var(--color-text)" }}>
                  {previewProduct.name}
                </strong>
                {previewProduct.brand ? (
                  <div style={{ fontSize: "0.78rem", color: "var(--color-text-subtle)", marginTop: "0.15rem" }}>
                    {previewProduct.brand} {previewProduct.unit ? `· ${previewProduct.unit}` : ""}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setPreviewProduct(null)}
                style={{ padding: "0.3rem 0.5rem" }}
                title="Close preview (Esc)"
              >
                <i className="fa-solid fa-xmark" style={{ fontSize: "1.1rem" }} />
              </button>
            </div>

            <div className="admin-catalog-lightbox-modal__img-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAssetUrl(previewProduct.image_url)}
                alt={previewProduct.name}
                className="admin-catalog-lightbox-modal__img"
              />
            </div>

            <div className="admin-catalog-lightbox-modal__footer">
              <div style={{ fontSize: "0.82rem", color: "var(--color-text-subtle)" }}>
                Status: <strong>{imageStatus(previewProduct).label}</strong> · {shopsLabel(previewProduct.shops_carrying_count ?? 0)} · Stock: <strong>{previewProduct.total_quantity ?? 0}</strong>
              </div>
              <Link
                href={`/admin/catalog/${previewProduct.id}`}
                className="admin-btn admin-btn--primary admin-btn--sm"
                onClick={() => setPreviewProduct(null)}
              >
                <span>Edit Product Details</span>
                <i className="fa-solid fa-arrow-right" />
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* Meal Addons Management Modal */}
      {activeMealForAddons && (
        <MealAddonsModal
          meal={activeMealForAddons}
          allProducts={products}
          onClose={() => setActiveMealForAddons(null)}
          onUpdated={handleMealUpdated}
        />
      )}
    </section>
  );
}

function MealAddonsModal({
  meal,
  allProducts,
  onClose,
  onUpdated,
}: {
  meal: CatalogProduct;
  allProducts: CatalogProduct[];
  onClose: () => void;
  onUpdated: (updatedMeal: CatalogProduct) => void;
}) {
  const [addons, setAddons] = useState<MealAddon[]>(meal.addons ?? []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  // New link form state
  const [selectedAddonId, setSelectedAddonId] = useState<string>("");
  const [additionalPrice, setAdditionalPrice] = useState<string>("0");
  const [isDefault, setIsDefault] = useState<boolean>(false);
  const [isRequired, setIsRequired] = useState<boolean>(false);
  const [maxQuantity, setMaxQuantity] = useState<number>(1);
  const [sortOrder, setSortOrder] = useState<number>(0);

  const linkedAddonIds = useMemo(() => new Set(addons.map((a) => a.addon_id)), [addons]);
  const candidateAddons = useMemo(() => {
    return allProducts.filter((p) => p.id !== meal.id && !linkedAddonIds.has(p.id));
  }, [allProducts, meal.id, linkedAddonIds]);

  const fetchAddons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MealAddon[]>(apiRoutes.adminCatalogMealAddons(meal.id));
      setAddons(res);
      onUpdated({ ...meal, addons: res });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [meal, onUpdated]);

  useEffect(() => {
    void fetchAddons();
  }, [fetchAddons]);

  async function handleLinkAddon(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAddonId) return;
    setSaving(true);
    try {
      const payload = {
        addon_id: selectedAddonId,
        additional_price: additionalPrice ? parseFloat(additionalPrice) : 0,
        is_default: isDefault,
        is_required: isRequired,
        max_quantity: maxQuantity || 1,
        sort_order: sortOrder || 0,
      };
      await apiFetch<MealAddon>(apiRoutes.adminCatalogMealAddons(meal.id), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await toastSuccess("Add-on modifier linked to meal!");
      setSelectedAddonId("");
      setAdditionalPrice("0");
      setIsDefault(false);
      setIsRequired(false);
      void fetchAddons();
    } catch (err) {
      await showError("Failed to link add-on", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink(addonId: string, addonName?: string | null) {
    const ok = await confirmAction(
      "Unlink Add-on?",
      `Remove "${addonName || "this add-on"}" modifier from ${meal.name}?`,
      "Yes, Unlink",
    );
    if (!ok) return;

    setUnlinkingId(addonId);
    try {
      await apiFetch(apiRoutes.adminCatalogMealAddonItem(meal.id, addonId), {
        method: "DELETE",
      });
      await toastSuccess("Add-on unlinked successfully");
      void fetchAddons();
    } catch (err) {
      await showError("Failed to unlink add-on", extractErrorMessage(err));
    } finally {
      setUnlinkingId(null);
    }
  }

  return (
    <div className="admin-catalog-lightbox-backdrop" onClick={onClose}>
      <div className="admin-addons-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-addons-modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span
              className="admin-badge--product-type admin-badge--meal"
              style={{ fontSize: "0.76rem" }}
            >
              <i className="fa-solid fa-utensils" />
              <span>Meal</span>
            </span>
            <div>
              <strong style={{ fontSize: "1.05rem", color: "var(--color-text)" }}>
                {meal.name}
              </strong>
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-subtle)", marginTop: "0.1rem" }}>
                Add-ons & Modifiers ({addons.length})
              </div>
            </div>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={onClose}
            title="Close modal"
          >
            <i className="fa-solid fa-xmark" style={{ fontSize: "1.1rem" }} />
          </button>
        </div>

        <div className="admin-addons-modal__body">
          {/* Linked Addons List */}
          <div>
            <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: "0.6rem", color: "var(--color-text)" }}>
              Attached Add-ons & Modifiers
            </h3>
            {loading && addons.length === 0 ? (
              <div style={{ padding: "1.5rem", textAlign: "center" }}>
                <i className="fa-solid fa-circle-notch fa-spin" style={{ color: "#c2410c", fontSize: "1.2rem" }} />
                <p style={{ fontSize: "0.82rem", color: "var(--color-text-subtle)", marginTop: "0.4rem" }}>
                  Loading attached modifiers...
                </p>
              </div>
            ) : addons.length === 0 ? (
              <div
                style={{
                  padding: "1.5rem",
                  textAlign: "center",
                  border: "1px dashed var(--color-border, #e8e2d8)",
                  borderRadius: "10px",
                  background: "var(--color-surface-subtle, #fafafa)",
                }}
              >
                <i className="fa-solid fa-puzzle-piece" style={{ color: "var(--color-text-subtle)", fontSize: "1.5rem" }} />
                <p style={{ fontSize: "0.84rem", color: "var(--color-text-subtle)", marginTop: "0.5rem" }}>
                  No add-on modifiers linked to this meal yet.
                </p>
                <span style={{ fontSize: "0.76rem", color: "var(--color-text-muted)" }}>
                  Use the form below to attach toppings, sides, drinks, or options.
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {addons.map((a) => (
                  <div key={a.id} className="admin-addons-modal__item">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <span className="admin-badge--product-type admin-badge--addon" style={{ fontSize: "0.72rem" }}>
                        <i className="fa-solid fa-puzzle-piece" />
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-text)" }}>
                          {a.addon_name || "Add-on Item"}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.2rem", flexWrap: "wrap" }}>
                          {a.addon_code ? (
                            <span style={{ fontSize: "0.74rem", color: "var(--color-text-subtle)" }}>
                              Code: {a.addon_code}
                            </span>
                          ) : null}
                          <span
                            className="admin-pill"
                            style={{
                              fontSize: "0.72rem",
                              background: (a.additional_price ?? 0) > 0 ? "rgba(16, 185, 129, 0.12)" : "rgba(100, 116, 139, 0.12)",
                              color: (a.additional_price ?? 0) > 0 ? "#059669" : "#64748b",
                              fontWeight: 700,
                            }}
                          >
                            {(a.additional_price ?? 0) > 0 ? `+ KES ${Number(a.additional_price).toFixed(2)}` : "Free / Included"}
                          </span>
                          {a.is_default ? (
                            <span className="admin-pill admin-pill--emerald" style={{ fontSize: "0.7rem" }}>
                              Default
                            </span>
                          ) : null}
                          {a.is_required ? (
                            <span className="admin-pill admin-pill--amber" style={{ fontSize: "0.7rem" }}>
                              Required
                            </span>
                          ) : null}
                          {(a.max_quantity ?? 1) > 1 ? (
                            <span className="admin-pill admin-pill--neutral" style={{ fontSize: "0.7rem" }}>
                              Max: {a.max_quantity}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleUnlink(a.addon_id, a.addon_name)}
                      disabled={unlinkingId === a.addon_id}
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      style={{ color: "#ef4444", padding: "0.3rem 0.6rem" }}
                      title="Unlink this modifier from meal"
                    >
                      {unlinkingId === a.addon_id ? (
                        <i className="fa-solid fa-circle-notch fa-spin" />
                      ) : (
                        <i className="fa-solid fa-trash-can" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form to Link a New Addon */}
          <div
            style={{
              borderTop: "1px solid var(--color-border, #e8e2d8)",
              paddingTop: "1.1rem",
            }}
          >
            <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: "0.75rem", color: "var(--color-text)" }}>
              Attach New Add-on Modifier
            </h3>
            {candidateAddons.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--color-text-subtle)" }}>
                All catalogue items are already linked or no other items are available.
              </p>
            ) : (
              <form onSubmit={handleLinkAddon} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                    Select Catalogue Item to Link as Add-on:
                  </label>
                  <select
                    value={selectedAddonId}
                    onChange={(e) => setSelectedAddonId(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "0.55rem 0.75rem",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border, #cbd5e1)",
                      background: "var(--color-surface, #fff)",
                      color: "var(--color-text)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <option value="">-- Choose an item / modifier --</option>
                    {candidateAddons.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.product_code ? `(${p.product_code})` : ""} [{p.product_type.toUpperCase()}]
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                      Additional Price (KES):
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={additionalPrice}
                      onChange={(e) => setAdditionalPrice(e.target.value)}
                      placeholder="0.00"
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.65rem",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border, #cbd5e1)",
                        background: "var(--color-surface, #fff)",
                        color: "var(--color-text)",
                        fontSize: "0.85rem",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                      Max Quantity Allowed:
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={maxQuantity}
                      onChange={(e) => setMaxQuantity(parseInt(e.target.value, 10) || 1)}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.65rem",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border, #cbd5e1)",
                        background: "var(--color-surface, #fff)",
                        color: "var(--color-text)",
                        fontSize: "0.85rem",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", paddingTop: "0.2rem" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      style={{ accentColor: "#c2410c", width: "16px", height: "16px" }}
                    />
                    <span>Selected by default</span>
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isRequired}
                      onChange={(e) => setIsRequired(e.target.checked)}
                      style={{ accentColor: "#c2410c", width: "16px", height: "16px" }}
                    />
                    <span>Required modifier</span>
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                  <button
                    type="submit"
                    className="admin-btn admin-btn--primary"
                    disabled={!selectedAddonId || saving}
                    style={{ background: "#c2410c", borderColor: "#c2410c" }}
                  >
                    {saving ? (
                      <>
                        <i className="fa-solid fa-circle-notch fa-spin" style={{ marginRight: "0.4rem" }} />
                        Linking...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-link" style={{ marginRight: "0.4rem" }} />
                        Attach Modifier to Meal
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
