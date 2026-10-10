"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TransChapBarcodeCamera } from "@/components/trans-chap/TransChapBarcodeCamera";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import {
  canPurchaseInventoryItem,
  inventoryProductName,
  inventoryRole,
  inventoryRoleShortLabel,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { CatalogProduct, InventoryItem, InventoryRole } from "@/lib/types";

export type PurchaseCatalogLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  catalogProductId: string | null;
  quantity: number;
  unitCost: number;
  role: InventoryRole;
  sku?: string | null;
  productCode?: string | null;
};

type Props = {
  scan: boolean;
  active: boolean;
  /** POS-like workspace: catalog only (parent owns the cart panel). */
  workspace?: boolean;
  basket: PurchaseCatalogLine[];
  inventory: InventoryItem[];
  catalog: CatalogProduct[];
  inventoryLoading: boolean;
  catalogLoading: boolean;
  lastScannedKey: string | null;
  onScan: (code: string) => void;
  onAdd: (item: InventoryItem) => void;
  onAddCatalog: (product: CatalogProduct) => void;
  onAddNew: (name: string) => void;
  onRequestBuyNew?: (name?: string) => void;
  onQty: (key: string, quantity: number) => void;
  onContinue: () => void;
};

export function TransChapPurchaseCatalog({
  scan,
  active,
  workspace = false,
  basket,
  inventory,
  catalog,
  inventoryLoading,
  catalogLoading,
  lastScannedKey,
  onScan,
  onAdd,
  onAddCatalog,
  onAddNew,
  onRequestBuyNew,
  onQty,
  onContinue,
}: Props) {
  const [query, setQuery] = useState("");
  const total = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [basket],
  );
  const lineByInventoryId = useMemo(() => {
    const map = new Map<string, PurchaseCatalogLine>();
    for (const line of basket) {
      if (line.inventoryItemId) map.set(line.inventoryItemId, line);
    }
    return map;
  }, [basket]);
  const lineByCatalogId = useMemo(() => {
    const map = new Map<string, PurchaseCatalogLine>();
    for (const line of basket) {
      if (line.catalogProductId) map.set(line.catalogProductId, line);
    }
    return map;
  }, [basket]);
  const inventoryByProductId = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of inventory) {
      if (item.product_id) map.set(item.product_id, item);
    }
    return map;
  }, [inventory]);
  const shopItems = useMemo(
    () => inventory.filter(canPurchaseInventoryItem),
    [inventory],
  );
  const filteredShop = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return shopItems.filter((item) => {
      if (!needle) return true;
      const name = inventoryProductName(item).toLowerCase();
      const sku = (item.product?.sku ?? "").toLowerCase();
      const code = (item.product?.product_code ?? "").toLowerCase();
      const category = (item.product?.category ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        code.includes(needle) ||
        category.includes(needle)
      );
    });
  }, [shopItems, query]);
  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((product) => {
      if (inventoryByProductId.has(product.id)) return false;
      if (!needle) return true;
      const name = product.name.toLowerCase();
      const sku = (product.sku ?? "").toLowerCase();
      const code = (product.product_code ?? "").toLowerCase();
      const category = (product.category ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        code.includes(needle) ||
        category.includes(needle)
      );
    });
  }, [catalog, inventoryByProductId, query]);

  const PAGE_SIZE = 24;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const visibleShop = useMemo(() => {
    return filteredShop.slice(0, visibleCount);
  }, [filteredShop, visibleCount]);

  const remainingCatalogQuota = Math.max(0, visibleCount - filteredShop.length);

  const visibleCatalog = useMemo(() => {
    if (remainingCatalogQuota <= 0) return [];
    return filteredCatalog.slice(0, remainingCatalogQuota);
  }, [filteredCatalog, remainingCatalogQuota]);

  const totalAvailable = filteredShop.length + filteredCatalog.length;
  const totalRendered = visibleShop.length + visibleCatalog.length;
  const hasMore = totalRendered < totalAvailable;

  const sentinelRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    const target = sentinelRef.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, totalAvailable));
        }
      },
      { rootMargin: "400px" },
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, totalAvailable]);

  useEffect(() => {
    if (!hasMore) return;
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 500
      ) {
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, totalAvailable));
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [hasMore, totalAvailable]);

  const draftName = query.trim();
  const exactExisting =
    Boolean(draftName) &&
    (shopItems.some(
      (item) => inventoryProductName(item).toLowerCase() === draftName.toLowerCase(),
    ) ||
      catalog.some(
        (product) =>
          !inventoryByProductId.has(product.id) &&
          product.name.trim().toLowerCase() === draftName.toLowerCase(),
      ));
  const showUnavailableCta = Boolean(draftName) && !exactExisting;

  const loading = inventoryLoading || catalogLoading;
  const newBasketLines = useMemo(
    () =>
      basket.filter((line) => !line.inventoryItemId && !line.catalogProductId),
    [basket],
  );
  const hasRows =
    filteredShop.length > 0 ||
    filteredCatalog.length > 0 ||
    newBasketLines.length > 0;
  const noStockYet = shopItems.length === 0 && catalog.length === 0;
  const compact = workspace || !scan;

  function requestBuyNew(name?: string) {
    if (onRequestBuyNew) {
      onRequestBuyNew(name);
      return;
    }
    if (name?.trim()) onAddNew(name.trim());
  }

  if (scan && !workspace) {
    return (
      <div className="trans-chap-sale-scan trans-chap-purchase-scan">
        <div className="trans-chap-sale-scan__camera">
          <TransChapBarcodeCamera active={active} onScan={onScan} />
        </div>
        <div className="trans-chap-sale-scan__list">
          <div className="trans-chap-purchase-scan__search">
            <label className="trans-chap-sales__search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="Search inventory or type a new name…"
                aria-label="Search products"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (!showUnavailableCta) return;
                  requestBuyNew(draftName);
                  setQuery("");
                }}
              />
            </label>
          </div>
          {renderAddCta()}
          {renderProductList(false)}
        </div>
        {renderBar()}
      </div>
    );
  }

  return (
    <div
      className={
        workspace
          ? "trans-chap-purchase-catalog"
          : "trans-chap-sale-scan trans-chap-purchase-scan trans-chap-sale-scan--select"
      }
    >
      <div
        className={
          workspace
            ? "trans-chap-purchase-catalog__body"
            : "trans-chap-sale-scan__list"
        }
      >
        <div className="trans-chap-purchase-scan__search">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search products, SKU, or barcode…"
              aria-label="Search products"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (!showUnavailableCta) return;
                requestBuyNew(draftName);
                setQuery("");
              }}
            />
          </label>
          <button
            type="button"
            className="trans-chap-purchase-catalog__new-btn"
            onClick={() => requestBuyNew(draftName || undefined)}
          >
            <i className="fa-solid fa-plus" aria-hidden />
            New product
          </button>
        </div>
        {renderAddCta()}
        {renderProductList(compact)}
      </div>
      {workspace ? null : renderBar()}
    </div>
  );

  function renderAddCta() {
    if (showUnavailableCta) {
      return (
        <button
          type="button"
          className="trans-chap-purchase-add-new"
          onClick={() => {
            requestBuyNew(draftName);
            setQuery("");
          }}
        >
          <i className="fa-solid fa-cart-plus" aria-hidden />
          <span>
            Add <strong>{draftName}</strong> as new product
          </span>
        </button>
      );
    }
    if (draftName || workspace) return null;
    return (
      <p className="trans-chap-purchase-add-new-hint">
        Not in inventory? Type a name above, or tap{" "}
        <button
          type="button"
          className="trans-chap-purchase-add-new-hint__link"
          onClick={() => requestBuyNew()}
        >
          New product
        </button>
        .
      </p>
    );
  }

  function renderProductList(useCompact: boolean) {
    if (loading) {
      return <p className="trans-chap-sale-scan__empty">Loading products…</p>;
    }
    if (!hasRows) {
      if (draftName && !exactExisting) {
        return (
          <p className="trans-chap-sale-scan__empty">
            No match for “{draftName}”. Add it as a new product above.
          </p>
        );
      }
      return (
        <TransChapStatus
          actionLabel="Buy a new product"
          onAction={() => requestBuyNew(draftName || undefined)}
        >
          {draftName
            ? "That name already matches a product above — tap it to add."
            : noStockYet
              ? "Nothing in stock or catalog yet. Add a new product to start."
              : "No match. Try another search, or add a new product."}
        </TransChapStatus>
      );
    }

    if (useCompact) {
      return (
        <ul className="trans-chap-purchase-cards">
          {newBasketLines.map((line) => (
            <li
              key={`new-${line.key}`}
              className={`trans-chap-purchase-card is-in-cart is-new-product${
                line.key === lastScannedKey ? " is-fresh" : ""
              }`}
            >
              <div className="trans-chap-purchase-card__main">
                <TransChapProductThumb name={line.productName} size="sm" />
                <span className="trans-chap-purchase-card__info">
                  <strong className="trans-chap-purchase-card__name">
                    {line.productName}
                  </strong>
                  <span className="trans-chap-purchase-card__meta">New product</span>
                </span>
              </div>
              <div className="trans-chap-sale-scan__qty">
                <button
                  type="button"
                  aria-label={`Decrease ${line.productName}`}
                  onClick={() => onQty(line.key, line.quantity - 1)}
                >
                  −
                </button>
                <span>{line.quantity}</span>
                <button
                  type="button"
                  aria-label={`Increase ${line.productName}`}
                  onClick={() => onQty(line.key, line.quantity + 1)}
                >
                  +
                </button>
              </div>
            </li>
          ))}
          {visibleShop.map((item) => {
            const name = inventoryProductName(item);
            const line = lineByInventoryId.get(item.id);
            const shownRole = line?.role ?? inventoryRole(item);
            const lastBuy =
              item.buying_price != null
                ? formatKsh(item.buying_price)
                : "No buy price";
            const onHand =
              item.stock_quantity == null ? "—" : String(item.stock_quantity);
            return (
              <li
                key={`inv-${item.id}`}
                className={`trans-chap-purchase-card${line ? " is-in-cart" : ""}${
                  line?.key === lastScannedKey ? " is-fresh" : ""
                }`}
              >
                <button
                  type="button"
                  className="trans-chap-purchase-card__main"
                  onClick={() => onAdd(item)}
                >
                  <TransChapProductThumb item={item} name={name} size="sm" />
                  <span className="trans-chap-purchase-card__info">
                    <strong className="trans-chap-purchase-card__name">{name}</strong>
                    <span className="trans-chap-purchase-card__meta">
                      {inventoryRoleShortLabel(shownRole)} · {lastBuy} · Stock {onHand}
                    </span>
                  </span>
                </button>
                {line ? (
                  <div className="trans-chap-sale-scan__qty">
                    <button
                      type="button"
                      aria-label={`Decrease ${name}`}
                      onClick={() => onQty(line.key, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${name}`}
                      onClick={() => onQty(line.key, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="trans-chap-purchase-card__add"
                    aria-label={`Add ${name}`}
                    onClick={() => onAdd(item)}
                  >
                    <i className="fa-solid fa-plus" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
          {visibleCatalog.map((product) => {
            const line = lineByCatalogId.get(product.id);
            const name = product.name.trim() || "Product";
            return (
              <li
                key={`cat-${product.id}`}
                className={`trans-chap-purchase-card${line ? " is-in-cart" : ""}${
                  line?.key === lastScannedKey ? " is-fresh" : ""
                }`}
              >
                <button
                  type="button"
                  className="trans-chap-purchase-card__main"
                  onClick={() => onAddCatalog(product)}
                >
                  <TransChapProductThumb name={name} size="sm" />
                  <span className="trans-chap-purchase-card__info">
                    <strong className="trans-chap-purchase-card__name">{name}</strong>
                    <span className="trans-chap-purchase-card__meta">
                      Catalog · Not in stock yet
                    </span>
                  </span>
                </button>
                {line ? (
                  <div className="trans-chap-sale-scan__qty">
                    <button
                      type="button"
                      aria-label={`Decrease ${name}`}
                      onClick={() => onQty(line.key, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${name}`}
                      onClick={() => onQty(line.key, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="trans-chap-purchase-card__add"
                    aria-label={`Add ${name}`}
                    onClick={() => onAddCatalog(product)}
                  >
                    <i className="fa-solid fa-plus" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
          {hasMore && (
            <li
              ref={sentinelRef}
              style={{
                gridColumn: "1 / -1",
                listStyle: "none",
                padding: "1rem 0.5rem",
                textAlign: "center",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((prev) =>
                    Math.min(prev + PAGE_SIZE, totalAvailable),
                  )
                }
                style={{
                  background: "var(--app-surface)",
                  border: "1px solid var(--app-border-light)",
                  borderRadius: "999px",
                  padding: "0.5rem 1.25rem",
                  fontSize: "0.85rem",
                  fontWeight: 650,
                  color: "var(--app-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Showing {totalRendered} of {totalAvailable} · Scroll for more
              </button>
            </li>
          )}
        </ul>
      );
    }

    return null;
  }

  function renderBar() {
    return (
      <div className="trans-chap-sale-scan__bar trans-chap-purchase-scan__bar">
        {basket.length ? (
          <p className="trans-chap-form__total">
            Buying {basket.length} item{basket.length === 1 ? "" : "s"}
            <strong>{total > 0 ? formatKsh(total) : "Set buying prices next"}</strong>
          </p>
        ) : (
          <p className="trans-chap-sale-scan__hint">
            Search stock or catalog, or add a new product.
          </p>
        )}
        <button
          type="button"
          className="auth-split__btn"
          disabled={basket.length === 0}
          onClick={onContinue}
        >
          Continue to buying costs
        </button>
      </div>
    );
  }
}
