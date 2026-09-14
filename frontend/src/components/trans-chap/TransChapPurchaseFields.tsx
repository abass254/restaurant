"use client";

import { ChangeEvent, useMemo } from "react";
import { TransChapSupplierField } from "@/components/trans-chap/TransChapSupplierField";
import { showError } from "@/lib/alerts";

export type PurchaseStatus = "received" | "pending" | "ordered";
export type PayTermUnit = "days" | "months";

export type PurchaseMeta = {
  supplier: string;
  supplierAddress: string;
  referenceNo: string;
  purchaseDate: string;
  purchaseStatus: PurchaseStatus;
  businessLocation: string;
  payTerm: string;
  payTermUnit: PayTermUnit;
  documentName: string;
};

export const PURCHASE_DOC_ACCEPT =
  ".pdf,.csv,.zip,.doc,.docx,.jpeg,.jpg,.png,application/pdf,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

const MAX_DOC_BYTES = 5 * 1024 * 1024;

export function defaultPurchaseDateValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyPurchaseMeta(location = ""): PurchaseMeta {
  return {
    supplier: "",
    supplierAddress: "",
    referenceNo: "",
    purchaseDate: defaultPurchaseDateValue(),
    purchaseStatus: "received",
    businessLocation: location,
    payTerm: "",
    payTermUnit: "days",
    documentName: "",
  };
}

/** Pack purchase details into the stock-movement note (max 500 chars). */
export function buildPurchaseNote(meta: PurchaseMeta): string | null {
  const parts = [
    meta.supplier.trim() || null,
    meta.referenceNo.trim() ? `Ref ${meta.referenceNo.trim()}` : null,
    meta.purchaseStatus ? `Status ${meta.purchaseStatus}` : null,
    meta.purchaseDate.trim() ? `Date ${meta.purchaseDate.trim().replace("T", " ")}` : null,
    meta.payTerm.trim()
      ? `Pay ${meta.payTerm.trim()} ${meta.payTermUnit}`
      : null,
    meta.businessLocation.trim()
      ? `Loc ${meta.businessLocation.trim()}`
      : null,
    meta.documentName.trim() ? `Doc ${meta.documentName.trim()}` : null,
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  return parts.join(" · ").slice(0, 500);
}

type Props = {
  meta: PurchaseMeta;
  onChange: (patch: Partial<PurchaseMeta>) => void;
  disabled?: boolean;
};

export function TransChapPurchaseFields({ meta, onChange, disabled = false }: Props) {
  const locationOptions = useMemo(() => {
    const value = meta.businessLocation.trim();
    return value ? [value] : [];
  }, [meta.businessLocation]);

  async function handleDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      onChange({ documentName: "" });
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      await showError("Document too large", "Max file size is 5MB.");
      return;
    }
    onChange({ documentName: file.name });
  }

  return (
    <div className="trans-chap-purchase-meta">
      <div className="trans-chap-purchase-meta__cell trans-chap-purchase-meta__cell--supplier">
        <TransChapSupplierField
          id="purchase-supplier"
          value={meta.supplier}
          disabled={disabled}
          required
          onChange={(supplier) => onChange({ supplier })}
          onAddressChange={(supplierAddress) => onChange({ supplierAddress })}
        />
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell">
        <label htmlFor="purchase-reference">Reference No</label>
        <div className="trans-chap-input">
          <input
            id="purchase-reference"
            type="text"
            className="auth-split__input"
            placeholder="Optional"
            autoComplete="off"
            disabled={disabled}
            value={meta.referenceNo}
            onChange={(event) => onChange({ referenceNo: event.target.value })}
          />
        </div>
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell">
        <label htmlFor="purchase-date">Purchase Date</label>
        <div className="trans-chap-input">
          <input
            id="purchase-date"
            type="datetime-local"
            required
            className="auth-split__input"
            disabled={disabled}
            value={meta.purchaseDate}
            onChange={(event) => onChange({ purchaseDate: event.target.value })}
          />
        </div>
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell">
        <label htmlFor="purchase-status">Purchase Status</label>
        <div className="trans-chap-input trans-chap-input--select">
          <select
            id="purchase-status"
            required
            className="auth-split__input"
            disabled={disabled}
            value={meta.purchaseStatus}
            onChange={(event) =>
              onChange({
                purchaseStatus: event.target.value as PurchaseStatus,
              })
            }
          >
            <option value="received">Received</option>
            <option value="pending">Pending</option>
            <option value="ordered">Ordered</option>
          </select>
        </div>
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell">
        <span className="trans-chap-form__label" id="purchase-address-label">
          Address
        </span>
        <p
          className="trans-chap-form__readonly"
          aria-labelledby="purchase-address-label"
        >
          {meta.supplierAddress.trim() || "—"}
        </p>
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell">
        <label htmlFor="purchase-location">Business Location</label>
        <div className="trans-chap-input trans-chap-input--select">
          <select
            id="purchase-location"
            required
            className="auth-split__input"
            disabled={disabled || locationOptions.length === 0}
            value={meta.businessLocation}
            onChange={(event) => onChange({ businessLocation: event.target.value })}
          >
            {locationOptions.length === 0 ? (
              <option value="">No location set</option>
            ) : (
              locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell">
        <span className="trans-chap-form__label" id="purchase-pay-term-label">
          Pay term
        </span>
        <div
          className="trans-chap-pay-term"
          role="group"
          aria-labelledby="purchase-pay-term-label"
        >
          <div className="trans-chap-input">
            <input
              id="purchase-pay-term"
              type="text"
              inputMode="numeric"
              className="auth-split__input"
              placeholder="e.g. 30"
              disabled={disabled}
              value={meta.payTerm}
              onChange={(event) => onChange({ payTerm: event.target.value })}
            />
          </div>
          <div className="trans-chap-input trans-chap-input--select">
            <select
              id="purchase-pay-term-unit"
              className="auth-split__input"
              aria-label="Pay term unit"
              disabled={disabled}
              value={meta.payTermUnit}
              onChange={(event) =>
                onChange({ payTermUnit: event.target.value as PayTermUnit })
              }
            >
              <option value="days">Days</option>
              <option value="months">Months</option>
            </select>
          </div>
        </div>
      </div>

      <div className="auth-split__field trans-chap-purchase-meta__cell trans-chap-purchase-meta__cell--doc">
        <label htmlFor="purchase-document">Attach Document</label>
        <div className="trans-chap-purchase-doc">
          <div className="trans-chap-input">
            <input
              id="purchase-document-name"
              type="text"
              readOnly
              className="auth-split__input"
              placeholder="No file chosen"
              value={meta.documentName}
              disabled={disabled}
            />
          </div>
          <label className="trans-chap-purchase-doc__browse">
            Browse…
            <input
              id="purchase-document"
              type="file"
              accept={PURCHASE_DOC_ACCEPT}
              disabled={disabled}
              onChange={(event) => {
                void handleDocument(event);
              }}
            />
          </label>
        </div>
        <p className="trans-chap-form__hint">
          Max 5MB · pdf, csv, zip, doc, docx, jpeg, jpg, png. File name is saved
          with the purchase note.
        </p>
      </div>
    </div>
  );
}
