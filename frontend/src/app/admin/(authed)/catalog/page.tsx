"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import type { AdminCatalogProductsResponse, CatalogProduct } from "@/lib/types";

export default function AdminCatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="admin-section">
      <header className="admin-section__head">
        <div>
          <h1>Catalog</h1>
          <p className="admin-section__lead">
            Pick the platform primary image for shared catalog products from
            photos merchants have uploaded.
          </p>
        </div>
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
              {products.map((product) => (
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
                      <span className="app-muted">Auto</span>
                    )}
                    {product.primary_image_locked ? (
                      <span className="admin-pill">Locked</span>
                    ) : null}
                  </td>
                  <td>{product.shops_carrying_count ?? 0}</td>
                  <td>
                    <Link
                      href={`/admin/catalog/${product.id}`}
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
