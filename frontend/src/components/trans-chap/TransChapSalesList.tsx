"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { receiptFromOrder, saveTransChapReceipt, formatKsh } from "@/lib/trans-chap-receipt";
import type { Order, OrdersListResponse } from "@/lib/types";

export function TransChapSalesList() {
  const router = useRouter();
  const user = useAuthUser();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?source=walkin&per_page=100`,
      );
      setOrders(data.data);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function openReceipt(order: Order) {
    saveTransChapReceipt(receiptFromOrder(order, shopName));
    router.push("/trans-chap/make-a-sale/receipt");
  }

  return (
    <div className="trans-chap-sales">
      <div className="trans-chap-sales__list">
        {loading ? (
          <p className="trans-chap-sales__empty">Loading sales…</p>
        ) : orders.length === 0 ? (
          <p className="trans-chap-sales__empty">No sales yet. Tap + to make a sale.</p>
        ) : (
          orders.map((order) => {
            const product = order.items?.[0]?.product_name || "Sale";
            return (
              <button
                key={order.id}
                type="button"
                className="trans-chap-sale"
                onClick={() => openReceipt(order)}
              >
                <span className="trans-chap-sale__main">
                  <strong>{product}</strong>
                  <span>
                    {order.customer_name || "Walk-in"}
                    {order.placed_at || order.created_at
                      ? ` · ${formatNairobiDateTime(order.placed_at || order.created_at)}`
                      : ""}
                  </span>
                </span>
                <strong className="trans-chap-sale__amount">
                  {formatKsh(order.total)}
                </strong>
              </button>
            );
          })
        )}
      </div>
      <Link
        href="/trans-chap/make-a-sale/new"
        className="trans-chap-fab"
        aria-label="Make a new sale"
      >
        <i className="fa-solid fa-plus" aria-hidden />
      </Link>
    </div>
  );
}
