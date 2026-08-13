"use client";

import { QuickStockPanel } from "@/components/station/QuickStockPanel";

export default function MobileStockPage() {
  return (
    <>
      <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.15rem" }}>Quick stock</h2>
      <p style={{ margin: "0 0 1rem", color: "var(--station-muted)", fontSize: "0.9rem" }}>
        Mark items 86 / out of stock in one tap.
      </p>
      <QuickStockPanel />
    </>
  );
}
