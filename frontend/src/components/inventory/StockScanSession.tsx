"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarcodeScannerSheet } from "@/components/inventory/BarcodeScannerSheet";
import { useBarcodeWedge } from "@/hooks/useBarcodeWedge";
import { apiFetch } from "@/lib/api";
import {
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { findInventoryByBarcode } from "@/lib/barcode";
import { apiRoutes } from "@/lib/config";
import type {
  InventoryItem,
  InventoryResponse,
  StockMovementDirection,
  StockMovementReason,
  StockMovementsResponse,
} from "@/lib/types";

export type StockScanSessionVariant = "dashboard" | "station";

type SessionLine = {
  item: InventoryItem;
  quantity: number;
};

type StockScanSessionProps = {
  direction: StockMovementDirection;
  variant?: StockScanSessionVariant;
  backHref?: string;
};

const IN_REASONS: Array<{ value: StockMovementReason; label: string }> = [
  { value: "receive", label: "Receive / restock" },
  { value: "adjustment", label: "Adjustment" },
  { value: "other", label: "Other" },
];

const OUT_REASONS: Array<{ value: StockMovementReason; label: string }> = [
  { value: "adjustment", label: "Adjustment" },
  { value: "damage", label: "Damage / waste" },
  { value: "other", label: "Other" },
];

function isTrackedProduct(item: InventoryItem): boolean {
  if (item.product?.product_type === "service") return false;
  return item.stock_quantity != null;
}

export function StockScanSession({
  direction,
  variant = "dashboard",
  backHref = "/inventory",
}: StockScanSessionProps) {
  const isIn = direction === "in";
  const title = isIn ? "Stock in" : "Stock out";
  const reasons = isIn ? IN_REASONS : OUT_REASONS;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<SessionLine[]>([]);
  const [reason, setReason] = useState<StockMovementReason>(
    isIn ? "receive" : "adjustment",
  );
  const [note, setNote] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setItems(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load inventory."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const lineCount = lines.length;
  const unitCount = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  const handleScan = useCallback(
    (code: string) => {
      const scanned = code.trim();
      if (!scanned) return;

      const matched = findInventoryByBarcode(items, scanned);
      if (!matched) {
        void showError(
          "Barcode not found",
          `No product matched "${scanned}". Set SKU / Barcode on the product in Inventory.`,
        );
        return;
      }

      if (!isTrackedProduct(matched)) {
        void showError(
          "Stock not tracked",
          `"${matched.product?.name ?? "This item"}" is a service or has unlimited stock. Set a quantity in Inventory first.`,
        );
        return;
      }

      let blocked = false;
      setLines((prev) => {
        const existing = prev.find((line) => line.item.id === matched.id);
        const nextQty = (existing?.quantity ?? 0) + 1;
        if (!isIn) {
          const onHand = matched.stock_quantity ?? 0;
          if (nextQty > onHand) {
            blocked = true;
            return prev;
          }
        }
        if (!existing) {
          return [...prev, { item: matched, quantity: 1 }];
        }
        return prev.map((line) =>
          line.item.id === matched.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      });

      if (blocked) {
        void showError(
          "Not enough stock",
          `"${matched.product?.name ?? "Item"}" only has ${matched.stock_quantity ?? 0} on hand.`,
        );
        return;
      }

      void toastSuccess(`Scanned: ${matched.product?.name ?? "item"}`);
    },
    [isIn, items],
  );

  useBarcodeWedge({
    enabled: !cameraOpen && !committing,
    onScan: handleScan,
  });

  function setLineQty(itemId: string, quantity: number) {
    const qty = Math.max(1, Math.floor(quantity || 1));
    setLines((prev) =>
      prev.map((line) => {
        if (line.item.id !== itemId) return line;
        if (!isIn) {
          const onHand = line.item.stock_quantity ?? 0;
          return { ...line, quantity: Math.min(qty, Math.max(1, onHand)) };
        }
        return { ...line, quantity: qty };
      }),
    );
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((line) => line.item.id !== itemId));
  }

  async function commitSession() {
    if (lines.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await apiFetch<StockMovementsResponse>(
        apiRoutes.inventoryStockMovements,
        {
          method: "POST",
          body: JSON.stringify({
            direction,
            reason,
            note: note.trim() || null,
            lines: lines.map((line) => ({
              inventory_item_id: line.item.id,
              quantity: line.quantity,
            })),
          }),
        },
      );
      setLines([]);
      setNote("");
      await reload();
      void toastSuccess(res.message);
    } catch (err) {
      const message = extractErrorMessage(err, "Could not commit stock movement.");
      setError(message);
      await showError("Commit failed", message);
    } finally {
      setCommitting(false);
    }
  }

  const shellClass =
    variant === "station"
      ? "stock-scan stock-scan--station"
      : "stock-scan app-panel inventory-panel";

  return (
    <section className={shellClass}>
      <header className="stock-scan__header">
        <div>
          {variant === "dashboard" ? (
            <p className="stock-scan__crumb">
              <Link href={backHref}>Inventory</Link>
              <span aria-hidden="true"> / </span>
              {title}
            </p>
          ) : null}
          <h1 className={variant === "dashboard" ? "app-title" : undefined}>
            {title}
          </h1>
          <p className={variant === "dashboard" ? "app-lead" : "lead"}>
            Scan barcodes to build a list, then commit once. USB scanners work
            automatically; use the camera on phones.
          </p>
        </div>
        <div className="stock-scan__header-actions">
          <button
            type="button"
            className={
              variant === "station"
                ? "station-btn station-btn--ghost"
                : "btn btn-ghost btn-sm"
            }
            onClick={() => setCameraOpen(true)}
          >
            <i className="fa-solid fa-camera" aria-hidden="true" />
            Camera
          </button>
          {variant === "dashboard" ? (
            <Link href={backHref} className="btn btn-ghost btn-sm">
              Back
            </Link>
          ) : (
            <Link href={backHref} className="station-btn station-btn--ghost">
              Back
            </Link>
          )}
        </div>
      </header>

      <div className="stock-scan__controls">
        <label className="stock-scan__field">
          <span>Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as StockMovementReason)}
          >
            {reasons.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="stock-scan__field stock-scan__field--grow">
          <span>Note (optional)</span>
          <input
            type="text"
            value={note}
            maxLength={500}
            placeholder="e.g. Supplier delivery"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <form
        className="stock-scan__manual"
        onSubmit={(e) => {
          e.preventDefault();
          const code = manualCode.trim();
          if (!code) return;
          handleScan(code);
          setManualCode("");
        }}
      >
        <input
          type="text"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="Type or paste a barcode / SKU"
          aria-label="Manual barcode entry"
          autoComplete="off"
        />
        <button
          type="submit"
          className={
            variant === "station"
              ? "station-btn station-btn--primary"
              : "btn btn-primary btn-sm"
          }
        >
          Add
        </button>
      </form>

      {error ? <div className="app-error stock-scan__error">{error}</div> : null}
      {loading ? (
        <p className="app-muted">Loading inventory…</p>
      ) : (
        <p className="stock-scan__status">
          {lineCount === 0
            ? "Waiting for scans…"
            : `${lineCount} line${lineCount === 1 ? "" : "s"} · ${unitCount} unit${unitCount === 1 ? "" : "s"}`}
        </p>
      )}

      {lines.length > 0 ? (
        <ul className="stock-scan__lines">
          {lines.map((line) => (
            <li key={line.item.id} className="stock-scan__line">
              <div className="stock-scan__line-meta">
                <strong>{line.item.product?.name ?? "Product"}</strong>
                <span>
                  On hand {line.item.stock_quantity ?? "—"}
                  {line.item.product?.sku
                    ? ` · ${line.item.product.sku}`
                    : ""}
                </span>
              </div>
              <div className="stock-scan__line-actions">
                <button
                  type="button"
                  className="stock-scan__qty-btn"
                  aria-label="Decrease quantity"
                  onClick={() =>
                    setLineQty(line.item.id, Math.max(1, line.quantity - 1))
                  }
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="stock-scan__qty-input"
                  value={line.quantity}
                  onChange={(e) =>
                    setLineQty(line.item.id, Number(e.target.value))
                  }
                />
                <button
                  type="button"
                  className="stock-scan__qty-btn"
                  aria-label="Increase quantity"
                  onClick={() => setLineQty(line.item.id, line.quantity + 1)}
                >
                  +
                </button>
                <button
                  type="button"
                  className="stock-scan__remove"
                  aria-label="Remove line"
                  onClick={() => removeLine(line.item.id)}
                >
                  <i className="fa-solid fa-trash" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="stock-scan__footer">
        <button
          type="button"
          className={
            variant === "station"
              ? "station-btn station-btn--ghost"
              : "btn btn-ghost"
          }
          disabled={lines.length === 0 || committing}
          onClick={() => setLines([])}
        >
          Clear
        </button>
        <button
          type="button"
          className={
            variant === "station"
              ? "station-btn station-btn--primary station-btn--lg"
              : "btn btn-primary"
          }
          disabled={lines.length === 0 || committing || loading}
          onClick={() => void commitSession()}
        >
          {committing
            ? "Saving…"
            : isIn
              ? `Commit stock in (${unitCount})`
              : `Commit stock out (${unitCount})`}
        </button>
      </div>

      <BarcodeScannerSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={handleScan}
        title={isIn ? "Scan to stock in" : "Scan to stock out"}
      />
    </section>
  );
}
