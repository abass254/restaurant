"use client";

import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { StockScanSession } from "@/components/inventory/StockScanSession";
import { userCanAccessSection } from "@/lib/merchant-permissions";
import type { StockMovementDirection } from "@/lib/types";

type Props = {
  direction: StockMovementDirection;
  backHref: string;
};

export function FloorStockScanPage({ direction, backHref }: Props) {
  const user = useAuthUser();
  if (!userCanAccessSection(user, "inventory")) {
    return (
      <div className="station-panel">
        <h2>{direction === "in" ? "Stock in" : "Stock out"}</h2>
        <p className="lead">
          You need Inventory access to receive or issue stock.
        </p>
        <Link href={backHref} className="station-btn station-btn--ghost">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="station-panel">
      <StockScanSession
        direction={direction}
        variant="station"
        backHref={backHref}
      />
    </div>
  );
}
