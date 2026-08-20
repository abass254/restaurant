"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  formatKsh,
  isTransChapReceiptPaid,
  loadTransChapReceipt,
  receiptFromOrder,
  saveTransChapReceipt,
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
  const [sharing, setSharing] = useState(false);
  const [resending, setResending] = useState(false);

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
    if (!receipt?.orderId || isTransChapReceiptPaid(receipt)) return;
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
            current.mpesaReceiptNumber === merged.mpesaReceiptNumber
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
  }, [receipt?.orderId, receipt?.paymentStatus, receipt?.shopName]);

  async function sharePdf() {
    if (!receipt) return;
    setSharing(true);
    try {
      const file = buildTransChapReceiptPdf(receipt);
      const canShare =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });
      if (canShare) {
        await navigator.share({ files: [file] });
        return;
      }
      saveReceiptFile(file);
      await toastSuccess("PDF saved. Attach it in WhatsApp.");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      await showError("Could not share receipt", "Please try downloading the PDF instead.");
    } finally {
      setSharing(false);
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

  if (!receipt) {
    return (
      <p className="trans-chap-sales__empty">
        {missing ? "Receipt not found." : "Loading receipt…"}
      </p>
    );
  }

  const paid = isTransChapReceiptPaid(receipt);
  const waiting = receipt.payMode === "mpesa" && receipt.paymentStatus === "pending";
  const failed = receipt.payMode === "mpesa" && receipt.paymentStatus === "failed";
  const paymentMethod = receipt.payMode === "mpesa" ? "M-PESA" : "Cash";
  const lines = receipt.items?.length
    ? receipt.items
    : [{ name: receipt.productName, quantity: 1, unitPrice: receipt.amount, lineTotal: receipt.amount }];
  const status = paid ? "Paid" : waiting ? "Waiting" : "Failed";

  return (
    <div className="trans-chap-receipt">
      <article className="trans-chap-slip">
        <header className="trans-chap-slip__brand">
          <TransChapLogoMark size={36} color="currentColor" accentColor="#e8412a" />
          <div>
            <strong>{receipt.shopName}</strong>
            <span>Receipt</span>
          </div>
        </header>
        <p className={`trans-chap-slip__status is-${paid ? "ok" : waiting ? "wait" : "fail"}`}>
          {status}
        </p>
        {!paid ? (
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
        {paid ? (
          <div className="trans-chap-slip__choices">
            <button
              type="button"
              className="trans-chap-slip__wa"
              onClick={() => void sharePdf()}
              disabled={sharing || downloading}
            >
              <i className="fa-brands fa-whatsapp" aria-hidden />
              {sharing ? "Sharing…" : "WhatsApp PDF"}
            </button>
            <button
              type="button"
              className="trans-chap-slip__pdf"
              onClick={() => void downloadPdf()}
              disabled={downloading || sharing}
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
            disabled={resending}
          >
            <i className="fa-solid fa-rotate-right" aria-hidden />
            {resending ? "Sending…" : waiting ? "Resend prompt" : "Send prompt again"}
          </button>
        )}
        <Link href="/trans-chap/make-a-sale/new" className="trans-chap-receipt__again">
          Make another sale
        </Link>
      </div>
    </div>
  );
}
