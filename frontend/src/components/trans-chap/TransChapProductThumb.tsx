"use client";

import { resolveAssetUrl } from "@/lib/config";
import { inventoryCoverUrl, inventoryProductName } from "@/lib/trans-chap-product";
import type { InventoryItem } from "@/lib/types";

export function TransChapProductThumb({
  item,
  src,
  name,
  size = "md",
}: {
  item?: InventoryItem | null;
  src?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg";
}) {
  const label = name || (item ? inventoryProductName(item) : "Product");
  const cover = src ?? (item ? inventoryCoverUrl(item) : null);
  const resolved = cover ? resolveAssetUrl(cover) : "";
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={`trans-chap-thumb trans-chap-thumb--${size}`} aria-hidden>
      {resolved ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolved} alt="" />
      ) : (
        <em>{initial}</em>
      )}
    </span>
  );
}
