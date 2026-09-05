"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { inventoryProductName } from "@/lib/trans-chap-product";
import { TransChapPanel } from "@/components/trans-chap/TransChapPanel";
import { TransChapListSkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

function stockBadge(item: InventoryItem): { label: string; tone: "ok" | "wait" | "fail" } {
  if (item.stock_quantity == null) {
    return { label: "Not tracked", tone: "ok" };
  }
  if (item.stock_quantity <= 0) {
    return { label: "Out", tone: "fail" };
  }
  if (item.is_low_stock) {
    return { label: `${item.stock_quantity} left`, tone: "wait" };
  }
  return { label: `${item.stock_quantity} in stock`, tone: "ok" };
}

export function TransChapStocksList() {
  const listId = useId();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setItems(data.data);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(extractErrorMessage(err, "Could not load stock."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      inventoryProductName(item).toLowerCase().includes(needle),
    );
  }, [items, query]);

  return (
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__filters">
        <label className="trans-chap-sales__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search stock…"
            aria-label="Search stock"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="trans-chap-sales__list">
        {loading ? (
          <TransChapListSkeleton />
        ) : error && items.length === 0 ? (
          <TransChapStatus tone="error">{error}</TransChapStatus>
        ) : items.length === 0 ? (
          <TransChapStatus
            actionHref="/trans-chap/stocks/stock-up"
            actionLabel="Stock up"
          >
            No stock yet.
          </TransChapStatus>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">No products match this search.</p>
        ) : (
          <MotionList as="div" className="trans-chap-sales__stagger">
          {filtered.map((item) => {
            const name = inventoryProductName(item);
            const open = openId === item.id;
            const panelId = `${listId}-${item.id}`;
            const price =
              item.selling_price != null ? formatKsh(item.selling_price) : "No selling price";
            return (
              <MotionItem key={item.id} as="div">
              <TransChapPanel
                id={panelId}
                open={open}
                tone="stock"
                title={name}
                subtitle={price}
                badge={stockBadge(item)}
                onToggle={() => setOpenId(open ? null : item.id)}
                action={
                  <Link
                    href={`/trans-chap/stocks/stock-up?product=${encodeURIComponent(name)}`}
                    className="trans-chap-panel__link"
                  >
                    Stock up
                  </Link>
                }
              >
                <dl className="trans-chap-panel__facts">
                  <div>
                    <dt>On hand</dt>
                    <dd>
                      {item.stock_quantity == null ? "Not tracked" : item.stock_quantity}
                    </dd>
                  </div>
                  <div>
                    <dt>Selling price</dt>
                    <dd>{price}</dd>
                  </div>
                </dl>
              </TransChapPanel>
              </MotionItem>
            );
          })}
          </MotionList>
        )}
      </div>
    </div>
  );
}
