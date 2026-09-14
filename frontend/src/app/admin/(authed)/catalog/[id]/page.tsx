"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import type {
  AdminCatalogProductDetailResponse,
  AdminStoreMediaItem,
  CatalogProduct,
} from "@/lib/types";

export default function AdminCatalogProductPage() {
  const params = useParams<{ id: string }>();
  const productId = params?.id ?? "";

  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [storeMedia, setStoreMedia] = useState<AdminStoreMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const res = await apiFetch<AdminCatalogProductDetailResponse>(
        apiRoutes.adminCatalogProduct(productId),
      );
      setProduct(res.data.product);
      setStoreMedia(res.data.store_media);
    } catch (err) {
      await showError("Could not load product", extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setPrimary(url: string) {
    setSavingUrl(url);
    try {
      const res = await apiFetch<{ data: CatalogProduct; message: string }>(
        apiRoutes.adminCatalogPrimaryImage(productId),
        {
          method: "POST",
          body: JSON.stringify({ url, locked: true }),
        },
      );
      setProduct(res.data);
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not set primary image", extractErrorMessage(err));
    } finally {
      setSavingUrl(null);
    }
  }

  async function resetAuto() {
    setSavingUrl("__auto__");
    try {
      const res = await apiFetch<{ data: CatalogProduct; message: string }>(
        apiRoutes.adminCatalogPrimaryImageAuto(productId),
        { method: "POST" },
      );
      setProduct(res.data);
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not reset primary image", extractErrorMessage(err));
    } finally {
      setSavingUrl(null);
    }
  }

  async function generateAiImage() {
    if (!product || product.image_url || product.product_type === "service") return;
    setGenerating(true);
    try {
      const res = await apiFetch<{ data: CatalogProduct; message: string }>(
        apiRoutes.adminCatalogGenerateImage(productId),
        { method: "POST", body: JSON.stringify({}) },
      );
      setProduct(res.data);
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not generate image", extractErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <p className="app-muted">Loading product…</p>;
  }

  if (!product) {
    return (
      <section className="admin-section">
        <p className="app-muted">Product not found.</p>
        <Link href="/admin/catalog" className="admin-btn admin-btn--ghost">
          Back to catalog
        </Link>
      </section>
    );
  }

  const canGenerateAi =
    product.product_type === "product" && !product.image_url;

  return (
    <section className="admin-section">
      <header className="admin-section__head">
        <div>
          <Link href="/admin/catalog" className="admin-section__link">
            ← Catalog
          </Link>
          <h1>{product.name}</h1>
          <p className="admin-section__lead">
            Platform primary image
            {product.primary_image_locked
              ? " is locked by an admin."
              : " is chosen automatically from shop photos."}
          </p>
        </div>
        <div className="admin-section__head-actions">
          {canGenerateAi ? (
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={generating}
              onClick={() => void generateAiImage()}
            >
              {generating ? "Generating…" : "Generate AI image"}
            </button>
          ) : null}
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={savingUrl === "__auto__" || generating}
            onClick={() => void resetAuto()}
          >
            Use automatic primary
          </button>
        </div>
      </header>

      <div className="admin-catalog-primary">
        <h2>Current platform image</h2>
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveAssetUrl(product.image_url)}
            alt={product.name}
            className="admin-catalog-primary__img"
          />
        ) : (
          <p className="app-muted">
            No image selected yet
            {canGenerateAi
              ? " — generate one with AI, or pick a shop photo below."
              : "."}
          </p>
        )}
      </div>

      <h2>Photos from shops ({storeMedia.length})</h2>
      {storeMedia.length === 0 ? (
        <p className="app-muted">
          No shop photos yet. Merchants upload media from their inventory item
          {canGenerateAi ? ", or use Generate AI image above" : ""}.
        </p>
      ) : (
        <div className="admin-catalog-grid">
          {storeMedia.map((media) => {
            const isPrimary = media.url === product.image_url;
            return (
              <figure
                key={`${media.inventory_item_id}-${media.url}`}
                className="admin-catalog-grid__item"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveAssetUrl(media.url)}
                  alt={media.original_name ?? "Shop photo"}
                />
                <figcaption>
                  <span>{media.merchant_name ?? "Shop"}</span>
                  {isPrimary ? <span className="admin-pill">Primary</span> : null}
                  {!isPrimary ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary admin-btn--sm"
                      disabled={savingUrl === media.url || generating}
                      onClick={() => void setPrimary(media.url)}
                    >
                      {savingUrl === media.url ? "Saving…" : "Set as primary"}
                    </button>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
