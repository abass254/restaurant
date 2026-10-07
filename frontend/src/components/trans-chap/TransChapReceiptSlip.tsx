"use client";

import { forwardRef } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { formatNairobiStamp24 } from "@/lib/nairobi-time";
import {
  formatKesDigits,
  isTransChapReceiptClosed,
  isTransChapReceiptPaid,
  transChapReceiptMessage,
  transChapReceiptPayLabel,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";

/** The Trans Chap till receipt, shared by the receipt page, POS printing and PDF previews. */
export const TransChapReceiptSlip = forwardRef<HTMLElement, { receipt: TransChapReceipt }>(
  function TransChapReceiptSlip({ receipt }, ref) {
    const paid = isTransChapReceiptPaid(receipt);
    const closed = isTransChapReceiptClosed(receipt);
    const onCredit = !closed && receipt.payMode === "credit";
    const waiting = !closed && receipt.payMode === "mpesa" && receipt.paymentStatus === "pending";
    const lines = receipt.items?.length
      ? receipt.items
      : [{ name: receipt.productName, quantity: 1, unitPrice: receipt.amount, lineTotal: receipt.amount }];
    const status = closed
      ? receipt.orderStatus === "refunded"
        ? "Refunded"
        : "Voided"
      : paid
        ? "Paid"
        : onCredit
          ? "On credit"
          : waiting
            ? "Waiting"
            : "Failed";
    const statusTone = paid ? "ok" : onCredit ? "credit" : waiting ? "wait" : "fail";
    const customer = receipt.customerName?.trim() || "Walk-in";
    const creditPart = receipt.paymentSplits?.find((p) => p.method === "credit");
    const note = closed
      ? `Stock came back.${
          receipt.payMode === "mpesa"
            ? " M-PESA was not reversed — return the money yourself if needed."
            : receipt.payMode === "credit"
              ? " This amount came off the customer’s tab."
              : ""
        }`
      : onCredit
        ? `${
            creditPart
              ? `Ksh${formatKesDigits(creditPart.amount)} is on the customer’s tab.`
              : "On the customer’s tab."
          }${
            receipt.creditOutstanding != null
              ? ` Tab total is now Ksh${formatKesDigits(receipt.creditOutstanding)}. We sent a pay link on WhatsApp.`
              : " It is not paid yet."
          }`
        : !paid
          ? waiting
            ? receipt.mpesaMessage || "Ask the customer to enter their PIN on the prompt."
            : receipt.mpesaMessage || "The prompt didn't reach the phone. Send it again."
          : null;

    return (
      <article
        ref={ref}
        className={`trans-chap-slip${closed ? " is-closed" : ""}${waiting ? " is-waiting" : ""}`}
      >
        <header className="trans-chap-slip__brand">
          <DukAiLogoMark size={36} color="currentColor" accentColor="#e8412a" />
          <strong>{receipt.shopName}</strong>
          <span>Till receipt</span>
        </header>

        <p className={`trans-chap-slip__stamp is-${statusTone}`} aria-label={`Status: ${status}`}>
          {status}
        </p>

        <p className="trans-chap-slip__hero">
          <span>Ksh</span>
          <strong>{formatKesDigits(receipt.amount)}</strong>
        </p>
        <p className="trans-chap-slip__payline">
          {transChapReceiptPayLabel(receipt)}
          <span aria-hidden="true" />
          {customer}
        </p>

        {note ? <p className="trans-chap-slip__note">{note}</p> : null}

        {receipt.mpesaReceiptNumber ? (
          <p className="trans-chap-slip__mpesa">
            <span>M-PESA code</span>
            <strong>{receipt.mpesaReceiptNumber}</strong>
          </p>
        ) : null}

        {onCredit && receipt.creditOutstanding != null ? (
          <p className="trans-chap-slip__mpesa">
            <span>Tab total</span>
            <strong>{formatKesDigits(receipt.creditOutstanding)}</strong>
          </p>
        ) : null}

        <div className="trans-chap-slip__cut" aria-hidden="true" />

        <ul className="trans-chap-slip__lines">
          {lines.map((line, index) => (
            <li key={`${line.name}-${index}`}>
              <div>
                <span>{line.name}</span>
                <span className="trans-chap-slip__dots" />
                <em>{formatKesDigits(line.lineTotal)}</em>
              </div>
              {line.quantity > 1 ? (
                <small>
                  {line.quantity} × {formatKesDigits(line.unitPrice)}
                </small>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="trans-chap-slip__total">
          <span>Total</span>
          <strong>{formatKesDigits(receipt.amount)}</strong>
        </p>

        <dl className="trans-chap-slip__meta">
          <div>
            <dt>Ref</dt>
            <dd>{receipt.orderNumber}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{formatNairobiStamp24(receipt.paidAt) || "—"}</dd>
          </div>
          {receipt.customerPhone ? (
            <div>
              <dt>Phone</dt>
              <dd>{receipt.customerPhone}</dd>
            </div>
          ) : null}
        </dl>

        <div className="trans-chap-slip__foot">
          <span className="trans-chap-slip__qr">
            <QRCodeSVG
              value={transChapReceiptMessage(receipt)}
              size={72}
              bgColor="#f6eee3"
              fgColor="#1c1410"
              level="M"
            />
          </span>
          <div>
            <SlipBars value={receipt.orderNumber} />
            <p className="trans-chap-slip__thanks">
              <strong>Asante</strong>
              Thank you for shopping with us
            </p>
          </div>
        </div>
      </article>
    );
  },
);

function SlipBars({ value }: { value: string }) {
  const seed = `${value}${value}${value}`.replace(/\s+/g, "").slice(0, 28);
  const units = Array.from(seed).flatMap((ch) => {
    const n = ch.charCodeAt(0);
    return [1 + (n % 4), 1 + (Math.floor(n / 3) % 2)];
  });
  return (
    <div className="trans-chap-slip__bars" aria-hidden="true">
      {units.map((flex, index) => (
        <span key={index} className={index % 2 ? "is-gap" : "is-bar"} style={{ flex }} />
      ))}
    </div>
  );
}

/**
 * Print-only copy of the till receipt, mounted on <body> so `window.print()`
 * outputs just the slip (80mm thermal page) instead of the whole app shell.
 */
export function TransChapReceiptPrint({ receipt }: { receipt: TransChapReceipt | null }) {
  if (!receipt || typeof document === "undefined") return null;
  return createPortal(
    <div className="trans-chap-print-root" aria-hidden="true">
      <div className="trans-chap-receipt">
        <TransChapReceiptSlip receipt={receipt} />
      </div>
    </div>,
    document.body,
  );
}
