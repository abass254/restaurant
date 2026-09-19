"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { QRCodeSVG } from "qrcode.react";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { showError, showInternalError, toastSuccess, promptEmail, promptMpesaReceipt, promptPendingStk, promptWhatsAppPhone, extractErrorMessage } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { promptAndUndoWalkinSale, walkinUndoAction } from "@/lib/trans-chap-orders";
import {
  formatKesDigits,
  isTransChapReceiptClosed,
  isTransChapReceiptPaid,
  loadTransChapReceipt,
  receiptFromOrder,
  saveTransChapReceipt,
  transChapPayLabel,
  transChapReceiptMessage,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";
import { buildTransChapReceiptPdf, saveReceiptFile } from "@/lib/trans-chap-receipt-pdf";
import type { OrderDetailResponse, OrderMutationResponse } from "@/lib/types";

const ORDER_POLL_MS = 4_000;

export function TransChapReceiptView() {
  const router = useRouter();
  const user = useAuthUser();
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "DukAI";
  const [receipt, setReceipt] = useState<TransChapReceipt | null>(null);
  const [missing, setMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [openingWhatsApp, setOpeningWhatsApp] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const slipRef = useRef<HTMLElement>(null);

  function applyReceipt(next: TransChapReceipt) {
    setReceipt(next);
    saveTransChapReceipt(next);
  }

  useEffect(() => {
    let cancelled = false;
    const orderId = new URLSearchParams(window.location.search).get("order");

    async function load() {
      if (orderId) {
        try {
          const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(orderId));
          if (cancelled) return;
          applyReceipt(receiptFromOrder(data.data, shopName));
          return;
        } catch {
          const stored = loadTransChapReceipt();
          if (!cancelled && stored?.orderId === orderId) {
            applyReceipt(stored);
            return;
          }
          if (!cancelled) {
            setMissing(true);
            router.replace("/trans-chap/make-a-sale");
          }
          return;
        }
      }

      const stored = loadTransChapReceipt();
      if (!stored) {
        if (!cancelled) {
          setMissing(true);
          router.replace("/trans-chap/make-a-sale");
        }
        return;
      }
      if (!cancelled) applyReceipt(stored);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router, shopName]);

  useEffect(() => {
    if (!receipt?.orderId || isTransChapReceiptPaid(receipt) || isTransChapReceiptClosed(receipt)) {
      return;
    }
    let cancelled = false;
    const currentShop = receipt.shopName;
    const orderId = receipt.orderId;

    const poll = async () => {
      try {
        const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(orderId));
        if (cancelled) return;
        const next = receiptFromOrder(data.data, currentShop);
        let becamePaid = false;
        setReceipt((current) => {
          if (!current) return next;
          const merged: TransChapReceipt = {
            ...current,
            ...next,
            customerPhone: current.customerPhone,
            customerEmail: current.customerEmail,
            mpesaMessage: next.mpesaMessage || current.mpesaMessage,
          };
          if (
            current.paymentStatus === merged.paymentStatus &&
            current.mpesaReceiptNumber === merged.mpesaReceiptNumber &&
            current.orderStatus === merged.orderStatus
          ) {
            return current;
          }
          becamePaid = current.paymentStatus !== "paid" && merged.paymentStatus === "paid";
          saveTransChapReceipt(merged);
          return merged;
        });
        if (becamePaid) void toastSuccess("M-PESA payment received");
      } catch {
        /* keep the waiting ticket */
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), ORDER_POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [receipt?.orderId, receipt?.orderStatus, receipt?.paymentStatus, receipt?.shopName]);

  async function openWhatsApp() {
    if (!receipt) return;
    if (!receipt.orderId) {
      await showError(
        "Sale not on the server",
        "Make the sale again to send the receipt on WhatsApp.",
      );
      return;
    }
    const entered = await promptWhatsAppPhone(
      "Send receipt on WhatsApp",
      "We'll send this till receipt from DukAI WhatsApp.",
      receipt.customerPhone ?? "",
      { confirmButtonText: "Send" },
    );
    if (!entered) return;

    setOpeningWhatsApp(true);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderSendReceiptWhatsApp(receipt.orderId),
        { method: "POST", body: JSON.stringify({ phone: entered }) },
      );
      applyReceipt({
        ...receipt,
        ...receiptFromOrder(data.data, receipt.shopName),
        customerPhone: data.recipient ?? entered,
        customerEmail: receipt.customerEmail,
      });
      await toastSuccess(data.message || `Receipt sent to ${entered}`);
    } catch (err) {
      applyReceipt({ ...receipt, customerPhone: entered });
      await showError("Could not send WhatsApp", extractErrorMessage(err));
    } finally {
      setOpeningWhatsApp(false);
    }
  }

  async function sendEmail() {
    if (!receipt) return;
    if (!receipt.orderId) {
      await showError("Sale not on the server", "Make the sale again to email the receipt.");
      return;
    }
    const entered = await promptEmail(
      "Send receipt by email",
      "We'll email this till receipt to the customer.",
      receipt.customerEmail ?? "",
    );
    if (!entered) return;

    setSendingEmail(true);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderSendReceiptEmail(receipt.orderId),
        { method: "POST", body: JSON.stringify({ email: entered }) },
      );
      applyReceipt({
        ...receipt,
        ...receiptFromOrder(data.data, receipt.shopName),
        customerPhone: receipt.customerPhone,
        customerEmail: data.recipient ?? entered,
      });
      await toastSuccess(data.message || `Receipt sent to ${entered}`);
    } catch (err) {
      applyReceipt({ ...receipt, customerEmail: entered });
      await showInternalError();
    } finally {
      setSendingEmail(false);
    }
  }

  async function downloadPdf() {
    if (!receipt) return;
    setDownloading(true);
    try {
      saveReceiptFile(buildTransChapReceiptPdf(receipt));
    } catch {
      await showError("Could not download receipt", "Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function resendMpesaPrompt() {
    if (!receipt?.orderId) {
      await showError("Sale not on the server", "Make the sale again to send an M-PESA prompt.");
      return;
    }
    const choice = await promptPendingStk();
    if (!choice) return;
    setResending(true);
    try {
      if (choice === "enter_code") {
        const code = await promptMpesaReceipt(
          "Enter M-PESA code",
          "Type the transaction code from the customer’s SMS. Use this when they paid you directly or already finished on their phone.",
        );
        if (!code) return;
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderTransition(receipt.orderId),
          {
            method: "POST",
            body: JSON.stringify({
              to_status: "payment_received",
              mpesa_receipt_number: code,
            }),
          },
        );
        const next = receiptFromOrder(data.data, receipt.shopName);
        const updated = {
          ...receipt,
          ...next,
          customerPhone: receipt.customerPhone,
          customerEmail: receipt.customerEmail,
        };
        saveTransChapReceipt(updated);
        setReceipt(updated);
        await toastSuccess("M-PESA sale closed");
        return;
      }
      if (choice === "check") {
        const data = await apiFetch<OrderMutationResponse>(
          apiRoutes.orderMpesaCheck(receipt.orderId),
          { method: "POST", body: "{}" },
        );
        const next = receiptFromOrder(data.data, receipt.shopName);
        const updated = {
          ...receipt,
          ...next,
          customerPhone: receipt.customerPhone,
          customerEmail: receipt.customerEmail,
        };
        saveTransChapReceipt(updated);
        setReceipt(updated);
        if (data.outcome === "paid") {
          await toastSuccess("Customer already paid");
        } else {
          await showError("Still waiting", "Please try again in a moment.");
        }
        return;
      }
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderMpesaStkPush(receipt.orderId),
        { method: "POST", body: "{}" },
      );
      const next = receiptFromOrder(data.data, receipt.shopName, data.mpesa_push);
      const updated = {
        ...receipt,
        ...next,
        customerPhone: receipt.customerPhone,
        customerEmail: receipt.customerEmail,
      };
      saveTransChapReceipt(updated);
      setReceipt(updated);
      if (data.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent");
      } else {
        await showInternalError();
      }
    } catch (err) {
      await showError("Could not complete M-PESA", extractErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  async function undoSale() {
    if (!receipt?.orderId) return;
    setUndoing(true);
    try {
      const updated = await promptAndUndoWalkinSale({
        id: receipt.orderId,
        status: receipt.orderStatus ?? "",
        allowed_next_statuses: receipt.allowedNextStatuses,
        payment_method: receipt.payMode,
      });
      if (!updated) return;
      applyReceipt(receiptFromOrder(updated, receipt.shopName));
      await toastSuccess(updated.status === "refunded" ? "Sale refunded" : "Sale voided");
    } catch {
      await showInternalError();
    } finally {
      setUndoing(false);
    }
  }

  if (!receipt) {
    return (
      <p className="trans-chap-sales__empty">
        {missing ? "Receipt not found." : "Loading receipt…"}
      </p>
    );
  }

  const paid = isTransChapReceiptPaid(receipt);
  const closed = isTransChapReceiptClosed(receipt);
  const onCredit = !closed && receipt.payMode === "credit";
  const waiting = !closed && receipt.payMode === "mpesa" && receipt.paymentStatus === "pending";
  const paymentMethod = transChapPayLabel(receipt.payMode);
  const lines = receipt.items?.length
    ? receipt.items
    : [{ name: receipt.productName, quantity: 1, unitPrice: receipt.amount, lineTotal: receipt.amount }];
  const undo = receipt.orderId
    ? walkinUndoAction({
        status: receipt.orderStatus ?? "",
        allowed_next_statuses: receipt.allowedNextStatuses,
      })
    : null;
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
  const note = closed
    ? `Stock came back.${
        receipt.payMode === "mpesa"
          ? " M-PESA was not reversed — return the money yourself if needed."
          : receipt.payMode === "credit"
            ? " This amount came off the customer’s tab."
            : ""
      }`
    : onCredit
      ? receipt.creditOutstanding != null
        ? `On the customer’s tab. Tab total is now Ksh${formatKesDigits(receipt.creditOutstanding)}. We sent a pay link on WhatsApp.`
        : "This sale is on the customer’s tab. It is not paid yet."
      : !paid
        ? waiting
          ? receipt.mpesaMessage || "Ask the customer to enter their PIN on the prompt."
          : receipt.mpesaMessage || "The prompt didn't reach the phone. Send it again."
        : null;

  return (
    <div className="trans-chap-receipt">
      <article
        ref={slipRef}
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
          {paymentMethod}
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
            <dd>{formatNairobiDateTime(receipt.paidAt) || "—"}</dd>
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

      <div className="trans-chap-slip__actions">
        {closed ? null : paid || onCredit ? (
          <div className="trans-chap-slip__choices">
            <button
              type="button"
              className="trans-chap-slip__wa"
              onClick={() => void openWhatsApp()}
              disabled={openingWhatsApp || sendingEmail || downloading || undoing}
            >
              <i className="fa-brands fa-whatsapp" aria-hidden />
              {openingWhatsApp ? "Sending…" : "WhatsApp"}
            </button>
            <button
              type="button"
              className="trans-chap-slip__email"
              onClick={() => void sendEmail()}
              disabled={openingWhatsApp || sendingEmail || downloading || undoing}
            >
              <i className="fa-solid fa-envelope" aria-hidden />
              {sendingEmail ? "Sending…" : "Email"}
            </button>
            <button
              type="button"
              className="trans-chap-slip__pdf"
              onClick={() => void downloadPdf()}
              disabled={downloading || openingWhatsApp || sendingEmail || undoing}
            >
              <i className="fa-solid fa-file-pdf" aria-hidden />
              {downloading ? "Saving…" : "Download PDF"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="trans-chap-slip__retry"
            onClick={() => void resendMpesaPrompt()}
            disabled={resending || undoing}
          >
            <i className="fa-solid fa-rotate-right" aria-hidden />
            {resending ? "Working…" : "Complete M-PESA"}
          </button>
        )}
        {undo && !closed ? (
          <button
            type="button"
            className="trans-chap-receipt__void"
            onClick={() => void undoSale()}
            disabled={undoing || resending}
          >
            {undoing ? "Working…" : undo === "refund" ? "Refund sale" : "Void sale"}
          </button>
        ) : null}
        <Link href="/trans-chap/make-a-sale/new" className="trans-chap-receipt__again">
          Make another sale
        </Link>
      </div>
    </div>
  );
}

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
