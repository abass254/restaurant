"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatMoney } from "@/lib/orders";
import type {
  InventoryItem,
  InventoryItemMutationResponse,
  InventoryResponse,
} from "@/lib/types";

export function QuickStockPanel() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setItems(res.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Could not load inventory."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const name = item.product?.name?.toLowerCase() ?? "";
      const sku = item.product?.sku?.toLowerCase() ?? "";
      return name.includes(q) || sku.includes(q);
    });
  }, [items, query]);

  async function patchItem(
    item: InventoryItem,
    body: { is_active?: boolean; stock_quantity?: number },
  ) {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await apiFetch<InventoryItemMutationResponse>(
        apiRoutes.inventoryItem(item.id),
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? res.data : row)),
      );
    } catch (err) {
      setError(extractErrorMessage(err, "Could not update item."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products…"
        aria-label="Search products"
        style={{
          width: "100%",
          marginBottom: "0.85rem",
          padding: "0.75rem 0.9rem",
          borderRadius: 12,
          border: "1px solid var(--station-border)",
          background: "var(--station-surface)",
          color: "var(--station-text)",
        }}
      />
      {error && (
        <div className="station-banner" style={{ borderRadius: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="station-empty">Loading inventory…</div>
      ) : filtered.length === 0 ? (
        <div className="station-empty">No matching items.</div>
      ) : (
        <div className="mobile-card" style={{ maxHeight: "70dvh", overflow: "auto" }}>
          {filtered.map((item) => {
            const oos = !item.is_active || (item.stock_quantity ?? 1) <= 0;
            return (
              <div key={item.id} className="stock-item">
                <div>
                  <strong>{item.product?.name ?? "Item"}</strong>
                  <div style={{ color: "var(--station-muted)", fontSize: "0.82rem" }}>
                    {item.selling_price != null
                      ? formatMoney(item.selling_price)
                      : "—"}{" "}
                    · stock {item.stock_quantity ?? "—"}
                    {oos ? " · OOS" : ""}
                  </div>
                </div>
                <div className="station-ticket__actions">
                  {oos ? (
                    <button
                      type="button"
                      className="station-btn station-btn--primary"
                      disabled={busyId === item.id}
                      onClick={() =>
                        void patchItem(item, {
                          is_active: true,
                          stock_quantity: Math.max(1, item.stock_quantity ?? 1),
                        })
                      }
                    >
                      Restock
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="station-btn station-btn--danger"
                      disabled={busyId === item.id}
                      onClick={() =>
                        void patchItem(item, {
                          is_active: false,
                          stock_quantity: 0,
                        })
                      }
                    >
                      86 / OOS
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
