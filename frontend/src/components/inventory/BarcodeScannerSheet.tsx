"use client";

import { BarcodeCamera } from "@/components/inventory/BarcodeCamera";

type BarcodeScannerSheetProps = {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
};

export function BarcodeScannerSheet({
  open,
  onClose,
  onScan,
  title = "Scan barcode",
}: BarcodeScannerSheetProps) {
  if (!open) return null;

  return (
    <div className="stock-scan-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="stock-scan-sheet__backdrop" onClick={onClose} />
      <div className="stock-scan-sheet__panel">
        <header className="stock-scan-sheet__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="stock-scan-sheet__viewport">
          <BarcodeCamera active={open} onScan={onScan} />
        </div>
        <p className="stock-scan-sheet__hint">
          Point at a barcode. You can also use a USB / Bluetooth scanner without the camera.
        </p>
      </div>
    </div>
  );
}
