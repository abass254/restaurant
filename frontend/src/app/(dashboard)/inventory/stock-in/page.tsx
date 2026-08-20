"use client";

import { StockScanSession } from "@/components/inventory/StockScanSession";

export default function InventoryStockInPage() {
  return <StockScanSession direction="in" backHref="/inventory" />;
}
