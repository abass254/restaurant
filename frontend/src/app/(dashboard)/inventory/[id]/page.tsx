"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import { MotionModal } from "@/components/app/MotionModal";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { isVideoMedia } from "@/lib/media";
import { getCategory, isFieldVisible, optionLabel } from "@/lib/product-categories";
import type {
  CatalogProduct,
  InventoryItem,
  InventoryItemDetailResponse,
  InventoryItemMutationResponse,
  ProductImage,
  ProductImageGenerateResponse,
  ProductImageUploadResponse,
  InventoryMediaPostResponse,
  ProductUploadTokenResponse,
} from "@/lib/types";
import { QRCodeSVG } from "qrcode.react";

type TabId = "overview" | "pricing" | "media" | "details";

type EditDraft = {
  selling_price: string;
  buying_price: string;
  stock_quantity: string;
  low_stock_threshold: string;
  is_active: boolean;
  notes: string;
};

function formatPrice(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `KES ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toDraft(item: InventoryItem): EditDraft {
  return {
    selling_price:
      item.selling_price !== null ? String(item.selling_price) : "",
    buying_price:
      item.buying_price !== null ? String(item.buying_price) : "",
    stock_quantity:
      item.stock_quantity !== null ? String(item.stock_quantity) : "",
    low_stock_threshold:
      item.low_stock_threshold !== null
        ? String(item.low_stock_threshold)
        : "",
    is_active: item.is_active,
    notes: item.notes ?? "",
  };
}

function draftToPayload(
  draft: EditDraft,
  isService: boolean,
): Record<string, unknown> {
  const toNumOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const payload: Record<string, unknown> = {
    selling_price: toNumOrNull(draft.selling_price),
    buying_price: toNumOrNull(draft.buying_price),
    is_active: draft.is_active,
    notes: draft.notes.trim() || null,
  };
  if (!isService) {
    payload.stock_quantity = toNumOrNull(draft.stock_quantity);
    payload.low_stock_threshold = toNumOrNull(draft.low_stock_threshold);
  }
  return payload;
}

export default function InventoryItemPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const itemId = params?.id ?? "";

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const reload = useCallback(async () => {
    if (!itemId) {
      setError("Invalid inventory item.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<InventoryItemDetailResponse>(
        apiRoutes.inventoryItem(itemId),
      );
      setItem(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load this product."));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleDelete() {
    if (!item) return;
    const confirmed = await confirmAction(
      "Remove from inventory?",
      `"${item.product?.name ?? "This product"}" will no longer appear in your shop's inventory.`,
      "Yes, remove",
    );
    if (!confirmed) return;
    try {
      await apiFetch(apiRoutes.inventoryItem(item.id), { method: "DELETE" });
      await toastSuccess("Removed from inventory");
      router.push("/inventory");
    } catch (err) {
      await showError("Could not remove", extractErrorMessage(err));
    }
  }

  async function handleSave(draft: EditDraft) {
    if (!item) return;
    const isService = item.product?.product_type === "service";
    try {
      const data = await apiFetch<InventoryItemMutationResponse>(
        apiRoutes.inventoryItem(item.id),
        {
          method: "PATCH",
          body: JSON.stringify(draftToPayload(draft, isService)),
        },
      );
      setItem(data.data);
      await toastSuccess("Inventory updated");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    }
  }

  // Mutations on the catalog product (photos, cover, etc.) come back as the
  // updated `CatalogProduct`. Splice it into the current inventory item so the
  // page reflects the change without a full refetch.
  const applyItemUpdate = useCallback((next: InventoryItem) => {
    setItem(next);
  }, []);

  if (loading) {
    return <InventoryItemSkeleton />;
  }

  if (error || !item) {
    return (
      <section className="app-panel inv-detail">
        <header className="inv-detail__back">
          <Link href="/inventory" className="inv-detail__back-link">
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            Back to inventory
          </Link>
        </header>
        <div className="inventory-empty">
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
          <h2>{error ?? "Product not found"}</h2>
          <p>It may have been removed. Head back to your inventory list.</p>
          <Link href="/inventory" className="btn btn-primary btn-sm">
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            Back to inventory
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="app-panel inv-detail">
      <header className="inv-detail__back">
        <Link href="/inventory" className="inv-detail__back-link">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          Back to inventory
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-sm inv-detail__remove"
          onClick={() => void handleDelete()}
        >
          <i className="fa-solid fa-trash" aria-hidden="true" />
          Remove
        </button>
      </header>

      <ProductHero item={item} />

      <nav className="inv-detail__tabs" role="tablist" aria-label="Product sections">
        <TabButton
          id="overview"
          icon="fa-gauge"
          label="Overview"
          active={activeTab === "overview"}
          onSelect={setActiveTab}
        />
        <TabButton
          id="pricing"
          icon="fa-tags"
          label="Pricing & stock"
          active={activeTab === "pricing"}
          onSelect={setActiveTab}
        />
        <TabButton
          id="media"
          icon="fa-images"
          label="Media"
          active={activeTab === "media"}
          onSelect={setActiveTab}
          count={item.media?.length ?? 0}
        />
        <TabButton
          id="details"
          icon="fa-circle-info"
          label="Catalog details"
          active={activeTab === "details"}
          onSelect={setActiveTab}
        />
      </nav>

      <div className="inv-detail__body">
        {activeTab === "overview" ? <OverviewTab item={item} /> : null}
        {activeTab === "pricing" ? (
          <PricingTab item={item} onSave={handleSave} />
        ) : null}
        {activeTab === "media" ? (
          <MediaTab item={item} onItemUpdated={applyItemUpdate} />
        ) : null}
        {activeTab === "details" ? <DetailsTab item={item} /> : null}
      </div>
    </section>
  );
}

function TabButton({
  id,
  icon,
  label,
  active,
  onSelect,
  count,
}: {
  id: TabId;
  icon: string;
  label: string;
  active: boolean;
  onSelect: (id: TabId) => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`inv-detail__tab${active ? " is-active" : ""}`}
      onClick={() => onSelect(id)}
    >
      <i className={`fa-solid ${icon}`} aria-hidden="true" />
      {label}
      {typeof count === "number" && count > 0 ? (
        <span className="inv-detail__tab-count">{count}</span>
      ) : null}
    </button>
  );
}

function ProductHero({ item }: { item: InventoryItem }) {
  const product = item.product;
  const isService = product?.product_type === "service";
  const cat = getCategory(product?.category);

  const shopImage =
    item.media?.find((m) => !isVideoMedia(m))?.url ?? null;
  const primaryImage =
    shopImage ?? product?.image_url ?? null;

  return (
    <div className="inv-detail__hero">
      <div className="inv-detail__hero-media" aria-hidden={primaryImage ? undefined : true}>
        {primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveAssetUrl(primaryImage)} alt={product?.name ?? "Product"} />
        ) : (
          <i className={`fa-solid ${cat?.icon ?? "fa-box"}`} aria-hidden="true" />
        )}
      </div>

      <div className="inv-detail__hero-body">
        <h1 className="inv-detail__title">
          {product?.name ?? `Inventory item #${item.product_id}`}
        </h1>

        <div className="inv-detail__chips">
          <span
            className={`inventory-type-pill inventory-type-pill--${product?.product_type ?? "product"}`}
          >
            {isService ? "Service" : "Product"}
          </span>
          <span
            className={`inventory-status-pill ${item.is_active ? "is-on" : "is-off"}`}
          >
            {item.is_active ? "Active" : "Paused"}
          </span>
          {!isService && item.is_low_stock ? (
            <span className="inventory-status-pill inv-detail__chip-warn">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
              Low stock
            </span>
          ) : null}
        </div>

        <dl className="inv-detail__facts">
          {product?.brand ? (
            <Fact label="Brand" value={product.brand} />
          ) : null}
          {cat ? <Fact label="Category" value={cat.label} /> : null}
          {product?.product_code ? (
            <Fact label="Code" value={product.product_code} mono />
          ) : null}
          {product?.sku ? <Fact label="SKU" value={product.sku} mono /> : null}
          {product?.unit ? <Fact label="Unit" value={product.unit} /> : null}
        </dl>
      </div>
    </div>
  );
}

function InventoryItemSkeleton() {
  // Mirrors the real layout: back-link bar, hero (image + title + chips),
  // tab strip, and a single stat-row placeholder. Six skeleton blocks total —
  // enough to suggest the page shape without claiming specific content.
  return (
    <section className="app-panel inv-detail" aria-busy="true" aria-live="polite">
      <header className="inv-detail__back">
        <Skeleton variant="text" height={20} width={140} />
        <Skeleton variant="text" height={28} width={90} />
      </header>

      <div className="inv-detail__hero">
        <div className="inv-detail__hero-media">
          <Skeleton variant="rect" width="100%" height="100%" />
        </div>
        <div className="inv-detail__hero-body">
          <Skeleton variant="text" height={28} width="68%" />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Skeleton variant="text" height={22} width={72} />
            <Skeleton variant="text" height={22} width={72} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16 }}>
            <Skeleton variant="text" height={14} width="80%" />
            <Skeleton variant="text" height={14} width="60%" />
            <Skeleton variant="text" height={14} width="70%" />
          </div>
        </div>
      </div>

      <nav className="inv-detail__tabs" aria-hidden="true">
        <Skeleton variant="text" height={36} width={120} />
        <Skeleton variant="text" height={36} width={140} />
        <Skeleton variant="text" height={36} width={100} />
        <Skeleton variant="text" height={36} width={130} />
      </nav>

      <div className="inv-detail__body">
        <div className="inv-detail__overview">
          <div className="inv-detail__stats">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="inv-stat inv-stat--neutral">
                <Skeleton variant="circle" width={36} height={36} />
                <div className="inv-stat__body">
                  <Skeleton variant="text" height={11} width={80} />
                  <Skeleton variant="text" height={18} width={110} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="inv-detail__fact">
      <dt>{label}</dt>
      <dd className={mono ? "inv-detail__fact-mono" : undefined}>{value}</dd>
    </div>
  );
}

function OverviewTab({ item }: { item: InventoryItem }) {
  const product = item.product;
  const isService = product?.product_type === "service";

  const marginPct =
    item.margin !== null && item.buying_price && item.buying_price > 0
      ? (item.margin / item.buying_price) * 100
      : null;

  return (
    <div className="inv-detail__overview">
      <div className="inv-detail__stats">
        <StatCard
          icon="fa-tag"
          label="Selling price"
          value={formatPrice(item.selling_price)}
        />
        <StatCard
          icon="fa-coins"
          label="Buying price"
          value={formatPrice(item.buying_price)}
        />
        <StatCard
          icon="fa-chart-line"
          label="Margin"
          value={item.margin !== null ? formatPrice(item.margin) : "—"}
          hint={marginPct !== null ? `${marginPct.toFixed(1)}%` : undefined}
          tone={
            item.margin === null
              ? "neutral"
              : item.margin >= 0
                ? "positive"
                : "negative"
          }
        />
        {!isService ? (
          <StatCard
            icon="fa-boxes-stacked"
            label="In stock"
            value={
              item.stock_quantity !== null
                ? `${item.stock_quantity}${product?.unit ? ` ${product.unit}` : ""}`
                : "—"
            }
            tone={item.is_low_stock ? "negative" : "neutral"}
            hint={
              item.low_stock_threshold !== null
                ? `Alert at ${item.low_stock_threshold}`
                : undefined
            }
          />
        ) : (
          <StatCard
            icon="fa-hand-sparkles"
            label="Type"
            value="Service"
            hint="No stock tracked"
          />
        )}
      </div>

      <div className="inv-detail__card">
        <h2 className="inv-detail__card-title">
          <i className="fa-solid fa-align-left" aria-hidden="true" />
          Description
        </h2>
        {product?.description ? (
          <p className="inv-detail__desc">{product.description}</p>
        ) : (
          <p className="app-muted">No description on the catalog entry yet.</p>
        )}
      </div>

      {item.notes ? (
        <div className="inv-detail__card">
          <h2 className="inv-detail__card-title">
            <i className="fa-solid fa-note-sticky" aria-hidden="true" />
            Your notes
          </h2>
          <p className="inv-detail__desc">{item.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className={`inv-stat inv-stat--${tone ?? "neutral"}`}>
      <span className="inv-stat__icon" aria-hidden="true">
        <i className={`fa-solid ${icon}`} />
      </span>
      <div className="inv-stat__body">
        <span className="inv-stat__label">{label}</span>
        <strong className="inv-stat__value">{value}</strong>
        {hint ? <span className="inv-stat__hint">{hint}</span> : null}
      </div>
    </div>
  );
}

function PricingTab({
  item,
  onSave,
}: {
  item: InventoryItem;
  onSave: (draft: EditDraft) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<EditDraft>(() => toDraft(item));
  const [saving, setSaving] = useState(false);
  const isService = item.product?.product_type === "service";

  useEffect(() => {
    setDraft(toDraft(item));
  }, [item]);

  function update<K extends keyof EditDraft>(key: K, value: EditDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const margin = useMemo(() => {
    if (!draft.selling_price || !draft.buying_price) return null;
    return Number(draft.selling_price) - Number(draft.buying_price);
  }, [draft.selling_price, draft.buying_price]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    draft.selling_price !==
      (item.selling_price !== null ? String(item.selling_price) : "") ||
    draft.buying_price !==
      (item.buying_price !== null ? String(item.buying_price) : "") ||
    draft.stock_quantity !==
      (item.stock_quantity !== null ? String(item.stock_quantity) : "") ||
    draft.low_stock_threshold !==
      (item.low_stock_threshold !== null
        ? String(item.low_stock_threshold)
        : "") ||
    draft.is_active !== item.is_active ||
    draft.notes !== (item.notes ?? "");

  return (
    <form className="inv-detail__card settings-form" onSubmit={handleSubmit}>
      <div className="settings-form__row">
        <label className="settings-field">
          <span>Buying price (KES)</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={draft.buying_price}
            onChange={(e) => update("buying_price", e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="settings-field">
          <span>Selling price (KES)</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={draft.selling_price}
            onChange={(e) => update("selling_price", e.target.value)}
            placeholder="0.00"
          />
        </label>
      </div>

      {margin !== null ? (
        <p className="app-muted inventory-margin-preview">
          Margin: <strong>{formatPrice(margin)}</strong>
          {Number(draft.buying_price) > 0 ? (
            <>
              {" "}
              ({((margin / Number(draft.buying_price)) * 100).toFixed(1)}%)
            </>
          ) : null}
        </p>
      ) : null}

      {!isService ? (
        <div className="settings-form__row">
          <label className="settings-field">
            <span>Stock quantity</span>
            <input
              type="number"
              min={0}
              value={draft.stock_quantity}
              onChange={(e) => update("stock_quantity", e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="settings-field">
            <span>Low-stock alert at</span>
            <input
              type="number"
              min={0}
              value={draft.low_stock_threshold}
              onChange={(e) => update("low_stock_threshold", e.target.value)}
              placeholder="5"
            />
          </label>
        </div>
      ) : null}

      <label className="settings-field">
        <span>Notes (optional)</span>
        <textarea
          value={draft.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Internal notes for your shop"
        />
      </label>

      <div className="settings-toggle settings-toggle--compact">
        <div className="settings-toggle__copy">
          <strong>Active</strong>
          <span>
            {draft.is_active
              ? "Visible / sellable in this shop."
              : "Paused — won't appear as available."}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.is_active}
          className={`settings-toggle__switch${draft.is_active ? " is-on" : ""}`}
          onClick={() => update("is_active", !draft.is_active)}
        >
          <span className="settings-toggle__thumb" aria-hidden="true" />
          <span className="sr-only">
            {draft.is_active ? "Disable" : "Enable"}
          </span>
        </button>
      </div>

      <div className="settings-actions">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDraft(toDraft(item))}
            disabled={saving}
          >
            Discard
          </button>
        ) : null}
      </div>
    </form>
  );
}

function MediaTab({
  item,
  onItemUpdated,
}: {
  item: InventoryItem;
  onItemUpdated: (item: InventoryItem) => void;
}) {
  const product = item.product;
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [postTarget, setPostTarget] = useState<ProductImage | null>(null);
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!product) {
    return <p className="app-muted">Catalog product unavailable.</p>;
  }

  const images = item.media ?? [];
  const platformCoverUrl = product.image_url ?? null;
  const isService = product.product_type === "service";

  async function handleGenerate(opts: {
    prompt?: string;
    quality?: "low" | "medium" | "high";
    replaceCover?: boolean;
  }) {
    setGenerating(true);
    try {
      const res = await apiFetch<ProductImageGenerateResponse>(
        apiRoutes.inventoryMediaGenerate(item.id),
        {
          method: "POST",
          body: JSON.stringify({
            prompt: opts.prompt?.trim() || null,
            quality: opts.quality ?? null,
          }),
        },
      );
      onItemUpdated(res.data);
      setAiOpen(false);
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not generate image", extractErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  const imageCount = images.filter((m) => !isVideoMedia(m)).length;
  const videoCount = images.length - imageCount;

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of arr) form.append("files", f);
      const res = await apiFetch<ProductImageUploadResponse>(
        apiRoutes.inventoryMedia(item.id),
        { method: "POST", body: form },
      );
      onItemUpdated(res.data);
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Upload failed", extractErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handlePostToInstagram(media: ProductImage, caption: string) {
    setPosting(true);
    try {
      const res = await apiFetch<InventoryMediaPostResponse>(
        apiRoutes.inventoryMediaPost(item.id),
        {
          method: "POST",
          body: JSON.stringify({
            url: media.url,
            platform: "instagram",
            caption: caption.trim() || null,
          }),
        },
      );
      setPostTarget(null);
      await toastSuccess(res.message);
      if (res.permalink) {
        window.open(res.permalink, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      await showError("Could not post to Instagram", extractErrorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteMedia(image: ProductImage) {
    const isVideo = isVideoMedia(image);
    const confirmed = await confirmAction(
      isVideo ? "Delete this video?" : "Delete this photo?",
      "It will be removed from your shop only.",
      "Yes, delete",
    );
    if (!confirmed) return;
    try {
      const url = `${apiRoutes.inventoryMedia(item.id)}?url=${encodeURIComponent(image.url)}`;
      const res = await apiFetch<{ data: InventoryItem; message: string }>(url, {
        method: "DELETE",
      });
      onItemUpdated(res.data);
      await toastSuccess(res.message);
    } catch (err) {
      await showError(
        isVideo ? "Could not delete video" : "Could not delete photo",
        extractErrorMessage(err),
      );
    }
  }

  return (
    <div className="inv-detail__photos">
      <div className="inv-detail__media-header">
        <div>
          <p className="app-muted inv-detail__photos-hint">
            Media is specific to your shop. Other merchants carrying this
            product keep their own photos and videos. The platform may use one
            of these images as the catalog thumbnail.
          </p>
          {images.length > 0 ? (
            <p className="app-muted inv-detail__media-count">
              <span>
                <i className="fa-solid fa-image" aria-hidden="true" />{" "}
                {imageCount} photo{imageCount === 1 ? "" : "s"}
              </span>
              <span>
                <i className="fa-solid fa-video" aria-hidden="true" />{" "}
                {videoCount} video{videoCount === 1 ? "" : "s"}
              </span>
            </p>
          ) : null}
        </div>
        <div className="inv-detail__media-actions">
          {!isService ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAiOpen(true)}
              disabled={generating}
              title="Generate a product image with AI from the description"
            >
              <i
                className={`fa-solid ${generating ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"}`}
                aria-hidden="true"
              />
              {generating ? "Generating…" : "Generate with AI"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setQrOpen(true)}
          >
            <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
            Upload from phone
          </button>
        </div>
      </div>

      {images.length === 0 ? (
        <div className="inventory-empty inventory-empty--small">
          <i className="fa-solid fa-camera" aria-hidden="true" />
          <p>
            No media yet. Drop photos or videos in below, or scan a QR with
            your phone.
          </p>
        </div>
      ) : (
        <div className="inventory-gallery">
          {images.map((media) => {
            const isPlatformCover = media.url === platformCoverUrl;
            const isVideo = isVideoMedia(media);
            const src = resolveAssetUrl(media.url);
            return (
              <figure
                key={media.url}
                className={`inventory-gallery__item${isPlatformCover ? " is-cover" : ""}${isVideo ? " is-video" : ""}`}
              >
                {isVideo ? (
                  <>
                    <video
                      src={src}
                      preload="metadata"
                      playsInline
                      muted
                      controls
                    />
                    <span className="inv-media__kind-badge inv-media__kind-badge--video">
                      <i className="fa-solid fa-video" aria-hidden="true" />
                      Video
                    </span>
                  </>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={media.original_name || "Product photo"}
                      loading="lazy"
                    />
                    <span className="inv-media__kind-badge inv-media__kind-badge--photo">
                      <i className="fa-solid fa-image" aria-hidden="true" />
                      Photo
                    </span>
                  </>
                )}
                {isPlatformCover ? (
                  <span className="inventory-gallery__badge">
                    <i className="fa-solid fa-star" aria-hidden="true" /> Platform
                  </span>
                ) : null}
                <div className="inventory-gallery__actions">
                  {!isVideo ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPostTarget(media)}
                      title="Post to Instagram"
                    >
                      <i className="fa-brands fa-instagram" aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm inventory-danger"
                    onClick={() => void handleDeleteMedia(media)}
                    title={isVideo ? "Delete video" : "Delete photo"}
                  >
                    <i className="fa-solid fa-trash" aria-hidden="true" />
                  </button>
                </div>
              </figure>
            );
          })}
        </div>
      )}

      <div
        className={`inventory-dropzone${dragOver ? " is-active" : ""}${uploading ? " is-busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) {
              void handleFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
        <i
          className={`fa-solid ${uploading ? "fa-spinner fa-spin" : "fa-cloud-arrow-up"}`}
          aria-hidden="true"
        />
        <div>
          <strong>
            {uploading
              ? "Uploading…"
              : "Drop photos or videos here, or click to choose"}
          </strong>
          <span className="app-muted">
            Photos: JPEG, PNG, WebP, GIF · up to 5&nbsp;MB · Videos: MP4, MOV,
            WebM · up to 50&nbsp;MB
          </span>
        </div>
      </div>

      <QrUploadModal
        open={qrOpen}
        inventoryItemId={item.id}
        productName={product.name}
        onClose={() => setQrOpen(false)}
        onItemRefresh={onItemUpdated}
      />

      <AiGenerateModal
        open={aiOpen}
        product={product}
        generating={generating}
        hasCover={imageCount > 0 || !!platformCoverUrl}
        onClose={() => (generating ? undefined : setAiOpen(false))}
        onGenerate={handleGenerate}
      />

      <PostToInstagramModal
        open={postTarget !== null}
        media={postTarget}
        product={product}
        item={item}
        posting={posting}
        onClose={() => (posting ? undefined : setPostTarget(null))}
        onPost={handlePostToInstagram}
      />
    </div>
  );
}

function defaultInstagramCaption(
  product: CatalogProduct,
  item: InventoryItem,
): string {
  const parts = [product.name];
  if (item.selling_price != null) {
    parts.push(formatPrice(item.selling_price));
  }
  if (product.description?.trim()) {
    parts.push(product.description.trim());
  }
  return parts.join("\n\n");
}

function PostToInstagramModal({
  open,
  media,
  product,
  item,
  posting,
  onClose,
  onPost,
}: {
  open: boolean;
  media: ProductImage | null;
  product: CatalogProduct;
  item: InventoryItem;
  posting: boolean;
  onClose: () => void;
  onPost: (media: ProductImage, caption: string) => Promise<void>;
}) {
  const seedCaption = useMemo(
    () => defaultInstagramCaption(product, item),
    [product, item],
  );
  const [caption, setCaption] = useState(seedCaption);

  useEffect(() => {
    if (open) setCaption(seedCaption);
  }, [open, seedCaption]);

  if (!media) return null;

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Post photo to Instagram"
      panelClassName="inv-post-modal"
      closeOnBackdrop={!posting}
      closeOnEscape={!posting}
    >
      <header className="inventory-modal__head">
        <div>
          <h2>
            <i className="fa-brands fa-instagram" aria-hidden="true" /> Post to
            Instagram
          </h2>
          <span className="app-muted">
            Publish this photo to your connected Instagram business account.
          </span>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={posting}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body inv-post-modal__body">
        <figure className="inv-post-modal__preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveAssetUrl(media.url)}
            alt={media.original_name || product.name}
          />
        </figure>

        <label className="settings-field" htmlFor="inv-post-caption">
          <div className="inv-post-modal__caption-head">
            <span>Caption</span>
            <span className="app-muted">{caption.length}/2200</span>
          </div>
          <textarea
            id="inv-post-caption"
            rows={5}
            maxLength={2200}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={posting}
            placeholder="Write a caption for your post…"
          />
        </label>

        <p className="app-muted inv-post-modal__hint">
          Instagram must be connected via Meta OAuth in{" "}
          <Link href="/settings">Settings</Link>. Your site must be publicly
          reachable so Instagram can fetch the image.
        </p>

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={posting}
            onClick={() => void onPost(media, caption)}
          >
            <i
              className={
                posting
                  ? "fa-solid fa-spinner fa-spin"
                  : "fa-brands fa-instagram"
              }
              aria-hidden="true"
            />
            {posting ? "Posting…" : "Post now"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={posting}
          >
            Cancel
          </button>
        </div>
      </div>
    </MotionModal>
  );
}

function AiGenerateModal({
  open,
  product,
  generating,
  hasCover,
  onClose,
  onGenerate,
}: {
  open: boolean;
  product: CatalogProduct;
  generating: boolean;
  hasCover: boolean;
  onClose: () => void;
  onGenerate: (opts: {
    prompt?: string;
    quality?: "low" | "medium" | "high";
    replaceCover?: boolean;
  }) => Promise<void>;
}) {
  // Seed the prompt textarea with whatever description the product already
  // has. Users tend to tweak this once and then leave the rest to defaults.
  const seedPrompt = useMemo(() => {
    const parts: string[] = [product.name];
    if (product.brand) parts.push(`by ${product.brand}`);
    if (product.description) parts.push(product.description);
    return parts.filter(Boolean).join(". ");
  }, [product.name, product.brand, product.description]);

  const [prompt, setPrompt] = useState(seedPrompt);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");
  const [replaceCover, setReplaceCover] = useState(hasCover);

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Generate product image with AI"
      panelClassName="inv-ai-modal"
      closeOnBackdrop={!generating}
      closeOnEscape={!generating}
    >
      <header className="inventory-modal__head">
        <div>
          <h2>
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />{" "}
            Generate product image
          </h2>
          <span className="app-muted">
            We'll draft a clean catalog photo from the description below.
          </span>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={generating}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body">
          <label className="settings-field">
            <span>Prompt</span>
            <textarea
              rows={5}
              maxLength={2000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Coca-Cola 500ml plastic bottle, red label, condensation on glass"
              disabled={generating}
            />
            <small className="app-muted inventory-field-help">
              We add a "studio product photo on white background" style on top of
              whatever you type.
            </small>
          </label>

          <div className="settings-form__row">
            <label className="settings-field">
              <span>Quality</span>
              <select
                value={quality}
                onChange={(e) =>
                  setQuality(e.target.value as "low" | "medium" | "high")
                }
                disabled={generating}
              >
                <option value="low">Low — fastest, cheapest</option>
                <option value="medium">Medium — balanced</option>
                <option value="high">High — slow, best detail</option>
              </select>
            </label>
            {hasCover ? (
              <label className="settings-field">
                <span>Cover</span>
                <div className="settings-toggle settings-toggle--compact">
                  <div className="settings-toggle__copy">
                    <strong>Replace current cover</strong>
                    <span>
                      {replaceCover
                        ? "New image will become the cover."
                        : "New image is added to the gallery only."}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={replaceCover}
                    className={`settings-toggle__switch${replaceCover ? " is-on" : ""}`}
                    onClick={() => setReplaceCover((v) => !v)}
                    disabled={generating}
                  >
                    <span className="settings-toggle__thumb" aria-hidden="true" />
                  </button>
                </div>
              </label>
            ) : null}
          </div>

          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={generating || !prompt.trim()}
              onClick={() =>
                void onGenerate({
                  prompt,
                  quality,
                  replaceCover: hasCover ? replaceCover : true,
                })
              }
            >
              <i
                className={`fa-solid ${generating ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"}`}
                aria-hidden="true"
              />
              {generating ? "Generating…" : "Generate"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={generating}
            >
              Cancel
            </button>
          </div>
        </div>
    </MotionModal>
  );
}

function QrUploadModal({
  open,
  inventoryItemId,
  productName,
  onClose,
  onItemRefresh,
}: {
  open: boolean;
  inventoryItemId: string;
  productName: string;
  onClose: () => void;
  onItemRefresh: (item: InventoryItem) => void;
}) {
  const [tokenInfo, setTokenInfo] = useState<ProductUploadTokenResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  // Generation counter — bump to force a fresh token mint after expire or
  // explicit "regenerate". Starts at 1 so the very first mount mints once.
  const [generation, setGeneration] = useState(1);
  const [minting, setMinting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  // True once the user has explicitly expired the link, or the countdown has
  // hit zero. Tracked separately so we can keep the (now-stale) QR visible
  // for context while showing a "Generate new link" CTA.
  const [expired, setExpired] = useState(false);

  // Mint a fresh upload token on open and whenever `generation` bumps.
  useEffect(() => {
    let alive = true;
    setMinting(true);
    setError(null);
    apiFetch<ProductUploadTokenResponse>(apiRoutes.inventoryUploadTokens, {
      method: "POST",
      body: JSON.stringify({ inventory_item_id: inventoryItemId }),
    })
      .then((res) => {
        if (!alive) return;
        setTokenInfo(res);
        setRemaining(res.expires_in);
        setExpired(false);
      })
      .catch((err) => {
        if (alive) setError(extractErrorMessage(err, "Could not create QR link."));
      })
      .finally(() => {
        if (alive) setMinting(false);
      });
    return () => {
      alive = false;
    };
  }, [inventoryItemId, generation]);

  // Countdown timer.
  useEffect(() => {
    if (remaining === null || remaining <= 0 || expired) return;
    const handle = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return prev;
        const next = Math.max(0, prev - 1);
        if (next === 0) setExpired(true);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(handle);
  }, [remaining, expired]);

  // While the link is live, poll the inventory item so phone uploads appear.
  useEffect(() => {
    if (!tokenInfo || expired) return;
    const handle = window.setInterval(() => {
      apiFetch<InventoryItemDetailResponse>(apiRoutes.inventoryItem(inventoryItemId))
        .then((res) => onItemRefresh(res.data))
        .catch(() => {
          /* Silent — polling is best-effort. */
        });
    }, 4000);
    return () => window.clearInterval(handle);
  }, [tokenInfo, inventoryItemId, onItemRefresh, expired]);

  async function handleCopy() {
    if (!tokenInfo) return;
    try {
      await navigator.clipboard.writeText(tokenInfo.upload_url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      /* Clipboard may be unavailable; user can long-press to copy manually. */
    }
  }

  async function handleExpire() {
    if (!tokenInfo || expired || revoking) return;
    const confirmed = await confirmAction(
      "Expire this link?",
      "Anyone who hasn't uploaded yet will get an error. You can generate a fresh link right after.",
      "Yes, expire",
    );
    if (!confirmed) return;
    setRevoking(true);
    try {
      await apiFetch<{ message: string; revoked: boolean }>(
        apiRoutes.inventoryUploadTokensRevoke,
        {
          method: "POST",
          body: JSON.stringify({ token: tokenInfo.token }),
        },
      );
      setExpired(true);
      setRemaining(0);
      await toastSuccess("Upload link expired.");
    } catch (err) {
      await showError("Could not expire link", extractErrorMessage(err));
    } finally {
      setRevoking(false);
    }
  }

  function handleRegenerate() {
    if (minting) return;
    setTokenInfo(null);
    setRemaining(null);
    setExpired(false);
    setGeneration((g) => g + 1);
  }

  const remainingLabel = (() => {
    if (expired) return "Expired";
    if (remaining === null) return null;
    if (remaining <= 0) return "Expired";
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  })();

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Upload from your phone"
      panelClassName="inv-qr-modal"
    >
      <header className="inventory-modal__head">
        <div>
          <h2>Upload from your phone</h2>
          <span className="app-muted">
            Scan with your phone's camera to add photos or videos to{" "}
            <strong>{productName}</strong>.
          </span>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body inv-qr-modal__body">
          {error ? (
            <>
              <p className="app-error">{error}</p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleRegenerate}
                disabled={minting}
              >
                <i className="fa-solid fa-rotate" aria-hidden="true" />
                Try again
              </button>
            </>
          ) : !tokenInfo ? (
            <p className="app-muted">Generating link…</p>
          ) : (
            <>
              <div
                className={`inv-qr-modal__qr${expired ? " is-expired" : ""}`}
              >
                <QRCodeSVG
                  value={tokenInfo.upload_url}
                  size={232}
                  includeMargin
                  level="M"
                />
                {expired ? (
                  <div className="inv-qr-modal__expired-overlay">
                    <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                    Expired
                  </div>
                ) : null}
              </div>

              {expired ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm inv-qr-modal__regen"
                  onClick={handleRegenerate}
                  disabled={minting}
                >
                  <i
                    className={`fa-solid ${minting ? "fa-spinner fa-spin" : "fa-rotate"}`}
                    aria-hidden="true"
                  />
                  {minting ? "Generating…" : "Generate new link"}
                </button>
              ) : (
                <ol className="inv-qr-modal__steps">
                  <li>Open the camera app on your phone.</li>
                  <li>Point it at the QR code above.</li>
                  <li>
                    Tap the notification to open the upload page, then pick
                    photos or record a video.
                  </li>
                </ol>
              )}

              <div className="inv-qr-modal__url">
                <code title={tokenInfo.upload_url}>{tokenInfo.upload_url}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleCopy()}
                  disabled={expired}
                  title={expired ? "Link expired" : "Copy link"}
                >
                  <i
                    className={`fa-solid ${copyState === "copied" ? "fa-check" : "fa-copy"}`}
                    aria-hidden="true"
                  />
                  {copyState === "copied" ? "Copied" : "Copy link"}
                </button>
              </div>

              <div className="inv-qr-modal__footer">
                <p className="app-muted inv-qr-modal__meta">
                  <span>
                    <i className="fa-solid fa-clock" aria-hidden="true" />{" "}
                    {expired ? "Link is expired" : `Link is active for ${remainingLabel}`}
                  </span>
                  {!expired ? (
                    <span>
                      <i className="fa-solid fa-rotate" aria-hidden="true" /> This
                      gallery refreshes automatically while the link is open.
                    </span>
                  ) : null}
                </p>
                {!expired ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm inv-qr-modal__expire"
                    onClick={() => void handleExpire()}
                    disabled={revoking}
                  >
                    <i
                      className={`fa-solid ${revoking ? "fa-spinner fa-spin" : "fa-power-off"}`}
                      aria-hidden="true"
                    />
                    {revoking ? "Expiring…" : "Expire link now"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
    </MotionModal>
  );
}

function DetailsTab({ item }: { item: InventoryItem }) {
  const product = item.product;
  const cat = getCategory(product?.category);
  const attrs = product?.attributes ?? {};

  const rows = useMemo(() => {
    if (!cat) return [] as { label: string; value: string }[];
    return cat.fields
      .map((field) => {
        if (!isFieldVisible(field, attrs)) return null;
        const raw = attrs[field.key];
        if (raw === null || raw === undefined || raw === "") return null;
        if (Array.isArray(raw) && raw.length === 0) return null;
        let value: string;
        if (Array.isArray(raw)) {
          value = raw
            .map((v) => optionLabel(field, String(v)))
            .filter(Boolean)
            .join(", ");
        } else if (field.type === "select") {
          value = optionLabel(field, String(raw));
        } else {
          value = String(raw);
          if (field.unit) value += ` ${field.unit}`;
        }
        if (!value) return null;
        return { label: field.label, value };
      })
      .filter((r): r is { label: string; value: string } => r !== null);
  }, [cat, attrs]);

  if (!product) {
    return <p className="app-muted">Catalog details unavailable.</p>;
  }

  return (
    <div className="inv-detail__card">
      <h2 className="inv-detail__card-title">
        <i className={`fa-solid ${cat?.icon ?? "fa-circle-info"}`} aria-hidden="true" />
        {cat?.label ?? "Catalog details"}
      </h2>
      {rows.length === 0 ? (
        <p className="app-muted">
          No structured catalog attributes for this product yet.
        </p>
      ) : (
        <dl className="inv-detail__attrs">
          {rows.map((row) => (
            <div className="inv-detail__attr" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
