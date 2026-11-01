import { jsPDF } from "jspdf";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  formatKesDigits,
  isTransChapReceiptPaid,
  transChapReceiptPayLabel,
  type TransChapReceipt,
  type TransChapReceiptLine,
} from "@/lib/trans-chap-receipt";

const PAPER: [number, number, number] = [246, 238, 227];
const INK: [number, number, number] = [28, 20, 16];
const MUTED: [number, number, number] = [110, 97, 86];
const ACCENT: [number, number, number] = [232, 65, 42];
const PAID: [number, number, number] = [21, 128, 61];
const CREDIT: [number, number, number] = [194, 65, 12];
const WAIT: [number, number, number] = [180, 83, 9];
const FAIL: [number, number, number] = [190, 18, 60];
const PAGE_W = 80;
const MARGIN = 8;

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
  if (receipt.payMode === "credit") return "INVOICE";
  if (isTransChapReceiptPaid(receipt)) return "PAID";
  if (receipt.paymentStatus === "pending") return "WAITING";
  return "FAILED";
}

function statusColor(receipt: TransChapReceipt): [number, number, number] {
  const label = statusLabel(receipt);
  if (label === "PAID") return PAID;
  if (label === "INVOICE") return CREDIT;
  if (label === "WAITING") return WAIT;
  return FAIL;
}

function dash(doc: jsPDF, y: number, x: number, width: number) {
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.2, 1.1], 0);
  doc.line(x, y, x + width, y);
  doc.setLineDashPattern([], 0);
}

function estimateHeight(receipt: TransChapReceipt): number {
  const lines = receiptLines(receipt);
  let height = 92;
  for (const line of lines) {
    height += line.name.length > 28 ? 12 : 7;
    if (line.quantity > 1) height += 4;
  }
  height += (receipt.headerLines?.length ?? 0) * 4;
  if (receipt.mpesaReceiptNumber) height += 16;
  height += 8;
  height += 7 * (3 + (receipt.customerPhone ? 1 : 0));
  height += 18;
  return Math.max(145, Math.ceil(height));
}

export function buildTransChapReceiptPdf(receipt: TransChapReceipt): File {
  const pageH = estimateHeight(receipt);
  const doc = new jsPDF({ unit: "mm", format: [PAGE_W, pageH] });
  const x = MARGIN;
  const width = PAGE_W - MARGIN * 2;
  const mid = PAGE_W / 2;
  let y = 12;

  doc.setFillColor(...PAPER);
  doc.rect(0, 0, PAGE_W, pageH, "F");

  doc.setFillColor(...ACCENT);
  doc.rect(10, 6, PAGE_W - 20, 1.2, "F");

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const shop = doc.splitTextToSize(receipt.shopName, width);
  doc.text(shop, mid, y, { align: "center" });
  y += shop.length * 5.2 + 2;

  const headerLines = receipt.headerLines ?? [];
  if (headerLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    for (const line of headerLines) {
      const wrapped = doc.splitTextToSize(line, width);
      doc.text(wrapped, mid, y, { align: "center" });
      y += wrapped.length * 3.6 + 0.6;
    }
    y += 1.4;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(receipt.payMode === "credit" ? "INVOICE" : "TILL RECEIPT", mid, y, { align: "center" });
  y += 8;

  const stamp = statusLabel(receipt);
  const stampColor = statusColor(receipt);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const stampW = Math.max(28, doc.getTextWidth(stamp) + 8);
  const stampH = 7;
  const stampX = mid - stampW / 2;
  doc.setDrawColor(...stampColor);
  doc.setLineWidth(0.55);
  doc.roundedRect(stampX, y - 4.6, stampW, stampH, 1.2, 1.2, "S");
  doc.setTextColor(...stampColor);
  doc.text(stamp, mid, y, { align: "center" });
  y += 12;

  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("KSH", mid, y, { align: "center" });
  y += 7;
  doc.setTextColor(...INK);
  doc.setFontSize(20);
  doc.text(formatKesDigits(receipt.amount), mid, y, { align: "center" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const customer = receipt.customerName?.trim() || "Walk-in";
  const payLines: string[] = doc.splitTextToSize(
    `${transChapReceiptPayLabel(receipt)}  ·  ${customer}`,
    PAGE_W - MARGIN * 2,
  );
  doc.text(payLines, mid, y, { align: "center" });
  y += 6 + (payLines.length - 1) * 4;

  if (receipt.mpesaReceiptNumber) {
    y += 2;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.35);
    doc.setLineDashPattern([1.1, 0.9], 0);
    doc.roundedRect(x, y, width, 12, 1.5, 1.5, "S");
    doc.setLineDashPattern([], 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text("M-PESA CODE", mid, y + 4.2, { align: "center" });
    doc.setTextColor(...INK);
    doc.setFontSize(11);
    doc.text(receipt.mpesaReceiptNumber, mid, y + 9.2, { align: "center" });
    y += 16;
  }

  dash(doc, y, x, width);
  y += 6;

  for (const line of receiptLines(receipt)) {
    const name = doc.splitTextToSize(line.name, width - 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(name, x, y);
    doc.text(formatKesDigits(line.lineTotal), x + width, y, { align: "right" });
    y += Math.max(5, name.length * 4.2);
    if (line.quantity > 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`${line.quantity} x ${formatKesDigits(line.unitPrice)}`, x, y);
      y += 4.5;
    }
    y += 1.5;
  }

  y += 1;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.line(x, y, x + width, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text("TOTAL", x, y);
  doc.setFontSize(12);
  doc.text(formatKesDigits(receipt.amount), x + width, y, { align: "right" });
  y += 8;

  const rows: [string, string][] = [
    ["Ref", receipt.orderNumber],
    ["When", formatNairobiDateTime(receipt.paidAt) || "—"],
  ];
  if (receipt.customerPhone) {
    rows.push(["Phone", receipt.customerPhone]);
  }

  doc.setFontSize(8);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(label, x, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(value, width - 22);
    doc.text(wrapped, x + width, y, { align: "right" });
    y += Math.max(5.5, wrapped.length * 4);
  }

  y += 4;
  dash(doc, y, x, width);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("ASANTE", mid, y, { align: "center" });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Thank you for shopping with us.", mid, y, { align: "center" });
  y += 4.5;
  doc.setFontSize(7);
  doc.text("transchap.app", mid, y, { align: "center" });

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
