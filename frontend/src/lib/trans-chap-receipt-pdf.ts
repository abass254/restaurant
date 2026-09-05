import { jsPDF } from "jspdf";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  formatKsh,
  isTransChapReceiptPaid,
  transChapPayLabel,
  type TransChapReceipt,
  type TransChapReceiptLine,
} from "@/lib/trans-chap-receipt";

const INK = "#1a100c";
const MUTED = "#6b625c";
const LINE = "#e6dcd4";
const ACCENT = "#e8412a";

export function receiptPdfFileName(receipt: TransChapReceipt): string {
  return `receipt-${receipt.orderNumber.replace(/[^\w.-]+/g, "-")}.pdf`;
}

function receiptLines(receipt: TransChapReceipt): TransChapReceiptLine[] {
  if (receipt.items?.length) return receipt.items;
  return [
    {
      name: receipt.productName,
      quantity: 1,
      unitPrice: receipt.amount,
      lineTotal: receipt.amount,
    },
  ];
}

function statusLabel(receipt: TransChapReceipt): string {
  if (receipt.orderStatus === "cancelled") return "VOIDED";
  if (receipt.orderStatus === "refunded") return "REFUNDED";
  if (receipt.payMode === "credit") return "ON CREDIT";
  if (isTransChapReceiptPaid(receipt)) return "PAID";
  if (receipt.paymentStatus === "pending") return "WAITING FOR M-PESA";
  return "M-PESA FAILED";
}

export function buildTransChapReceiptPdf(receipt: TransChapReceipt): File {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const x = 18;
  const width = pageW - 36;
  let y = 22;

  doc.setFillColor(ACCENT);
  doc.rect(0, 0, pageW, 8, "F");

  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(receipt.shopName, pageW / 2, y, { align: "center" });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text("RECEIPT", pageW / 2, y, { align: "center" });
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(ACCENT);
  doc.text(statusLabel(receipt), pageW / 2, y, { align: "center" });
  y += 8;

  doc.setDrawColor(LINE);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + width, y);
  y += 8;

  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Item", x, y);
  doc.text("Total", x + width, y, { align: "right" });
  y += 3;
  doc.setDrawColor(LINE);
  doc.line(x, y, x + width, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of receiptLines(receipt)) {
    const qty = line.quantity > 1 ? `  x${line.quantity}` : "";
    const name = doc.splitTextToSize(`${line.name}${qty}`, width - 42);
    doc.setTextColor(INK);
    doc.text(name, x, y);
    doc.text(formatKsh(line.lineTotal), x + width, y, { align: "right" });
    y += Math.max(6, name.length * 5);
  }

  y += 2;
  doc.setDrawColor(LINE);
  doc.line(x, y, x + width, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Total", x, y);
  doc.setFontSize(16);
  doc.text(formatKsh(receipt.amount), x + width, y, { align: "right" });
  y += 10;

  doc.setDrawColor(LINE);
  doc.line(x, y, x + width, y);
  y += 8;

  const rows: [string, string][] = [
    ["Ref", receipt.orderNumber],
    ["Date", formatNairobiDateTime(receipt.paidAt) || "—"],
    ["Payment", transChapPayLabel(receipt.payMode)],
    ["Customer", receipt.customerName?.trim() || "Walk-in"],
  ];
  if (receipt.mpesaReceiptNumber) {
    rows.push(["M-PESA code", receipt.mpesaReceiptNumber]);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const [label, value] of rows) {
    doc.setTextColor(MUTED);
    doc.text(label, x, y);
    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    const wrapped = doc.splitTextToSize(value, width - 40);
    doc.text(wrapped, x + width, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += Math.max(7, wrapped.length * 5);
  }

  y += 8;
  doc.setDrawColor(LINE);
  doc.line(x, y, x + width, y);
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text("Thank you for shopping with us.", pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.text("dukai.app", pageW / 2, y, { align: "center" });

  const blob = doc.output("blob");
  return new File([blob], receiptPdfFileName(receipt), { type: "application/pdf" });
}

export function saveReceiptFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
