"use client";

import { useEffect, useMemo, useState } from "react";
import { MotionModal } from "@/components/app/MotionModal";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import type {
  FeedPost,
  FeedPostLinkResponse,
  FeedPostLinkedInventory,
  InventoryItem,
  InventoryResponse,
} from "@/lib/types";

type FeedsLinkProductModalProps = {
  open: boolean;
  post: FeedPost | null;
  onClose: () => void;
  onLinked: (post: FeedPost, linked: FeedPostLinkedInventory[]) => void;
  onUnlink?: (inventoryItemId: string) => void;
};

function formatPrice(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return `KES ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function FeedsLinkProductModal({
  open,
  post,
  onClose,
  onLinked,
  onUnlink,
}: FeedsLinkProductModalProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const linkedIds = useMemo(
    () => new Set((post?.linked_inventory ?? []).map((item) => item.inventory_item_id)),
    [post?.linked_inventory],
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

  async function handleLink(item: InventoryItem) {
    if (!post) return;
    setLinkingId(item.id);
    try {
      const res = await apiFetch<FeedPostLinkResponse>(
        apiRoutes.feedsPostLink(post.platform, post.id),
        {
          method: "PUT",
          body: JSON.stringify({ inventory_item_id: item.id }),
        },
      );
      onLinked(post, res.linked_inventory);
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not link product", extractErrorMessage(err));
    } finally {
      setLinkingId(null);
    }
  }

  if (!post) return null;

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Link post to inventory products"
      panelClassName="inventory-modal--wide feeds-link-modal"
      closeOnBackdrop={!linkingId}
      closeOnEscape={!linkingId}
    >
      <header className="inventory-modal__head">
        <div>
          <h2>
            <i className="fa-solid fa-link" aria-hidden="true" /> Link products
          </h2>
          <span className="app-muted">
            Attach one or more inventory items to this post. You can link multiple
            products.
          </span>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={!!linkingId}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body">
        {post.linked_inventory.length > 0 ? (
          <div className="feeds-link-current">
            <h3>Linked now</h3>
            <ul className="feeds-link-current__list">
              {post.linked_inventory.map((item) => (
                <li key={item.inventory_item_id}>
                  <span className="feeds-link-current__thumb">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveAssetUrl(item.image_url)}
                        alt={item.product_name}
                      />
                    ) : (
                      <i className="fa-solid fa-box" aria-hidden="true" />
                    )}
                  </span>
                  <span className="feeds-link-current__name">{item.product_name}</span>
                  {onUnlink ? (
                    <button
                      type="button"
                      className="fb-icon-btn feeds-link-current__unlink"
                      aria-label={`Unlink ${item.product_name}`}
                      disabled={!!linkingId}
                      onClick={() => onUnlink(item.inventory_item_id)}
                    >
                      <i className="fa-solid fa-link-slash" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <label className="inventory-modal__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search your inventory…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </label>

        {loading ? (
          <p className="app-muted">Loading inventory…</p>
        ) : items.length === 0 ? (
          <div className="inventory-empty inventory-empty--small">
            <p>
              {query.trim()
                ? `No inventory matches for "${query.trim()}".`
                : "You do not have any active inventory items yet."}
            </p>
          </div>
        ) : (
          <ul className="feeds-link-list">
            {items.map((item) => {
              const product = item.product;
              const cover =
                item.media?.find((m) => m.content_type?.startsWith("image/"))?.url ??
                product?.image_url ??
                null;
              const isLinked = linkedIds.has(item.id);
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
                        {formatPrice(item.selling_price) || "No price set"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!!linkingId || isLinked}
                      onClick={() => void handleLink(item)}
                    >
                      {linkingId === item.id
                        ? "Linking…"
                        : isLinked
                          ? "Linked"
                          : "Link"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </MotionModal>
  );
}
