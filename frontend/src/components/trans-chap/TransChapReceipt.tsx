"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showError } from "@/lib/alerts";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  formatKsh,
  loadTransChapReceipt,
  saveTransChapReceipt,
  whatsappReceiptUrl,
  type TransChapReceipt,
} from "@/lib/trans-chap-receipt";

export function TransChapReceiptView() {
  const router = useRouter();
  const [receipt, setReceipt] = useState<TransChapReceipt | null>(null);
  const [phone, setPhone] = useState("");

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
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const rows = [
    { label: "Paid to", value: receipt.shopName },
    { label: "For", value: receipt.productName },
    receipt.customerName ? { label: "Customer", value: receipt.customerName } : null,
    { label: "Receipt no.", value: receipt.orderNumber },
    {
      label: "Date",
      value: formatNairobiDateTime(receipt.paidAt) || "—",
    },
    { label: "Method", value: "Cash" },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="trans-chap-receipt">
      <article className="trans-chap-mpesa">
        <div className="trans-chap-mpesa__hero">
          <span className="trans-chap-mpesa__logo">CASH</span>
          <span className="trans-chap-mpesa__check" aria-hidden>
            <i className="fa-solid fa-check" />
          </span>
          <p className="trans-chap-mpesa__status">Confirmed</p>
          <strong className="trans-chap-mpesa__amt">{formatKsh(receipt.amount)}</strong>
        </div>
        <dl className="trans-chap-mpesa__rows">
          {rows.map((row) => (
            <div key={row.label} className="trans-chap-mpesa__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </article>

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
      </div>

      <button type="button" className="auth-split__btn" onClick={() => void sendWhatsApp()}>
        <i className="fa-brands fa-whatsapp" aria-hidden />
        Send receipt
      </button>

      <Link href="/trans-chap/make-a-sale/new" className="trans-chap-receipt__again">
        Make another sale
      </Link>
    </div>
  );
}
