import { orderHasSuccessfulMpesa } from "@/lib/orders";
import type { Order, OrderMpesaPushResult } from "@/lib/types";
import { toWhatsAppMsisdn } from "@/lib/whatsapp-phone";

export { toWhatsAppMsisdn };

export const TRANS_CHAP_RECEIPT_KEY = "trans-chap:last-receipt";

export type TransChapPayMode = "cash" | "mpesa";
export type TransChapPaymentStatus = "paid" | "pending" | "failed";

export type TransChapReceipt = {
  orderId: string | null;
  orderNumber: string;
  shopName: string;
  productName: string;
  amount: number;
  currency: string;
  payMode: TransChapPayMode;
  paymentStatus: TransChapPaymentStatus;
  paidAt: string;
  customerName: string | null;
  customerPhone: string | null;
  mpesaReceiptNumber: string | null;
  mpesaMessage: string | null;
};

export function saveTransChapReceipt(receipt: TransChapReceipt): void {
  try {
    sessionStorage.setItem(TRANS_CHAP_RECEIPT_KEY, JSON.stringify(receipt));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadTransChapReceipt(): TransChapReceipt | null {
  try {
    const raw = sessionStorage.getItem(TRANS_CHAP_RECEIPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransChapReceipt>;
    if (!parsed?.productName || !Number.isFinite(parsed.amount)) return null;
    const payMode: TransChapPayMode = parsed.payMode === "mpesa" ? "mpesa" : "cash";
    return {
      orderId: parsed.orderId ?? null,
      orderNumber: parsed.orderNumber || "Sale",
      shopName: parsed.shopName || "DukAI",
      productName: parsed.productName,
      amount: parsed.amount,
      currency: parsed.currency || "KES",
      payMode,
      paymentStatus: normalizePaymentStatus(payMode, parsed.paymentStatus),
      paidAt: parsed.paidAt || new Date().toISOString(),
      customerName: parsed.customerName ?? null,
      customerPhone: parsed.customerPhone ?? null,
      mpesaReceiptNumber: parsed.mpesaReceiptNumber ?? null,
      mpesaMessage: parsed.mpesaMessage ?? null,
    };
  } catch {
    return null;
  }
}

export function isTransChapReceiptPaid(receipt: TransChapReceipt): boolean {
  return receipt.payMode !== "mpesa" || receipt.paymentStatus === "paid";
}

export function transChapReceiptMessage(receipt: TransChapReceipt): string {
  const total = formatKsh(receipt.amount);
  const paymentLine =
    receipt.payMode === "mpesa"
      ? receipt.mpesaReceiptNumber
        ? `Paid via M-PESA. Receipt ${receipt.mpesaReceiptNumber}.`
        : "Paid via M-PESA."
      : "Paid in cash.";
  return [
    `${receipt.orderNumber} Confirmed.`,
    `${total} paid to ${receipt.shopName} for ${receipt.productName}.`,
    receipt.customerName ? `Customer ${receipt.customerName}.` : "",
    paymentLine,
    "Thank you for shopping with us.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatKsh(amount: number): string {
  return `Ksh${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function receiptFromOrder(
  order: Order,
  shopName: string,
  push?: OrderMpesaPushResult | null,
): TransChapReceipt {
  const payMode: TransChapPayMode = order.payment_method === "mpesa" ? "mpesa" : "cash";
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    shopName,
    productName: order.items?.[0]?.product_name || "Sale",
    amount: order.total,
    currency: order.currency || "KES",
    payMode,
    paymentStatus: paymentStatusFromOrder(order, push),
    paidAt:
      order.paid_at ||
      order.placed_at ||
      order.created_at ||
      new Date().toISOString(),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    mpesaReceiptNumber: mpesaReceiptNumberFromOrder(order),
    mpesaMessage: push?.message ?? null,
  };
}

/** Opens WhatsApp (or WhatsApp Web) with this number as the chat recipient. */
export function whatsappReceiptUrl(
  phone: string,
  receipt: TransChapReceipt,
  dialCode = "254",
): string | null {
  const msisdn = toWhatsAppMsisdn(phone, dialCode);
  if (!msisdn) return null;
  const text = encodeURIComponent(transChapReceiptMessage(receipt));
  return `https://wa.me/${msisdn}?text=${text}`;
}

function normalizePaymentStatus(
  payMode: TransChapPayMode,
  status: TransChapReceipt["paymentStatus"] | undefined,
): TransChapPaymentStatus {
  if (status === "paid" || status === "pending" || status === "failed") return status;
  return payMode === "mpesa" ? "pending" : "paid";
}

function paymentStatusFromOrder(
  order: Order,
  push?: OrderMpesaPushResult | null,
): TransChapPaymentStatus {
  if (order.payment_method !== "mpesa") return "paid";
  if (orderHasSuccessfulMpesa(order)) return "paid";
  const txn = order.mpesa_transaction;
  if (txn?.status === "failed" || txn?.status === "cancelled") return "failed";
  if (order.mpesa_transactions?.some((item) => item.status === "failed" || item.status === "cancelled")) {
    const pending = order.mpesa_transactions.some((item) => item.status === "pending");
    if (!pending) return "failed";
  }
  if (push && push.status !== "sent") return "failed";
  return "pending";
}

function mpesaReceiptNumberFromOrder(order: Order): string | null {
  return (
    order.mpesa_transaction?.mpesa_receipt_number ||
    order.mpesa_transactions?.find((txn) => txn.mpesa_receipt_number)?.mpesa_receipt_number ||
    null
  );
}
