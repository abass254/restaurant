"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { orderHasSuccessfulMpesa } from "@/lib/orders";
import { loadTransChapPurchases } from "@/lib/trans-chap-purchases";
import type { Order, OrdersListResponse } from "@/lib/types";

type Slice = {
  name: string;
  value: number;
  fill: string;
};

function isPaidSale(order: Order): boolean {
  if (order.payment_method !== "mpesa") return true;
  return orderHasSuccessfulMpesa(order);
}

function isToday(iso: string | null | undefined, todayKey: string): boolean {
  const date = parseIso(iso);
  return date ? nairobiDateKey(date) === todayKey : false;
}

function compactKsh(amount: number): string {
  return `Ksh${Math.round(amount).toLocaleString("en-KE")}`;
}

function MiniPie({
  title,
  slices,
  center,
}: {
  title: string;
  slices: Slice[];
  center: string;
}) {
  const drawn = slices.some((slice) => slice.value > 0)
    ? slices.filter((slice) => slice.value > 0)
    : [{ name: "None", value: 1, fill: "var(--app-border)" }];

  return (
    <article className="trans-chap-dash__pie">
      <h3>{title}</h3>
      <div className="trans-chap-dash__pie-chart">
        <ResponsiveContainer width="100%" height={132}>
          <PieChart>
            <Pie
              data={drawn}
              dataKey="value"
              nameKey="name"
              innerRadius={34}
              outerRadius={52}
              paddingAngle={drawn.length > 1 ? 3 : 0}
              stroke="none"
            >
              {drawn.map((slice) => (
                <Cell key={slice.name} fill={slice.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <p className="trans-chap-dash__pie-center" aria-hidden>
          {center}
        </p>
      </div>
      <ul className="trans-chap-dash__pie-legend">
        {slices.map((slice) => (
          <li key={slice.name}>
            <i style={{ background: slice.fill }} aria-hidden />
            <span>{slice.name}</span>
            <strong>{compactKsh(slice.value)}</strong>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function TransChapHomePies() {
  const user = useAuthUser();
  const shopId = user.active_account?.id || user.account?.id || "local";
  const [salesTotal, setSalesTotal] = useState(0);
  const [purchaseTotal, setPurchaseTotal] = useState(0);

  const reload = useCallback(async () => {
    const todayKey = nairobiDateKey(new Date());
    try {
      const sales = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?source=walkin&per_page=100`,
      );
      const paidToday = sales.data.filter((order) => {
        if (!isPaidSale(order)) return false;
        return isToday(order.paid_at || order.placed_at || order.created_at, todayKey);
      });
      setSalesTotal(paidToday.reduce((sum, order) => sum + order.total, 0));
    } catch {
      setSalesTotal(0);
    }
    const boughtToday = loadTransChapPurchases(shopId).filter((row) =>
      isToday(row.paidAt, todayKey),
    );
    setPurchaseTotal(boughtToday.reduce((sum, row) => sum + row.total, 0));
  }, [shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const profit = Math.max(0, salesTotal - purchaseTotal);
  const expense = purchaseTotal;

  const salesVsPurchases = useMemo<Slice[]>(
    () => [
      { name: "Sales", value: salesTotal, fill: "var(--trans-chap-sale)" },
      { name: "Purchases", value: purchaseTotal, fill: "var(--trans-chap-cash)" },
    ],
    [purchaseTotal, salesTotal],
  );

  const profitVsExpense = useMemo<Slice[]>(
    () => [
      { name: "Profit", value: profit, fill: "var(--trans-chap-mpesa)" },
      { name: "Expense", value: expense, fill: "#c45c6a" },
    ],
    [expense, profit],
  );

  return (
    <section className="trans-chap-dash__pies" aria-label="Today’s sales and purchases">
      <MiniPie
        title="Sales vs purchases"
        slices={salesVsPurchases}
        center={compactKsh(salesTotal)}
      />
      <MiniPie
        title="Profit vs expense"
        slices={profitVsExpense}
        center={compactKsh(profit)}
      />
    </section>
  );
}
