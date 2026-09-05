"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import { extractErrorMessage, promptWhatsAppPhone, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { promptAndUndoWalkinSale, walkinUndoAction } from "@/lib/trans-chap-orders";
import {
  formatKsh,
  isTransChapReceiptClosed,
  isTransChapReceiptPaid,
  loadTransChapReceipt,
  receiptFromOrder,
  saveTransChapReceipt,
  toWhatsAppMsisdn,
  transChapPayLabel,
  whatsappReceiptUrl,
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
  const [resending, setResending] = useState(false);
  const [undoing, setUndoing] = useState(false);

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
    setOpeningWhatsApp(true);
    try {
      let phone = receipt.customerPhone?.trim() || "";
      let prompted = false;
      if (!toWhatsAppMsisdn(phone)) {
        const entered = await promptWhatsAppPhone(
          "Customer WhatsApp number",
          "Enter the customer's WhatsApp number to open their chat with this receipt.",
          phone,
        );
        if (!entered) return;
        phone = entered;
        prompted = true;
        applyReceipt({ ...receipt, customerPhone: phone });
      }

      const url = whatsappReceiptUrl(phone, { ...receipt, customerPhone: phone });
      if (!url) {
        await showError(
          "Invalid WhatsApp number",
          "Enter a valid phone number, e.g. 0712 345 678.",
        );
        return;
      }
      // After an async prompt, popup blockers often stop window.open — navigate instead.
      if (prompted) {
        window.location.assign(url);
        return;
      }
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.assign(url);
    } finally {
      setOpeningWhatsApp(false);
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
    setResending(true);
    try {
      const data = await apiFetch<OrderMutationResponse>(
        apiRoutes.orderMpesaStkPush(receipt.orderId),
        { method: "POST", body: "{}" },
      );
      const next = receiptFromOrder(data.data, receipt.shopName, data.mpesa_push);
      const updated = { ...receipt, ...next, customerPhone: receipt.customerPhone };
      saveTransChapReceipt(updated);
      setReceipt(updated);
      if (data.mpesa_push?.status === "sent") {
        await toastSuccess("M-PESA prompt sent");
      } else {
        await showError(
          "Prompt didn't go through",
          data.mpesa_push?.message ?? "Ask the customer to check their phone, then try again.",
        );
      }
    } catch (err) {
      await showError("Couldn't send M-PESA prompt", extractErrorMessage(err));
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
    } catch (err) {
      await showError("Could not undo sale", extractErrorMessage(err));
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

  return (
    <div className="trans-chap-receipt">
      <article className="trans-chap-slip">
        <header className="trans-chap-slip__brand">
          <TransChapLogoMark size={42} color="currentColor" accentColor="#e8412a" />
          <div>
            <strong>{receipt.shopName}</strong>
            <span>Receipt</span>
          </div>
        </header>
        <p className={`trans-chap-slip__status is-${statusTone}`}>
          {status}
        </p>
        {closed ? (
          <p className="trans-chap-slip__note">
            Stock came back.
            {receipt.payMode === "mpesa"
              ? " M-PESA was not reversed — return the money yourself if needed."
              : receipt.payMode === "credit"
                ? " This amount came off the customer’s tab."
                : ""}
          </p>
        ) : onCredit ? (
          <p className="trans-chap-slip__note">
            This sale is on the customer’s tab. It is not paid yet.
          </p>
        ) : !paid ? (
          <p className="trans-chap-slip__note">
            {waiting
              ? receipt.mpesaMessage || "Ask the customer to enter their PIN on the prompt."
              : receipt.mpesaMessage || "The prompt didn't reach the phone. Send it again."}
          </p>
        ) : null}
        <ul className="trans-chap-slip__lines">
          {lines.map((line, index) => (
            <li key={`${line.name}-${index}`}>
              <span>
                {line.name}
                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
              </span>
              <em>{formatKsh(line.lineTotal)}</em>
            </li>
          ))}
        </ul>
        <p className="trans-chap-slip__total">
          <span>Total</span>
          <strong>{formatKsh(receipt.amount)}</strong>
        </p>
        <dl className="trans-chap-slip__meta">
          <div>
            <dt>Ref</dt>
            <dd>{receipt.orderNumber}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatNairobiDateTime(receipt.paidAt) || "—"}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>{paymentMethod}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{receipt.customerName?.trim() || "Walk-in"}</dd>
          </div>
          {receipt.mpesaReceiptNumber ? (
            <div>
              <dt>M-PESA code</dt>
              <dd>{receipt.mpesaReceiptNumber}</dd>
            </div>
          ) : null}
          {receipt.customerPhone ? (
            <div>
              <dt>Phone</dt>
              <dd>{receipt.customerPhone}</dd>
            </div>
          ) : null}
        </dl>
        <footer className="trans-chap-slip__thanks">Thank you for shopping with us</footer>
      </article>

      <div className="trans-chap-slip__actions">
        {closed ? null : paid || onCredit ? (
          <div className="trans-chap-slip__choices">
            <button
              type="button"
              className="trans-chap-slip__wa"
              onClick={() => void openWhatsApp()}
              disabled={openingWhatsApp || downloading || undoing}
            >
              <i className="fa-brands fa-whatsapp" aria-hidden />
              {openingWhatsApp ? "Opening…" : "WhatsApp"}
            </button>
            <button
              type="button"
              className="trans-chap-slip__pdf"
              onClick={() => void downloadPdf()}
              disabled={downloading || openingWhatsApp || undoing}
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
            {resending ? "Sending…" : waiting ? "Resend prompt" : "Send prompt again"}
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
