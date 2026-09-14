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
import type { AdminCatalogProductsResponse, CatalogProduct } from "@/lib/types";

function canGenerateCatalogImage(product: CatalogProduct): boolean {
  return product.product_type === "product" && !product.image_url;
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

export default function AdminCatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);

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

  const missingImageProducts = useMemo(
    () => products.filter(canGenerateCatalogImage),
    [products],
  );

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
      <header className="admin-section__head">
        <div>
          <h1>Catalog</h1>
          <p className="admin-section__lead">
            Pick the platform primary image for shared catalog products from
            photos merchants have uploaded, or generate AI images for ones that
            are still missing.
          </p>
        </div>
        {missingImageProducts.length > 0 ? (
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={bulkGenerating || loading}
            onClick={() => void handleGenerateMissing()}
          >
            {bulkGenerating
              ? "Generating…"
              : `Generate missing (${missingImageProducts.length})`}
          </button>
        ) : null}
      </header>

      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void load(query);
        }}
      >
        <input
          type="search"
          className="admin-input"
          placeholder="Search name, brand, code, SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="admin-btn admin-btn--primary">
          Search
        </button>
      </form>

      {loading ? (
        <p className="app-muted">Loading catalog…</p>
      ) : products.length === 0 ? (
        <p className="app-muted">No catalog products found.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Code</th>
                <th>Primary image</th>
                <th>Shops</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const canGenerate = canGenerateCatalogImage(product);
                const isGenerating = generatingIds.has(product.id);
                return (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      {product.brand ? (
                        <span className="app-muted"> · {product.brand}</span>
                      ) : null}
                    </td>
                    <td>{product.product_code ?? "—"}</td>
                    <td>
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveAssetUrl(product.image_url)}
                          alt=""
                          className="admin-catalog-thumb"
                        />
                      ) : (
                        <span className="app-muted">Missing</span>
                      )}
                      {product.primary_image_locked ? (
                        <span className="admin-pill">Locked</span>
                      ) : null}
                    </td>
                    <td>{product.shops_carrying_count ?? 0}</td>
                    <td className="admin-table__actions">
                      {canGenerate ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          disabled={isGenerating || bulkGenerating}
                          onClick={() => void handleGenerateOne(product)}
                        >
                          {isGenerating ? "Generating…" : "Generate AI"}
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
    </section>
  );
}
