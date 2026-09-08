"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
};

type Props = {
  scan: boolean;
  active: boolean;
  basket: PurchaseCatalogLine[];
  inventory: InventoryItem[];
  catalog: CatalogProduct[];
  inventoryLoading: boolean;
  catalogLoading: boolean;
  lastScannedKey: string | null;
  onScan: (code: string) => void;
  onAdd: (item: InventoryItem) => void;
  onAddCatalog: (product: CatalogProduct) => void;
  onQty: (key: string, quantity: number) => void;
  onContinue: () => void;
};

function unavailableHref(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return "/trans-chap/purchases/unavailable";
  return `/trans-chap/purchases/unavailable?name=${encodeURIComponent(trimmed)}`;
}

export function TransChapPurchaseCatalog({
  scan,
  active,
  basket,
  inventory,
  catalog,
  inventoryLoading,
  catalogLoading,
  lastScannedKey,
  onScan,
  onAdd,
  onAddCatalog,
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
  const hasRows = filteredShop.length > 0 || filteredCatalog.length > 0;
  const noStockYet = shopItems.length === 0 && catalog.length === 0;

  return (
    <div
      className={`trans-chap-sale-scan trans-chap-purchase-scan${
        scan ? "" : " trans-chap-sale-scan--select"
      }`}
    >
      {scan ? (
        <div className="trans-chap-sale-scan__camera">
          <TransChapBarcodeCamera active={active} onScan={onScan} />
        </div>
      ) : null}

      <div className="trans-chap-sale-scan__list">
        <div className="trans-chap-purchase-scan__search">
          <label className="trans-chap-sales__search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              placeholder={
                scan
                  ? "Search inventory or catalog…"
                  : "Search products to buy…"
              }
              aria-label="Search products"
              autoFocus={!scan}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {showUnavailableCta ? (
          <Link href={unavailableHref(draftName)} className="trans-chap-purchase-add-new">
            <i className="fa-solid fa-cart-plus" aria-hidden />
            <span>
              Purchase <strong>{draftName}</strong> as new item
            </span>
          </Link>
        ) : null}

        {loading ? (
          <p className="trans-chap-sale-scan__empty">Loading products…</p>
        ) : !hasRows ? (
          <TransChapStatus
            actionHref={unavailableHref(draftName || undefined)}
            actionLabel={draftName ? `Buy “${draftName}” as new` : "Buy a new product"}
          >
            {draftName
              ? exactExisting
                ? "That name already matches a product above — tap it to add."
                : `No match for “${draftName}”. Buy it as a new product.`
              : noStockYet
                ? "Nothing in stock or catalog yet. Buy a new product to start."
                : "No match. Try another search, or buy a new product."}
          </TransChapStatus>
        ) : (
          <ul className={`trans-chap-catalog${scan ? "" : " trans-chap-catalog--grid"}`}>
            {filteredShop.map((item) => {
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
                  className={`trans-chap-catalog__card${line ? " is-in-cart" : ""}${
                    line?.key === lastScannedKey ? " is-fresh" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="trans-chap-catalog__main"
                    onClick={() => onAdd(item)}
                  >
                    <TransChapProductThumb
                      item={item}
                      name={name}
                      size={scan ? "md" : "lg"}
                    />
                    <span className="trans-chap-catalog__copy">
                      <strong className="trans-chap-catalog__name">{name}</strong>
                      <em className="trans-chap-panel__tag">
                        {inventoryRoleShortLabel(shownRole)}
                      </em>
                      <span className="trans-chap-catalog__meta">
                        <span>{lastBuy}</span>
                        <span>Qty {onHand}</span>
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
                  ) : null}
                </li>
              );
            })}
            {filteredCatalog.map((product) => {
              const line = lineByCatalogId.get(product.id);
              const name = product.name.trim() || "Product";
              return (
                <li
                  key={`cat-${product.id}`}
                  className={`trans-chap-catalog__card${line ? " is-in-cart" : ""}${
                    line?.key === lastScannedKey ? " is-fresh" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="trans-chap-catalog__main"
                    onClick={() => onAddCatalog(product)}
                  >
                    <TransChapProductThumb
                      src={product.image_url}
                      name={name}
                      size={scan ? "md" : "lg"}
                    />
                    <span className="trans-chap-catalog__copy">
                      <strong className="trans-chap-catalog__name">{name}</strong>
                      <em className="trans-chap-panel__tag">Catalog</em>
                      <span className="trans-chap-catalog__meta">
                        <span>Not in your stock yet</span>
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
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="trans-chap-sale-scan__bar trans-chap-purchase-scan__bar">
        {basket.length ? (
          <p className="trans-chap-form__total">
            Buying {basket.length} item{basket.length === 1 ? "" : "s"}
            <strong>{total > 0 ? formatKsh(total) : "Set buying prices next"}</strong>
          </p>
        ) : (
          <p className="trans-chap-sale-scan__hint">
            Search your stock or catalog. New products use Buy new item.
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
    </div>
  );
}
