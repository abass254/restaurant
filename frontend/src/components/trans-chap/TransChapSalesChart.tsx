"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { ChartBucket } from "@/lib/trans-chap-range";

type Props = {
  buckets: ChartBucket[];
  emptyText: string;
  height?: number;
};

function compactKsh(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

export function TransChapSalesChart({ buckets, emptyText, height = 170 }: Props) {
  const hasData = buckets.some((b) => b.sales > 0 || b.purchases > 0);

  return (
    <div className="trans-chap-chart" style={{ minHeight: height }}>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={buckets}
            barGap={2}
            barCategoryGap={buckets.length > 14 ? "12%" : "22%"}
            margin={{ top: 6, right: 4, bottom: 0, left: -18 }}
          >
            <CartesianGrid vertical={false} stroke="var(--app-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={12}
              tick={{ fill: "var(--app-text-secondary)", fontSize: 10 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={compactKsh}
              tick={{ fill: "var(--app-text-secondary)", fontSize: 10 }}
            />
            <Tooltip
              cursor={{ fill: "color-mix(in srgb, var(--app-text) 6%, transparent)" }}
              formatter={(value: number, name: string) => [
                formatKsh(value),
                name === "sales" ? "Sales" : "Purchases",
              ]}
              contentStyle={{
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--app-text)", fontWeight: 700 }}
              itemStyle={{ color: "var(--app-text)" }}
            />
            <Bar dataKey="sales" fill="var(--trans-chap-sale)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="purchases" fill="var(--trans-chap-purchase)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="trans-chap-chart__empty" style={{ minHeight: height }}>
          {emptyText}
        </p>
      )}
    </div>
  );
}
