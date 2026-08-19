"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatKsh } from "@/lib/trans-chap-receipt";
import { inventoryProductName } from "@/lib/trans-chap-product";
import type { InventoryItem, InventoryResponse } from "@/lib/types";

function productInitial(name: string): string {
  const match = name.trim().match(/[A-Za-z0-9]/);
  return (match?.[0] || "S").toUpperCase();
}

function stockLabel(item: InventoryItem): { label: string; tone: "ok" | "wait" | "fail" } {
  if (item.stock_quantity == null) {
    return { label: "Stock not tracked", tone: "ok" };
  }
  if (item.stock_quantity <= 0) {
    return { label: "Out of stock", tone: "fail" };
  }
  if (item.is_low_stock) {
    return { label: `${item.stock_quantity} left · low stock`, tone: "wait" };
  }
  const price =
    item.selling_price != null ? ` · ${formatKsh(item.selling_price)}` : "";
  return { label: `${item.stock_quantity} in stock${price}`, tone: "ok" };
}

export function TransChapStocksList() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setItems(data.data);
    } catch {
      setItems([]);
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
          <p className="trans-chap-sales__empty">Loading stock…</p>
        ) : items.length === 0 ? (
          <p className="trans-chap-sales__empty">No stock yet. Tap + to stock up.</p>
        ) : filtered.length === 0 ? (
          <p className="trans-chap-sales__empty">No products match this search.</p>
        ) : (
          filtered.map((item) => {
            const name = inventoryProductName(item);
            const status = stockLabel(item);
            return (
              <article key={item.id} className="trans-chap-sale">
                <div className="trans-chap-sale__row">
                  <span className="trans-chap-sale__avatar" aria-hidden>
                    {productInitial(name)}
                  </span>
                  <span className="trans-chap-sale__main">
                    <strong>{name}</strong>
                    <span className={`trans-chap-sale__status is-${status.tone}`}>
                      {status.label}
                    </span>
                  </span>
                  <Link
                    href={`/trans-chap/stocks/stock-up?product=${encodeURIComponent(name)}`}
                    className="trans-chap-sale__add"
                    aria-label={`Stock up ${name}`}
                  >
                    <i className="fa-solid fa-plus" aria-hidden />
                  </Link>
                </div>
              </article>
            );
          })
        )}
      </div>
      <Link
        href="/trans-chap/stocks/stock-up"
        className="trans-chap-fab"
        aria-label="Stock up"
      >
        <i className="fa-solid fa-plus" aria-hidden />
      </Link>
    </div>
  );
}
