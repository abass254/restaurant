"use client";

import { QuickStockPanel } from "@/components/station/QuickStockPanel";

export default function StationStockPage() {
  return (
    <div className="station-panel">
      <h2>Quick stock</h2>
      <p className="lead">Mark items out of stock without leaving the station.</p>
      <QuickStockPanel stockBasePath="/station/stock" />
    </div>
  );
}
