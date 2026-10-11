import {
  PAYMENT_LABELS,
  orderHasSuccessfulMpesa,
  orderPaymentPortions,
  orderUsesPayment,
} from "@/lib/orders";
import type {
  Order,
  OrderItemModifier,
  OrderMpesaPushResult,
  OrderPaymentSplit,
} from "@/lib/types";
import { toWhatsAppMsisdn } from "@/lib/whatsapp-phone";

export { toWhatsAppMsisdn };

export const TRANS_CHAP_RECEIPT_KEY = "trans-chap:last-receipt";

export type TransChapPayMode = "cash" | "mpesa" | "credit";
export type TransChapPaymentStatus = "paid" | "pending" | "failed";

export type TransChapReceiptLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers?: OrderItemModifier[] | null;
};

export type TransChapReceipt = {
  orderId: string | null;
  orderNumber: string;
  shopName: string;
  productName: string;
  items: TransChapReceiptLine[];
  amount: number;
  tax?: number | null;
  currency: string;
  payMode: TransChapPayMode;
  paymentStatus: TransChapPaymentStatus;
  orderStatus: string | null;
  allowedNextStatuses: string[];
  paidAt: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  mpesaReceiptNumber: string | null;
  mpesaMessage: string | null;
  creditOutstanding: number | null;
  payBillUrl: string | null;
  /** Set for split payments; payMode then reflects the part that still needs settling. */
  paymentSplits: OrderPaymentSplit[] | null;
};

export function transChapPayLabel(payMode: TransChapPayMode): string {
  if (payMode === "mpesa") return "M-PESA";
  if (payMode === "credit") return "Credit";
  return "Cash";
}

/** "Cash" or, for split payments, "Cash Ksh500.00 + M-PESA Ksh300.00". */
export function transChapReceiptPayLabel(receipt: TransChapReceipt): string {
  if (!receipt.paymentSplits?.length) return transChapPayLabel(receipt.payMode);
  return receipt.paymentSplits
    .map((p) => `${PAYMENT_LABELS[p.method] ?? p.method} ${formatKsh(Number(p.amount))}`)
    .join(" + ");
}

export function payModeFromMethod(method: string | null | undefined): TransChapPayMode {
  if (method === "mpesa") return "mpesa";
  if (method === "credit") return "credit";
  return "cash";
}

function payModeFromOrder(order: Order): TransChapPayMode {
  if (order.payment_method !== "split") return payModeFromMethod(order.payment_method);
  if (orderUsesPayment(order, "mpesa")) return "mpesa";
  if (orderUsesPayment(order, "credit")) return "credit";
  return "cash";
}

function parsePaymentSplits(value: unknown): OrderPaymentSplit[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.flatMap((row) =>
    row &&
    typeof row.method === "string" &&
    row.method in PAYMENT_LABELS &&
    row.method !== "split" &&
    Number.isFinite(Number(row.amount))
      ? [{ method: row.method as OrderPaymentSplit["method"], amount: Number(row.amount) }]
      : [],
  );
  return rows.length >= 2 ? rows : null;
}

export function transChapReceiptHref(orderId: string | null | undefined): string {
  if (!orderId) return "/trans-chap/sales/receipt";
  return `/trans-chap/sales/receipt?order=${encodeURIComponent(orderId)}`;
}

export function saveTransChapReceipt(receipt: TransChapReceipt): void {
  const serialized = JSON.stringify(receipt);
  try {
    sessionStorage.setItem(TRANS_CHAP_RECEIPT_KEY, serialized);
  } catch {
    /* ignore quota / private mode */
  }
  try {
    localStorage.setItem(TRANS_CHAP_RECEIPT_KEY, serialized);
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadTransChapReceipt(): TransChapReceipt | null {
  try {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(TRANS_CHAP_RECEIPT_KEY);
    } catch {
      /* ignore */
    }
    if (!raw) {
      try {
        raw = localStorage.getItem(TRANS_CHAP_RECEIPT_KEY);
      } catch {
        /* ignore */
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransChapReceipt>;
    if (!parsed?.productName || !Number.isFinite(parsed.amount)) return null;
    const payMode: TransChapPayMode = payModeFromMethod(parsed.payMode);
    const productName = parsed.productName;
    const amount = Number(parsed.amount);
    const items: TransChapReceiptLine[] =
      Array.isArray(parsed.items) && parsed.items.length
        ? parsed.items.flatMap((line) => {
            if (
              !line ||
              typeof line.name !== "string" ||
              !Number.isFinite(line.quantity) ||
              !Number.isFinite(line.unitPrice) ||
              !Number.isFinite(line.lineTotal)
            ) {
              return [];
            }
            return [
              {
                name: line.name,
                quantity: Number(line.quantity),
                unitPrice: Number(line.unitPrice),
                lineTotal: Number(line.lineTotal),
              },
            ];
          })
        : [];
    if (!items.length) {
      items.push({ name: productName, quantity: 1, unitPrice: amount, lineTotal: amount });
    }
    return {
      orderId: parsed.orderId ?? null,
      orderNumber: parsed.orderNumber || "Sale",
      shopName: parsed.shopName || "DukAI",
      productName,
      items,
      amount,
      currency: parsed.currency || "KES",
      payMode,
      paymentStatus: normalizePaymentStatus(payMode, parsed.paymentStatus),
      orderStatus: parsed.orderStatus ?? null,
      allowedNextStatuses: Array.isArray(parsed.allowedNextStatuses)
        ? parsed.allowedNextStatuses.filter((status) => typeof status === "string")
        : [],
      paidAt: parsed.paidAt || new Date().toISOString(),
      customerName: parsed.customerName ?? null,
      customerPhone: parsed.customerPhone ?? null,
      customerEmail: parsed.customerEmail ?? null,
      mpesaReceiptNumber: parsed.mpesaReceiptNumber ?? null,
      mpesaMessage: parsed.mpesaMessage ?? null,
      creditOutstanding:
        parsed.creditOutstanding != null && Number.isFinite(Number(parsed.creditOutstanding))
          ? Number(parsed.creditOutstanding)
          : null,
      payBillUrl: parsed.payBillUrl ?? null,
      paymentSplits: parsePaymentSplits(parsed.paymentSplits),
    };
  } catch {
    return null;
  }
}

export function isTransChapReceiptPaid(receipt: TransChapReceipt): boolean {
  if (receipt.orderStatus === "cancelled" || receipt.orderStatus === "refunded") {
    return false;
  }
  if (receipt.payMode === "credit") return false;
  return receipt.payMode !== "mpesa" || receipt.paymentStatus === "paid";
}

export function isTransChapReceiptClosed(receipt: TransChapReceipt): boolean {
  return receipt.orderStatus === "cancelled" || receipt.orderStatus === "refunded";
}

export function transChapReceiptMessage(receipt: TransChapReceipt): string {
  const total = formatKsh(receipt.amount);
  const isSplit = Boolean(receipt.paymentSplits?.length);
  const paymentLine = isSplit
    ? `Paid with ${transChapReceiptPayLabel(receipt)}.${
        receipt.mpesaReceiptNumber ? ` M-PESA receipt ${receipt.mpesaReceiptNumber}.` : ""
      }`
    : receipt.payMode === "mpesa"
      ? receipt.mpesaReceiptNumber
        ? `Paid via M-PESA. Receipt ${receipt.mpesaReceiptNumber}.`
        : "Paid via M-PESA."
      : receipt.payMode === "credit"
        ? "On credit."
        : "Paid in cash.";
  return [
    `${receipt.orderNumber} Confirmed.`,
    isSplit
      ? `${total} sale at ${receipt.shopName} for ${receipt.productName}.`
      : receipt.payMode === "credit"
        ? `${total} on credit at ${receipt.shopName} for ${receipt.productName}.`
        : `${total} paid to ${receipt.shopName} for ${receipt.productName}.`,
    receipt.customerName ? `Customer ${receipt.customerName}.` : "",
    paymentLine,
    (receipt.payMode === "credit" || isSplit) && receipt.creditOutstanding != null
      ? `Your tab is now ${formatKsh(receipt.creditOutstanding)}.`
      : "",
    receipt.payBillUrl ? `Pay your bill: ${receipt.payBillUrl}` : "",
    "Thank you for shopping with us.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatKesDigits(amount: number): string {
  return amount.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatKsh(amount: number): string {
  return `Ksh${formatKesDigits(amount)}`;
}

export function receiptFromOrder(
  order: Order,
  shopName: string,
  push?: OrderMpesaPushResult | null,
  creditTab?: {
    outstanding_balance?: number | null;
    pay_bill_url?: string | null;
  } | null,
): TransChapReceipt {
  const payMode = payModeFromOrder(order);
  const items: TransChapReceiptLine[] = (order.items ?? []).map((line) => ({
    name: line.product_name || "Sale",
    quantity: line.quantity || 1,
    unitPrice: line.unit_price,
    lineTotal: line.line_total,
    modifiers: line.modifiers?.length ? line.modifiers : null,
  }));
  const productName = items[0]?.name || "Sale";
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    shopName,
    productName,
    items: items.length
      ? items
      : [{ name: productName, quantity: 1, unitPrice: order.total, lineTotal: order.total }],
    amount: order.total,
    tax: order.tax ?? null,
    currency: order.currency || "KES",
    payMode,
    paymentStatus: paymentStatusFromOrder(order, push),
    orderStatus: order.status,
    allowedNextStatuses: order.allowed_next_statuses ?? [],
    paidAt:
      order.paid_at ||
      order.placed_at ||
      order.created_at ||
      new Date().toISOString(),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    customerEmail: order.customer_email,
    mpesaReceiptNumber: mpesaReceiptNumberFromOrder(order),
    mpesaMessage: push?.message ?? null,
    creditOutstanding:
      creditTab?.outstanding_balance != null ? Number(creditTab.outstanding_balance) : null,
    payBillUrl: creditTab?.pay_bill_url ?? null,
    paymentSplits:
      order.payment_method === "split" ? orderPaymentPortions(order) : null,
  };
}

/** Opens WhatsApp (or WhatsApp Web) with this number as the chat recipient. */
export function whatsappChatUrl(phone: string, dialCode = "254", text?: string): string | null {
  const msisdn = toWhatsAppMsisdn(phone, dialCode);
  if (!msisdn) return null;
  const base = `https://wa.me/${msisdn}`;
  const message = text?.trim();
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

function normalizePaymentStatus(
  payMode: TransChapPayMode,
  status: TransChapReceipt["paymentStatus"] | undefined,
): TransChapPaymentStatus {
  if (status === "paid" || status === "pending" || status === "failed") return status;
  return payMode === "mpesa" || payMode === "credit" ? "pending" : "paid";
}

export function paymentStatusFromOrder(
  order: Order,
  push?: OrderMpesaPushResult | null,
): TransChapPaymentStatus {
  if (!orderUsesPayment(order, "mpesa")) {
    return orderUsesPayment(order, "credit") ? "pending" : "paid";
  }
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
