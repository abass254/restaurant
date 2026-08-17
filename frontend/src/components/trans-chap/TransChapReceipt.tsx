"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toPng } from "html-to-image";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { NAIROBI_TZ, parseIso } from "@/lib/nairobi-time";
import {
  formatKsh,
  isTransChapReceiptPaid,
  loadTransChapReceipt,
  receiptFromOrder,
  saveTransChapReceipt,
  toWhatsAppMsisdn,
  whatsappReceiptUrl,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";
import type { OrderDetailResponse, OrderMutationResponse } from "@/lib/types";
import {
  DEFAULT_WHATSAPP_COUNTRY,
  WHATSAPP_COUNTRIES,
  formatWhatsAppDisplay,
  parseWhatsAppPhone,
  whatsappCountryByIso,
} from "@/lib/whatsapp-phone";

const ORDER_POLL_MS = 4_000;

function formatPaymentTime(iso: string): string {
  const date = parseIso(iso);
  if (!date) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: NAIROBI_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TransChapReceiptView() {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);
  const [receipt, setReceipt] = useState<TransChapReceipt | null>(null);
  const [countryIso, setCountryIso] = useState(DEFAULT_WHATSAPP_COUNTRY);
  const [phone, setPhone] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [resending, setResending] = useState(false);

  const country = whatsappCountryByIso(countryIso);
  const msisdn = toWhatsAppMsisdn(phone, country.dial);
  const waDisplay = msisdn ? formatWhatsAppDisplay(msisdn, country.dial) : null;

  useEffect(() => {
    const stored = loadTransChapReceipt();
    if (!stored) {
      router.replace("/trans-chap/make-a-sale");
      return;
    }
    setReceipt(stored);
    const parsed = parseWhatsAppPhone(stored.customerPhone ?? "");
    setCountryIso(parsed.iso);
    setPhone(parsed.national);
  }, [router]);

  useEffect(() => {
    if (!receipt?.orderId || isTransChapReceiptPaid(receipt)) return;
    let cancelled = false;
    const shopName = receipt.shopName;
    const orderId = receipt.orderId;

    const poll = async () => {
      try {
        const data = await apiFetch<OrderDetailResponse>(apiRoutes.order(orderId));
        if (cancelled) return;
        const next = receiptFromOrder(data.data, shopName);
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

  if (!receipt) {
    return null;
  }

  async function captureReceiptPng(): Promise<{ file: File; dataUrl: string; blob: Blob }> {
    if (!receipt || !cardRef.current) {
      throw new Error("Could not find the receipt.");
    }
    const pageBg = getComputedStyle(cardRef.current).backgroundColor || "#5a6570";
    const dataUrl = await toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: pageBg,
      filter: (node) =>
        !(node instanceof HTMLElement && node.dataset.capture === "skip"),
    });
    const blob = await (await fetch(dataUrl)).blob();
    const fileName = `receipt-${receipt.orderNumber.replace(/[^\w.-]+/g, "-")}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    return { file, dataUrl, blob };
  }

  async function copyReceiptImage(blob: Blob): Promise<boolean> {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || "image/png"]: blob,
        }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  function openWhatsAppChat(webUrl: string) {
    const nativeUrl = webUrl
      .replace(/^https:\/\/wa\.me\//, "whatsapp://send?phone=")
      .replace("?text=", "&text=");
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!mobile) {
      const link = document.createElement("a");
      link.href = webUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    const started = Date.now();
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible" && Date.now() - started < 2500) {
        window.location.assign(webUrl);
      }
    }, 1200);
    const onHide = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onHide);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.location.assign(nativeUrl);
  }

  function saveReceiptPng(dataUrl: string, fileName: string) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function applyPhoneInput(value: string) {
    const parsed = parseWhatsAppPhone(value, countryIso);
    if (parsed.international && parsed.national.length >= 7) {
      setCountryIso(parsed.iso);
      setPhone(parsed.national);
      return;
    }
    setPhone(value.replace(/[^\d+\s()-]/g, ""));
  }

  async function sendWhatsApp() {
    if (!receipt) return;
    const url = whatsappReceiptUrl(phone, receipt, country.dial);
    if (!url || !msisdn) {
      await showError(
        "WhatsApp number needed",
        `Enter the number as WhatsApp stores it, for example ${country.example}.`,
      );
      return;
    }
    saveTransChapReceipt({ ...receipt, customerPhone: `+${msisdn}` });
    setSharing(true);
    try {
      const { file, dataUrl, blob } = await captureReceiptPng();
      const copied = await copyReceiptImage(blob);
      if (!copied) saveReceiptPng(dataUrl, file.name);
      openWhatsAppChat(url);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      openWhatsAppChat(url);
    } finally {
      setSharing(false);
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

  async function downloadReceipt() {
    if (!receipt) return;
    setDownloading(true);
    try {
      const { file, dataUrl } = await captureReceiptPng();
      const canShare =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });
      if (canShare) {
        await navigator.share({
          files: [file],
          title: `Receipt ${receipt.orderNumber}`,
        });
        return;
      }
      saveReceiptPng(dataUrl, file.name);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      await showError("Could not download receipt", "Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  const thanksName = receipt.customerName?.trim() || "Walk-in";
  const paymentTime = formatPaymentTime(receipt.paidAt);
  const paid = isTransChapReceiptPaid(receipt);
  const waiting = receipt.payMode === "mpesa" && receipt.paymentStatus === "pending";
  const failed = receipt.payMode === "mpesa" && receipt.paymentStatus === "failed";
  const paymentMethod = receipt.payMode === "mpesa" ? "M-PESA" : "Cash";
  const title = paid
    ? "Payment Success!"
    : waiting
      ? "Waiting for M-PESA"
      : "M-PESA didn't go through";
  const subtitle = paid
    ? "Your payment has been successfully done."
    : waiting
      ? receipt.mpesaMessage || "Ask the customer to enter their PIN on the prompt."
      : receipt.mpesaMessage || "The prompt didn't reach the phone. Send it again.";

  return (
    <div className="trans-chap-receipt">
      <div ref={cardRef} className="trans-chap-ticket-stage">
        <article className="trans-chap-ticket">
          <span
            className={`trans-chap-ticket__badge${waiting ? " is-pending" : ""}${failed ? " is-failed" : ""}`}
            aria-hidden
          >
            <i
              className={`fa-solid ${paid ? "fa-check" : waiting ? "fa-mobile-screen" : "fa-exclamation"}`}
            />
          </span>
          <h2 className="trans-chap-ticket__title">{title}</h2>
          <p className="trans-chap-ticket__sub">{subtitle}</p>
          <hr className="trans-chap-ticket__rule" />
          <p className="trans-chap-ticket__total-label">Total Payment</p>
          <strong className="trans-chap-ticket__total">{formatKsh(receipt.amount)}</strong>
          <dl className="trans-chap-ticket__grid">
            <div>
              <dt>Ref Number</dt>
              <dd>{receipt.orderNumber}</dd>
            </div>
            <div>
              <dt>Payment Time</dt>
              <dd>{paymentTime}</dd>
            </div>
            <div>
              <dt>Payment Method</dt>
              <dd>{paymentMethod}</dd>
            </div>
            <div>
              <dt>Sender Name</dt>
              <dd>{thanksName}</dd>
            </div>
            {receipt.mpesaReceiptNumber ? (
              <div>
                <dt>M-PESA code</dt>
                <dd>{receipt.mpesaReceiptNumber}</dd>
              </div>
            ) : null}
          </dl>
          <div className="trans-chap-ticket__actions" data-capture="skip">
            {paid ? (
              <>
                <div className="trans-chap-ticket__phone">
                  <span id="receipt-whatsapp-label">WhatsApp number</span>
                  <div className="trans-chap-ticket__phone-row">
                    <label className="sr-only" htmlFor="receipt-whatsapp-country">
                      Country code
                    </label>
                    <select
                      id="receipt-whatsapp-country"
                      className="trans-chap-ticket__country"
                      value={countryIso}
                      aria-labelledby="receipt-whatsapp-label"
                      onChange={(e) => setCountryIso(e.target.value)}
                    >
                      {WHATSAPP_COUNTRIES.map((item) => (
                        <option key={item.iso} value={item.iso}>
                          {item.iso} +{item.dial}
                        </option>
                      ))}
                    </select>
                    <input
                      id="receipt-whatsapp"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      placeholder={country.example}
                      value={phone}
                      aria-labelledby="receipt-whatsapp-label"
                      onChange={(e) => applyPhoneInput(e.target.value)}
                    />
                  </div>
                  <p className="trans-chap-ticket__wa-hint">
                    {waDisplay
                      ? waDisplay
                      : `As saved in WhatsApp, e.g. ${country.example}`}
                  </p>
                </div>
                <div className="trans-chap-ticket__choices">
                  <button
                    type="button"
                    className="trans-chap-ticket__wa"
                    onClick={() => void sendWhatsApp()}
                    disabled={sharing || downloading}
                  >
                    <i className="fa-brands fa-whatsapp" aria-hidden />
                    {sharing ? "Opening…" : "WhatsApp"}
                  </button>
                  <button
                    type="button"
                    className="trans-chap-ticket__pdf"
                    onClick={() => void downloadReceipt()}
                    disabled={downloading || sharing}
                  >
                    <i className="fa-solid fa-download" aria-hidden />
                    {downloading ? "Preparing…" : "Download"}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="trans-chap-ticket__retry"
                onClick={() => void resendMpesaPrompt()}
                disabled={resending}
              >
                <i className="fa-solid fa-rotate-right" aria-hidden />
                {resending ? "Sending…" : waiting ? "Resend prompt" : "Send prompt again"}
              </button>
            )}
          </div>
        </article>
      </div>

      <Link href="/trans-chap/make-a-sale/new" className="trans-chap-receipt__again">
        Make another sale
      </Link>
    </div>
  );
}
