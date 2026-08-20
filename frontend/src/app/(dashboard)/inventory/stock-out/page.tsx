"use client";

import { StockScanSession } from "@/components/inventory/StockScanSession";

export default function InventoryStockOutPage() {
  return <StockScanSession direction="out" backHref="/inventory" />;
}
