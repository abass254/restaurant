"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toPng } from "html-to-image";
import { showError } from "@/lib/alerts";
import { NAIROBI_TZ, parseIso } from "@/lib/nairobi-time";
import {
  formatKsh,
  loadTransChapReceipt,
  saveTransChapReceipt,
  whatsappReceiptUrl,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";

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
  const [phone, setPhone] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const stored = loadTransChapReceipt();
    if (!stored) {
      router.replace("/trans-chap/make-a-sale");
      return;
    }
    setReceipt(stored);
    setPhone(stored.customerPhone ?? "");
  }, [router]);

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

  async function sendWhatsApp() {
    if (!receipt) return;
    const url = whatsappReceiptUrl(phone, receipt);
    if (!url) {
      await showError(
        "Phone number needed",
        "Enter a WhatsApp number like 07XXXXXXXX.",
      );
      return;
    }
    saveTransChapReceipt({ ...receipt, customerPhone: phone.trim() || null });
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

  return (
    <div className="trans-chap-receipt">
      <div ref={cardRef} className="trans-chap-ticket-stage">
        <article className="trans-chap-ticket">
          <span className="trans-chap-ticket__badge" aria-hidden>
            <i className="fa-solid fa-check" />
          </span>
          <h2 className="trans-chap-ticket__title">Payment Success!</h2>
          <p className="trans-chap-ticket__sub">Your payment has been successfully done.</p>
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
              <dd>Cash</dd>
            </div>
            <div>
              <dt>Sender Name</dt>
              <dd>{thanksName}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="trans-chap-ticket__pdf"
            data-capture="skip"
            onClick={() => void downloadReceipt()}
            disabled={downloading || sharing}
          >
            <i className="fa-solid fa-download" aria-hidden />
            {downloading ? "Preparing…" : "Get PDF Receipt"}
          </button>
        </article>
      </div>

      <div className="auth-split__field">
        <label htmlFor="receipt-whatsapp">WhatsApp number</label>
        <input
          id="receipt-whatsapp"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="07XXXXXXXX"
          className="auth-split__input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="trans-chap-receipt__wa-hint">
          Opens WhatsApp to this number with the receipt ready to paste into the chat.
        </p>
      </div>

      <button
        type="button"
        className="auth-split__btn"
        onClick={() => void sendWhatsApp()}
        disabled={sharing || downloading}
      >
        <i className="fa-brands fa-whatsapp" aria-hidden />
        {sharing ? "Opening WhatsApp…" : "Share on WhatsApp"}
      </button>

      <Link href="/trans-chap/make-a-sale/new" className="trans-chap-receipt__again">
        Make another sale
      </Link>
    </div>
  );
}
