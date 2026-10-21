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
  secondaryKey?: "purchases" | "expenses";
  secondaryLabel?: string;
  secondaryFill?: string;
};

function compactKsh(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

export function TransChapSalesChart({
  buckets,
  emptyText,
  height = 170,
  secondaryKey = "purchases",
  secondaryLabel,
  secondaryFill,
}: Props) {
  const hasData = buckets.some((b) => b.sales > 0 || (Number(b[secondaryKey]) || 0) > 0);
  const label = secondaryLabel || (secondaryKey === "expenses" ? "Expenses" : "Purchases");
  const fill =
    secondaryFill ||
    (secondaryKey === "expenses"
      ? "var(--trans-chap-expense, #f59e0b)"
      : "var(--trans-chap-purchase)");

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
              content={({ active, payload, label: xLabel }) => {
                if (!active || !payload || !payload.length) return null;
                const bucket = (payload[0]?.payload || {}) as ChartBucket;
                const salesAmt = Number(bucket.sales || 0);
                const secondaryAmt = Number(bucket[secondaryKey] || 0);
                const markupAmt = bucket.markup !== undefined ? Number(bucket.markup) : null;
                return (
                  <div
                    style={{
                      background: "var(--app-surface)",
                      border: "1px solid var(--app-border)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
                    }}
                  >
                    <div style={{ color: "var(--app-text)", fontWeight: 750, marginBottom: 2 }}>
                      {xLabel || bucket.label}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                      <span style={{ color: "var(--app-text-secondary)" }}>Sales:</span>
                      <strong style={{ color: "var(--trans-chap-sale)" }}>{formatKsh(salesAmt)}</strong>
                    </div>
                    {markupAmt !== null ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                        <span style={{ color: "var(--app-text-secondary)" }}>Mark up:</span>
                        <strong style={{ color: "var(--trans-chap-markup, #10b981)" }}>
                          {formatKsh(markupAmt)}
                        </strong>
                      </div>
                    ) : null}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                      <span style={{ color: "var(--app-text-secondary)" }}>{label}:</span>
                      <strong style={{ color: fill }}>{formatKsh(secondaryAmt)}</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="sales" fill="var(--trans-chap-sale)" radius={[4, 4, 0, 0]} />
            <Bar dataKey={secondaryKey} fill={fill} radius={[4, 4, 0, 0]} />
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
