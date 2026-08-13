"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import {
  formatComposeProductPrice,
  type ComposeLinkedProduct,
} from "@/lib/feedCaption";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

type FeedsComposeProductPickerProps = {
  disabled?: boolean;
  linkedProducts: ComposeLinkedProduct[];
  onChange: (products: ComposeLinkedProduct[]) => void;
};

function toLinkedProduct(item: InventoryItem): ComposeLinkedProduct {
  const product = item.product;
  const cover =
    item.media?.find((m) => m.content_type?.startsWith("image/"))?.url ??
    product?.image_url ??
    null;
  return {
    inventoryItemId: item.id,
    productName: product?.name ?? "Product",
    productCode: product?.product_code ?? null,
    sellingPrice: item.selling_price,
    imageUrl: cover,
  };
}

export function FeedsComposeProductPicker({
  disabled = false,
  linkedProducts,
  onChange,
}: FeedsComposeProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const linkedIds = useMemo(
    () => new Set(linkedProducts.map((item) => item.inventoryItemId)),
    [linkedProducts],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems([]);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ active: "true" });
      if (query.trim()) params.set("q", query.trim());
      apiFetch<InventoryResponse>(`${apiRoutes.inventory}?${params.toString()}`)
        .then((res) => {
          if (alive) setItems(res.data);
        })
        .catch((err) => {
          if (alive) {
            void showError("Could not load inventory", extractErrorMessage(err));
          }
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, query.trim() ? 250 : 0);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  function handleAdd(item: InventoryItem) {
    const next = toLinkedProduct(item);
    if (linkedIds.has(next.inventoryItemId)) return;
    onChange([...linkedProducts, next]);
  }

  function handleRemove(inventoryItemId: string) {
    onChange(linkedProducts.filter((item) => item.inventoryItemId !== inventoryItemId));
  }

  return (
    <section className="feeds-compose-products" aria-label="Link products">
      <div className="feeds-compose-products__head">
        <div>
          <h3>
            <i className="fa-solid fa-link" aria-hidden="true" /> Linked products
          </h3>
          <p className="app-muted">
            Products you link are added to the caption and tied to this post after
            publishing.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
        >
          <i className={`fa-solid ${open ? "fa-chevron-up" : "fa-plus"}`} aria-hidden="true" />
          {open ? "Close" : linkedProducts.length > 0 ? "Add product" : "Link product"}
        </button>
      </div>

      {linkedProducts.length > 0 ? (
        <ul className="feeds-link-current__list feeds-compose-products__linked">
          {linkedProducts.map((item) => (
            <li key={item.inventoryItemId}>
              <span className="feeds-link-current__thumb">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveAssetUrl(item.imageUrl)} alt={item.productName} />
                ) : (
                  <i className="fa-solid fa-box" aria-hidden="true" />
                )}
              </span>
              <span className="feeds-compose-products__meta">
                <span className="feeds-link-current__name">{item.productName}</span>
                {item.productCode || item.sellingPrice != null ? (
                  <span className="app-muted">
                    {item.productCode ? `${item.productCode}` : ""}
                    {item.productCode && item.sellingPrice != null ? " · " : ""}
                    {formatComposeProductPrice(item.sellingPrice)}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="fb-icon-btn feeds-link-current__unlink"
                aria-label={`Remove ${item.productName}`}
                disabled={disabled}
                onClick={() => handleRemove(item.inventoryItemId)}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted feeds-compose-products__empty">
          No products linked yet. Add products to include them in your caption.
        </p>
      )}

      {open ? (
        <div className="feeds-compose-products__picker">
          <label className="inventory-modal__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search your inventory…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={disabled}
            />
          </label>

          {loading ? (
            <p className="app-muted">Loading inventory…</p>
          ) : items.length === 0 ? (
            <p className="app-muted">
              {query.trim()
                ? `No inventory matches for "${query.trim()}".`
                : "You do not have any active inventory items yet."}
            </p>
          ) : (
            <ul className="feeds-link-list feeds-compose-products__results">
              {items.map((item) => {
                const linked = linkedIds.has(item.id);
                const product = item.product;
                const cover =
                  item.media?.find((m) => m.content_type?.startsWith("image/"))?.url ??
                  product?.image_url ??
                  null;
                return (
                  <li key={item.id}>
                    <div className="feeds-link-list__item">
                      <div className="feeds-link-list__thumb">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolveAssetUrl(cover)}
                            alt={product?.name ?? "Product"}
                          />
                        ) : (
                          <i className="fa-solid fa-box" aria-hidden="true" />
                        )}
                      </div>
                      <div className="feeds-link-list__copy">
                        <strong>{product?.name ?? "Product"}</strong>
                        <span className="app-muted">
                          {product?.product_code ? `${product.product_code} · ` : ""}
                          {formatComposeProductPrice(item.selling_price) || "No price set"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={disabled || linked}
                        onClick={() => handleAdd(item)}
                      >
                        {linked ? "Added" : "Add"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
