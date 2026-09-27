"use client";

import { useState } from "react";
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(resolved && failedSrc !== resolved);
  return (
    <span className={`trans-chap-thumb trans-chap-thumb--${size}`} aria-hidden>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolved} alt="" onError={() => setFailedSrc(resolved)} />
      ) : (
        <em>{initial}</em>
      )}
    </span>
  );
}
