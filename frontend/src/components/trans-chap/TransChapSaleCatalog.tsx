"use client";

import { useMemo, useState } from "react";
import { BarcodeCamera } from "@/components/inventory/BarcodeCamera";
import { TransChapProductThumb } from "@/components/trans-chap/TransChapProductThumb";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import {
  canSellInventoryItem,
  inventoryProductName,
  inventoryRole,
  isHotelMenuItem,
  isSaleableRole,
} from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem } from "@/lib/types";

export type SaleCatalogLine = {
  key: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  unitPrice: number;
};

type Props = {
  scan: boolean;
  active: boolean;
  basket: SaleCatalogLine[];
  inventory: InventoryItem[];
  inventoryLoading: boolean;
  lastScannedKey: string | null;
  onScan: (code: string) => void;
  onAdd: (item: InventoryItem) => void;
  onQty: (key: string, quantity: number) => void;
  onContinue: () => void;
};

export function TransChapSaleCatalog({
  scan,
  active,
  basket,
  inventory,
  inventoryLoading,
  lastScannedKey,
  onScan,
  onAdd,
  onQty,
  onContinue,
}: Props) {
  const [query, setQuery] = useState("");
  const total = useMemo(
    () => basket.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [basket],
  );
  const qtyById = useMemo(() => {
    const map = new Map<string, SaleCatalogLine>();
    for (const line of basket) {
      if (line.inventoryItemId) map.set(line.inventoryItemId, line);
    }
    return map;
  }, [basket]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inventory.filter((item) => {
      if (!item.is_active) return false;
      if (!isSaleableRole(inventoryRole(item))) return false;
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
  }, [inventory, query]);

  return (
    <div className={`trans-chap-sale-scan${scan ? "" : " trans-chap-sale-scan--select"}`}>
      {scan ? (
        <div className="trans-chap-sale-scan__camera">
          <BarcodeCamera active={active} onScan={onScan} />
        </div>
      ) : null}

      <div className="trans-chap-sale-scan__list">
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={scan ? "Search or scan a product…" : "Search inventory…"}
            aria-label="Search inventory"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {inventoryLoading ? (
          <p className="trans-chap-sale-scan__empty">Loading inventory…</p>
        ) : filtered.length === 0 ? (
          <TransChapStatus
            actionHref={inventory.length === 0 ? "/trans-chap/purchases/new" : undefined}
            actionLabel={inventory.length === 0 ? "Record a purchase" : undefined}
          >
            {inventory.length === 0
              ? "No active inventory yet. Buy stock first, then set selling prices in Inventory."
              : "No items match this search."}
          </TransChapStatus>
        ) : (
          <ul className={`trans-chap-catalog${scan ? "" : " trans-chap-catalog--grid"}`}>
            {filtered.map((item) => {
              const name = inventoryProductName(item);
              const line = qtyById.get(item.id);
              const canSell = canSellInventoryItem(item);
              const hotel = isHotelMenuItem(item);
              const out =
                !hotel && item.stock_quantity != null && item.stock_quantity <= 0;
              const noPrice = item.selling_price == null || item.selling_price <= 0;
              return (
                <li
                  key={item.id}
                  className={`trans-chap-catalog__card${line ? " is-in-cart" : ""}${
                    line?.key === lastScannedKey ? " is-fresh" : ""
                  }${!canSell ? " is-disabled" : ""}`}
                >
                  <button
                    type="button"
                    className="trans-chap-catalog__main"
                    disabled={!canSell}
                    onClick={() => onAdd(item)}
                  >
                    <TransChapProductThumb item={item} name={name} size={scan ? "md" : "lg"} />
                    <span className="trans-chap-catalog__copy">
                      <strong>
                        {name}
                        {hotel ? (
                          <em className="trans-chap-panel__tag">Hotel</em>
                        ) : null}
                      </strong>
                      <span>
                        {out
                          ? "Out of stock"
                          : noPrice
                            ? "No price"
                            : formatKsh(item.selling_price ?? 0)}
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

      <div className="trans-chap-sale-scan__bar">
        {basket.length ? (
          <p className="trans-chap-form__total">
            {basket.length} item{basket.length === 1 ? "" : "s"}
            <strong>{formatKsh(total)}</strong>
          </p>
        ) : (
          <p className="trans-chap-sale-scan__hint">
            {scan ? "Scan a barcode or tap a product." : "Tap products to add them."}
          </p>
        )}
        <button
          type="button"
          className="auth-split__btn"
          disabled={basket.length === 0 || total <= 0}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
