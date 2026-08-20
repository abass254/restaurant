"use client";

import { FloorStockScanPage } from "@/components/inventory/FloorStockScanPage";

export default function StationStockInPage() {
  return <FloorStockScanPage direction="in" backHref="/station/stock" />;
}
