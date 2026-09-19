"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { Skeleton } from "@/components/app/Skeleton";
import type { AdminCatalogProductsResponse, CatalogProduct } from "@/lib/types";

type SortKey = "name" | "code" | "shops" | "image";
type SortDirection = "asc" | "desc";
type FilterTab = "all" | "missing" | "ready" | "in_shops";
type ViewMode = "grid" | "table";

function canGenerateCatalogImage(product: CatalogProduct): boolean {
  return product.product_type === "product" && !product.image_url;
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
  } else if (key === "shops") {
    const countA = a.shops_carrying_count ?? 0;
    const countB = b.shops_carrying_count ?? 0;
    diff = countA - countB;
  } else if (key === "image") {
    // missing (0) -> ready (1) -> locked (2)
    const scoreA = a.image_url ? (a.primary_image_locked ? 2 : 1) : 0;
    const scoreB = b.image_url ? (b.primary_image_locked ? 2 : 1) : 0;
    diff = scoreA - scoreB;
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
      <i
        className="fa-solid fa-sort admin-table__sort-icon"
        aria-hidden="true"
      />
    );
  }
  if (columnKey === "name") {
    return (
      <i
        className={`fa-solid ${
          direction === "asc" ? "fa-arrow-up-a-z" : "fa-arrow-down-z-a"
        } admin-table__sort-icon is-active`}
        aria-hidden="true"
      />
    );
  }
  if (columnKey === "code") {
    return (
      <i
        className={`fa-solid ${
          direction === "asc" ? "fa-arrow-up-1-9" : "fa-arrow-down-9-1"
        } admin-table__sort-icon is-active`}
        aria-hidden="true"
      />
    );
  }
  if (columnKey === "shops") {
    return (
      <i
        className={`fa-solid ${
          direction === "desc" ? "fa-arrow-down-wide-short" : "fa-arrow-up-wide-short"
        } admin-table__sort-icon is-active`}
        aria-hidden="true"
      />
    );
  }
  return (
    <i
      className={`fa-solid ${
        direction === "asc" ? "fa-sort-up" : "fa-sort-down"
      } admin-table__sort-icon is-active`}
      aria-hidden="true"
    />
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
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [previewProduct, setPreviewProduct] = useState<CatalogProduct | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

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
    const missing = products.filter(canGenerateCatalogImage).length;
    const ready = products.filter((p) => Boolean(p.image_url)).length;
    const inShops = products.filter((p) => (p.shops_carrying_count ?? 0) > 0).length;
    const pctReady = total > 0 ? Math.round((ready / total) * 100) : 0;
    return { total, missing, ready, inShops, pctReady };
  }, [products]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "shops" ? "desc" : "asc");
    }
  }, [sortKey]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      if (filterTab === "missing") return canGenerateCatalogImage(product);
      if (filterTab === "ready") return Boolean(product.image_url);
      if (filterTab === "in_shops") return (product.shops_carrying_count ?? 0) > 0;
      return true;
    });
  }, [products, filterTab]);

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

  return (
    <section className="admin-section">
      {/* Page Header */}
      <header className="admin-section__head" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <i className="fa-solid fa-boxes-stacked" style={{ color: "var(--color-primary)" }} />
            Shared Platform Catalog
          </h1>
          <p className="admin-section__lead">
            Manage canonical product profiles, assign primary photography from merchant uploads,
            or generate high-fidelity AI product imagery for shared retail items.
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
              boxShadow: "0 2px 8px rgba(107, 46, 20, 0.2)",
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
            <span className="admin-stat__label">Total Products</span>
            <span className="admin-stat__value">
              {loading ? <Skeleton width={48} height={28} /> : stats.total}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`admin-stat admin-stat--emerald admin-stat--clickable ${filterTab === "ready" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("ready")}
          title="Filter to products with images"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-circle-check" />
          </div>
          <div className="admin-stat__body" style={{ width: "100%" }}>
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
            {!loading && (
              <div className="admin-stat__progress-wrap">
                <div className="admin-stat__progress-bar">
                  <div
                    className="admin-stat__progress-fill"
                    style={{ width: `${stats.pctReady}%` }}
                  />
                </div>
              </div>
            )}
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
          className={`admin-stat admin-stat--indigo admin-stat--clickable ${filterTab === "in_shops" ? "is-selected" : ""}`}
          onClick={() => setFilterTab("in_shops")}
          title="Filter to products carried by merchant shops"
        >
          <div className="admin-stat__icon">
            <i className="fa-solid fa-store" />
          </div>
          <div className="admin-stat__body">
            <span className="admin-stat__label">In Merchant Shops</span>
            <span className="admin-stat__value">
              {loading ? <Skeleton width={48} height={28} /> : stats.inShops}
            </span>
          </div>
        </button>
      </div>

      {/* Search Bar & View Controls */}
      <div className="admin-catalog-bar">
        <div className="admin-catalog-bar__top">
          <form
            className="admin-catalog-search-box"
            onSubmit={(e) => {
              e.preventDefault();
              void load(query);
            }}
          >
            <i className="fa-solid fa-magnifying-glass admin-catalog-search-box__icon" />
            <input
              type="search"
              className="admin-input admin-catalog-search-box__input"
              placeholder="Search by product name, brand, barcode, SKU…"
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

          <div className="admin-catalog-actions-group">
            {/* View Mode Switcher */}
            <div className="admin-view-switcher" role="group" aria-label="Catalog layout view">
              <button
                type="button"
                className={`admin-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Product Grid Cards View"
              >
                <i className="fa-solid fa-table-cells-large" />
                <span>Grid</span>
              </button>
              <button
                type="button"
                className={`admin-view-btn ${viewMode === "table" ? "is-active" : ""}`}
                onClick={() => setViewMode("table")}
                title="Compact Table View"
              >
                <i className="fa-solid fa-table-list" />
                <span>Table</span>
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => void load(query)}
              disabled={loading}
              title="Refresh Catalog Products"
            >
              <i className={`fa-solid fa-arrows-rotate ${loading ? "fa-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Filter Tabs / Pills */}
        <div className="admin-catalog-tabs">
          <button
            type="button"
            className={`admin-catalog-tab-btn ${filterTab === "all" ? "is-active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            <span>All Products</span>
            <span className="admin-catalog-tab-count">{stats.total}</span>
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
              className="fa-solid fa-circle-check"
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
            <span>Carried in Shops</span>
            <span className="admin-catalog-tab-count">{stats.inShops}</span>
          </button>
        </div>
      </div>

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
                : sortKey === "shops"
                ? `Shops (${sortDirection === "desc" ? "Highest first" : "Lowest first"})`
                : `Image (${sortDirection === "asc" ? "Missing first" : "Locked first"})`}
            </strong>
          </span>

          {(sortKey !== "name" || sortDirection !== "asc" || filterTab !== "all" || query.trim()) && (
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ fontSize: "0.78rem", padding: "0.2rem 0.55rem" }}
              onClick={() => {
                setSortKey("name");
                setSortDirection("asc");
                setFilterTab("all");
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
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--catalog admin-table--skeleton">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Code</th>
                  <th>Shops</th>
                  <th>Image</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                        <Skeleton variant="rect" width={44} height={44} />
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <Skeleton width={180} height={16} />
                          <Skeleton width={100} height={13} />
                        </div>
                      </div>
                    </td>
                    <td><Skeleton width={80} height={16} /></td>
                    <td><Skeleton width={60} height={20} /></td>
                    <td><Skeleton width={70} height={20} /></td>
                    <td><Skeleton width={90} height={28} /></td>
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

            return (
              <div key={product.id} className="admin-catalog-card">
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

                  <span className={`admin-pill admin-pill--${status.tone} admin-catalog-card__badge-status`}>
                    {status.tone === "success" && <i className="fa-solid fa-check" style={{ marginRight: "0.25rem" }} />}
                    {status.tone === "warning" && <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: "0.25rem" }} />}
                    {status.label}
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
                  <h3 className="admin-catalog-card__title">
                    <Link
                      href={`/admin/catalog/${product.id}`}
                      className="admin-catalog-card__title-link"
                      title={product.name}
                    >
                      {product.name}
                    </Link>
                  </h3>

                  <div className="admin-catalog-card__meta-row">
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
                  </div>

                  {product.unit ? (
                    <div style={{ fontSize: "0.78rem", color: "var(--color-text-subtle)" }}>
                      Unit: <strong>{product.unit}</strong>
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
                          <i className="fa-solid fa-wand-magic-sparkles" style={{ color: "var(--color-primary)" }} />
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
        /* Compact Table View */
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--catalog">
            <thead>
              <tr>
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
                    <span>Product</span>
                    <SortIcon
                      columnKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                    />
                  </button>
                </th>
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
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {displayedProducts.map((product) => {
                const canGenerate = canGenerateCatalogImage(product);
                const isGenerating = generatingIds.has(product.id);
                const shops = product.shops_carrying_count ?? 0;
                const status = imageStatus(product);
                const meta = [product.brand, product.unit].filter(Boolean).join(" · ");
                const code = product.product_code || product.sku;

                return (
                  <tr key={product.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                        {product.image_url ? (
                          <div
                            style={{ position: "relative", cursor: "pointer" }}
                            onClick={() => setPreviewProduct(product)}
                            title="Click to view full image"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={resolveAssetUrl(product.image_url)}
                              alt=""
                              className="admin-catalog-thumb"
                            />
                          </div>
                        ) : (
                          <span
                            className="admin-catalog-thumb admin-catalog-thumb--empty"
                            aria-hidden="true"
                          >
                            <i className="fas fa-box" />
                          </span>
                        )}
                        <Link
                          href={`/admin/catalog/${product.id}`}
                          className="admin-table__primary admin-catalog-product"
                        >
                          <span className="admin-table__stack">
                            <strong>{product.name}</strong>
                            {meta ? (
                              <span className="admin-table__muted">{meta}</span>
                            ) : null}
                          </span>
                        </Link>
                      </div>
                    </td>
                    <td>
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
                        <span className="admin-catalog-code">—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          shops > 0
                            ? "admin-pill admin-pill--neutral"
                            : "admin-pill admin-pill--muted"
                        }
                      >
                        <i className="fa-solid fa-store" style={{ marginRight: "0.25rem", fontSize: "0.72rem" }} />
                        {shopsLabel(shops)}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-pill admin-pill--${status.tone}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="admin-table__actions">
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
                              <i className="fa-solid fa-wand-magic-sparkles" style={{ color: "var(--color-primary)" }} />
                              Generate AI
                            </>
                          )}
                        </button>
                      ) : null}
                      <Link
                        href={`/admin/catalog/${product.id}`}
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                      >
                        Manage
                      </Link>
                    </td>
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
                Status: <strong>{imageStatus(previewProduct).label}</strong> · {shopsLabel(previewProduct.shops_carrying_count ?? 0)}
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
    </section>
  );
}
