"use client";

import {
  ChangeEvent,
  useId,
  useRef,
  useState,
} from "react";
import { MotionModal } from "@/components/app/MotionModal";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch } from "@/lib/api";
import {
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { InventoryImportResponse } from "@/lib/types";

type StockMode = "replace" | "add" | "keep";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

const STOCK_MODE_OPTIONS: {
  id: StockMode;
  label: string;
  hint: string;
  icon: string;
}[] = [
  {
    id: "replace",
    label: "Replace stock",
    hint: "Overwrite current stock quantity with imported quantity",
    icon: "fa-arrows-rotate",
  },
  {
    id: "add",
    label: "Add to stock",
    hint: "Add imported quantity to existing stock on hand",
    icon: "fa-plus",
  },
  {
    id: "keep",
    label: "Keep stock",
    hint: "Keep existing stock on hand; only set for new products",
    icon: "fa-shield-halved",
  },
];

export function TransChapInventoryImportModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const baseId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [stockMode, setStockMode] = useState<StockMode>("replace");
  const [uploading, setUploading] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<"xlsx" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InventoryImportResponse | null>(null);

  function resetState() {
    setFile(null);
    setStockMode("replace");
    setError(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleClose() {
    if (uploading) return;
    resetState();
    onClose();
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setError(null);
    setResult(null);
  }

  async function handleDownloadTemplate(format: "xlsx" | "csv") {
    setDownloadingFormat(format);
    try {
      const url = apiRoutes.inventoryTemplate(format);
      const res = await fetch(url, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Template download failed (${res.status})`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download =
        format === "csv"
          ? "dukai_inventory_template.csv"
          : "dukai_inventory_template.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
      await toastSuccess(
        `${format.toUpperCase()} template downloaded with instructions.`,
      );
    } catch (err) {
      await showError("Download failed", extractErrorMessage(err));
    } finally {
      setDownloadingFormat(null);
    }
  }

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const url = apiRoutes.inventoryImportWithMode(stockMode);
      const res = await apiFetch<InventoryImportResponse>(url, {
        method: "POST",
        body: form,
      });
      setResult(res);
      if (res.summary.created > 0 || res.summary.updated > 0) {
        await onSuccess();
        await toastSuccess(res.message);
      } else if (res.summary.errors > 0) {
        await showError("Import finished with errors", res.message);
      } else {
        await toastSuccess(res.message);
      }
    } catch (err) {
      setError(extractErrorMessage(err, "Import failed."));
    } finally {
      setUploading(false);
    }
  }

  const detectedEntries = result ? Object.entries(result.detected_columns) : [];

  return (
    <MotionModal
      open={open}
      onClose={handleClose}
      ariaLabelledBy={`${baseId}-title`}
      panelClassName="trans-chap-purchase-modal trans-chap-import-modal"
    >
      <header className="inventory-modal__head">
        <div className="trans-chap-purchase-modal__heading">
          <h2 id={`${baseId}-title`}>Import Inventory</h2>
          <p>
            Upload products and stock from an Excel (.xlsx) or CSV (.csv) file.
          </p>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          disabled={uploading}
          onClick={handleClose}
        >
          <i className="fa-solid fa-xmark" aria-hidden />
        </button>
      </header>

      <div className="inventory-modal__body trans-chap-purchase-modal__body">
        <div className="trans-chap-purchase-modal__grid">
          {/* Template Download Card */}
          <section className="trans-chap-import__template-card">
            <div className="trans-chap-import__template-header">
              <i className="fa-solid fa-file-circle-question" aria-hidden />
              <div>
                <strong>Need an import template?</strong>
                <p>
                  Download a pre-formatted template with column hints and sample
                  inventory rows.
                </p>
              </div>
            </div>
            <div className="trans-chap-import__template-actions">
              <button
                type="button"
                className="trans-chap-import__template-btn"
                disabled={downloadingFormat !== null}
                onClick={() => void handleDownloadTemplate("xlsx")}
              >
                <i className="fa-solid fa-file-excel" aria-hidden />
                {downloadingFormat === "xlsx"
                  ? "Downloading…"
                  : "Excel Template (.xlsx)"}
              </button>
              <button
                type="button"
                className="trans-chap-import__template-btn"
                disabled={downloadingFormat !== null}
                onClick={() => void handleDownloadTemplate("csv")}
              >
                <i className="fa-solid fa-file-csv" aria-hidden />
                {downloadingFormat === "csv"
                  ? "Downloading…"
                  : "CSV Template (.csv)"}
              </button>
            </div>
          </section>

          {/* Core Inventory / Existing Product Matching Mode */}
          <section className="trans-chap-import__section">
            <div className="trans-chap-import__section-label">
              <label>Products existing in core inventory</label>
              <span>
                Items matched by SKU, Barcode, or Name are updated without
                creating duplicates.
              </span>
            </div>
            <div
              className="trans-chap-import__mode-options"
              role="radiogroup"
              aria-label="Existing product stock mode"
            >
              {STOCK_MODE_OPTIONS.map((opt) => {
                const isSelected = stockMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={uploading || !!result}
                    className={`trans-chap-import__mode-btn${
                      isSelected ? " is-active" : ""
                    }`}
                    onClick={() => setStockMode(opt.id)}
                  >
                    <i className={`fa-solid ${opt.icon}`} aria-hidden />
                    <div className="trans-chap-import__mode-content">
                      <strong>{opt.label}</strong>
                      <small>{opt.hint}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* File Selector Dropzone */}
          <section className="trans-chap-import__section">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="trans-chap-import__file-input"
              onChange={onFileChange}
            />

            <button
              type="button"
              className="trans-chap-import__dropzone"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !!result}
            >
              <i className="fa-solid fa-cloud-arrow-up" aria-hidden />
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span>
                    {(file.size / 1024).toFixed(1)} KB — tap to choose a different
                    file
                  </span>
                </>
              ) : (
                <>
                  <strong>Choose an Excel or CSV file</strong>
                  <span>.xlsx or .csv up to 5 MB</span>
                </>
              )}
            </button>
          </section>

          {error ? (
            <TransChapStatus tone="error">{error}</TransChapStatus>
          ) : null}

          {/* Import Results Summary & Details */}
          {result ? (
            <div className="trans-chap-import__results">
              <div className="trans-chap-import__summary">
                <span className="trans-chap-import__stat--created">
                  <strong>{result.summary.created}</strong> added
                </span>
                <span className="trans-chap-import__stat--updated">
                  <strong>{result.summary.updated}</strong> updated
                </span>
                {result.summary.matched_existing ? (
                  <span className="trans-chap-import__stat--matched">
                    <strong>{result.summary.matched_existing}</strong> matched
                    core inventory
                  </span>
                ) : null}
                {result.summary.converted ? (
                  <span className="trans-chap-import__stat--converted">
                    <strong>{result.summary.converted}</strong> converted from
                    packs to pieces
                  </span>
                ) : null}
                {result.summary.warnings ? (
                  <span className="trans-chap-import__stat--warning">
                    <strong>{result.summary.warnings}</strong> need pack size
                  </span>
                ) : null}
                {result.summary.skipped ? (
                  <span>
                    <strong>{result.summary.skipped}</strong> skipped
                  </span>
                ) : null}
                {result.summary.errors ? (
                  <span className="trans-chap-import__stat--error">
                    <strong>{result.summary.errors}</strong> failed
                  </span>
                ) : null}
              </div>

              {detectedEntries.length > 0 ? (
                <details className="trans-chap-import__columns">
                  <summary>Columns detected ({detectedEntries.length})</summary>
                  <ul>
                    {detectedEntries.map(([field, header]) => (
                      <li key={field}>
                        <code>{header}</code>
                        <span> → {field.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {result.rows.length > 0 ? (
                <details
                  className="trans-chap-import__columns"
                  open={result.rows.some(
                    (r) => r.status === "error" || r.warning,
                  )}
                >
                  <summary>
                    Import row log ({result.rows.length} row
                    {result.rows.length === 1 ? "" : "s"})
                  </summary>
                  <div className="trans-chap-import__rows-wrap">
                    {result.rows.map((row) => (
                      <div
                        key={`${row.row}-${row.sku || row.name || ""}`}
                        className={`trans-chap-import__row-item trans-chap-import__row-item--${row.status}${
                          row.warning ? " trans-chap-import__row-item--warning" : ""
                        }`}
                      >
                        <span className="trans-chap-import__row-num">
                          #{row.row}
                        </span>
                        <div className="trans-chap-import__row-desc">
                          <strong>{row.name || "Unnamed"}</strong>
                          {row.sku ? <code>[{row.sku}]</code> : null}
                          <small>{row.message}</small>
                        </div>
                        {row.warning ? (
                          <span className="trans-chap-import__tag trans-chap-import__tag--warning">
                            check
                          </span>
                        ) : null}
                        <span
                          className={`trans-chap-import__tag trans-chap-import__tag--${row.status}`}
                        >
                          {row.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="trans-chap-purchase-modal__actions">
          <button
            type="button"
            className="auth-split__btn auth-split__btn--ghost"
            disabled={uploading}
            onClick={handleClose}
          >
            {result ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className="auth-split__btn auth-split__btn--primary"
            disabled={!file || uploading || !!result}
            onClick={() => void handleImport()}
          >
            {uploading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" aria-hidden />
                Importing…
              </>
            ) : (
              <>
                <i className="fa-solid fa-file-import" aria-hidden />
                Import inventory
              </>
            )}
          </button>
        </footer>
      </div>
    </MotionModal>
  );
}
