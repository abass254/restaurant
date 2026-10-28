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

export type TransChapPayMode = "cash" | "mpesa" | "credit" | null;
export type TransChapPaymentStatus = "paid" | "pending" | "failed";

export type TransChapReceiptLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers?: OrderItemModifier[] | null;
  sellUnit?: string | null;
};

export type TransChapReceipt = {
  orderId: string | null;
  orderNumber: string;
  shopName: string;
  headerLines?: string[] | null;
  productName: string;
  items: TransChapReceiptLine[];
  amount: number;
  subtotal?: number | null;
  deliveryFee?: number | null;
  discount?: number | null;
  tax?: number | null;
  returnedTotal?: number | null;
  tableNumber?: string | null;
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
  receiptPdfUrl?: string | null;
  /** Set for split payments; payMode then reflects the part that still needs settling. */
  paymentSplits: OrderPaymentSplit[] | null;
};

export function transChapPayLabel(payMode: TransChapPayMode): string {
  if (payMode === "mpesa") return "M-PESA";
  if (payMode === "credit") return "Credit";
  if (payMode === "cash") return "Cash";
  return "Unpaid (Pay after meal)";
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
  if (method === "cash") return "cash";
  return null;
}

function payModeFromOrder(order: Order): TransChapPayMode {
  if (!order.payment_method) return null;
  if (order.payment_method !== "split") return payModeFromMethod(order.payment_method);
  if (orderUsesPayment(order, "mpesa")) return "mpesa";
  if (orderUsesPayment(order, "credit")) return "credit";
  if (orderUsesPayment(order, "cash")) return "cash";
  return null;
}

function optionalAmount(value: unknown): number | null {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
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
                sellUnit: typeof line.sellUnit === "string" ? line.sellUnit : null,
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
      subtotal: optionalAmount(parsed.subtotal),
      deliveryFee: optionalAmount(parsed.deliveryFee),
      discount: optionalAmount(parsed.discount),
      tax: optionalAmount(parsed.tax),
      returnedTotal: optionalAmount(parsed.returnedTotal),
      tableNumber: typeof parsed.tableNumber === "string" ? parsed.tableNumber : null,
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
      receiptPdfUrl: typeof parsed.receiptPdfUrl === "string" ? parsed.receiptPdfUrl : null,
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
  if (!receipt.payMode) return false;
  if (receipt.payMode === "credit") return false;
  return receipt.payMode !== "mpesa" || receipt.paymentStatus === "paid";
}

export function isTransChapReceiptClosed(receipt: TransChapReceipt): boolean {
  return receipt.orderStatus === "cancelled" || receipt.orderStatus === "refunded";
}

function normalizeSellUnit(unit?: string | null): string {
  const raw = (unit || "").trim().toLowerCase();
  if (!raw || ["piece", "pieces", "pc", "pcs", "item", "items"].includes(raw)) {
    return "pc";
  }
  if (["kilogram", "kilograms", "kg", "kgs"].includes(raw)) return "kg";
  if (["gram", "grams", "g"].includes(raw)) return "g";
  if (["litre", "litres", "liter", "liters", "l", "ltr", "ltrs"].includes(raw)) return "L";
  if (["pack", "packs", "pk"].includes(raw)) return "pk";
  if (["box", "boxes", "bx"].includes(raw)) return "bx";
  if (raw.length <= 3) return raw;
  return "pc";
}

function formatTableAmount(amount: unknown): string {
  const val = Number(amount) || 0;
  if (Number.isInteger(val)) {
    return val.toLocaleString("en-KE");
  }
  return val.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function transChapReceiptMessage(receipt: TransChapReceipt): string {
  const isCredit = receipt.payMode === "credit";
  const lines: string[] = [
    !receipt.payMode ? "🍽️ *ORDER TICKET*" : isCredit ? "📋 *INVOICE*" : "🧾 *TILL RECEIPT*",
    `🏪 *${receipt.shopName}*`,
  ];

  const dateStr = receipt.paidAt
    ? new Date(receipt.paidAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
  lines.push(`🗓️ *Date:* ${dateStr}`);
  lines.push(`🏷️ *Ref:* ${receipt.orderNumber} ${!receipt.payMode ? "Order Placed." : "Confirmed."}`);

  if (receipt.customerName && receipt.customerName.trim().toLowerCase() !== "walk-in") {
    lines.push(`👤 *Customer:* ${receipt.customerName.trim()}`);
  }
  if (receipt.tableNumber) {
    lines.push(`🪑 *Table:* ${receipt.tableNumber}`);
  }

  const currency = receipt.currency || "KES";
  lines.push("```");
  lines.push(`ITEMS (${currency}):`);
  lines.push("");
  lines.push("ITEM".padEnd(19) + "QTY" + "PRICE".padStart(8) + "TOTAL".padStart(8));
  lines.push("─".repeat(38));

  const items = receipt.items?.length
    ? receipt.items
    : [{ name: receipt.productName, quantity: 1, unitPrice: receipt.amount, lineTotal: receipt.amount }];

  items.forEach((item) => {
    const name = (item.name || "Item").trim() || "Item";
    const qty = Number(item.quantity) || 1;
    const qtyDisp = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, "");
    const unitSuffix = normalizeSellUnit(item.sellUnit);
    const qtyStr = `${qtyDisp}${unitSuffix}`;

    const unitPrice = Number(item.unitPrice) || 0;
    const lineTotal = Number(item.lineTotal) || 0;
    const priceStr = formatTableAmount(unitPrice);
    const totalStr = formatTableAmount(lineTotal);

    const nums = qtyStr.padStart(3) + priceStr.padStart(8) + totalStr.padStart(8);
    if (name.length <= 10) {
      lines.push(name.padEnd(19) + nums);
    } else {
      if (name.length <= 38) {
        lines.push(name);
      } else {
        for (let i = 0; i < name.length; i += 38) {
          lines.push(name.slice(i, i + 38));
        }
      }
      lines.push(" ".repeat(19) + nums);
    }

    if (item.modifiers?.length) {
      item.modifiers.forEach((mod) => {
        const modPrice = Number(mod.price) || 0;
        const mStr = modPrice > 0 ? ` (${formatTableAmount(modPrice)})` : "";
        lines.push(`   + ${mod.name}${mStr}`);
      });
    }
  });

  lines.push("─".repeat(38));

  const subtotal = receipt.subtotal ?? items.reduce((sum, line) => sum + line.lineTotal, 0);
  lines.push(" ".repeat(14) + "Subtotal:".padEnd(9) + formatTableAmount(subtotal).padStart(15));

  if (receipt.discount && receipt.discount > 0) {
    lines.push(" ".repeat(14) + "Discount:".padEnd(9) + `-${formatTableAmount(receipt.discount)}`.padStart(15));
  }
  if (receipt.deliveryFee && receipt.deliveryFee > 0) {
    lines.push(" ".repeat(14) + "Delivery:".padEnd(9) + formatTableAmount(receipt.deliveryFee).padStart(15));
  }
  if (receipt.tax && receipt.tax > 0) {
    lines.push(" ".repeat(14) + "Tax (16%):".padEnd(10) + formatTableAmount(receipt.tax).padStart(14));
  }
  if (receipt.returnedTotal && receipt.returnedTotal > 0) {
    lines.push(" ".repeat(14) + "Returned:".padEnd(9) + `-${formatTableAmount(receipt.returnedTotal)}`.padStart(15));
  }

  const netTotal = Math.max(0, receipt.amount - (receipt.returnedTotal ?? 0));
  const totalLbl = receipt.returnedTotal ? "NET TOTAL:" : "TOTAL:";
  const totStr = `${currency} ${formatTableAmount(netTotal)}`;
  const lblW = totalLbl.length;
  lines.push(" ".repeat(14) + totalLbl.padEnd(lblW) + totStr.padStart(24 - lblW));

  lines.push("─".repeat(38));
  lines.push("```");

  const isSplit = Boolean(receipt.paymentSplits?.length);
  const paymentLine = !receipt.payMode
    ? "Order ticket — payment pending (to be settled after meal)."
    : isSplit
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
  lines.push(`💳 *Payment:* ${paymentLine}`);

  if ((receipt.payMode === "credit" || isSplit) && receipt.creditOutstanding != null) {
    lines.push(`📒 Your tab is now ${formatKsh(receipt.creditOutstanding)}.`);
  }
  if (receipt.payBillUrl) {
    lines.push(`🔗 Pay your bill: ${receipt.payBillUrl}`);
  }
  if (receipt.receiptPdfUrl) {
    lines.push(`📄 [View Receipt](${receipt.receiptPdfUrl})`);
  }

  lines.push("_Thank you for shopping with us._");
  return lines.join("\n");
}

export function formatKesDigits(amount: number): string {
  return amount.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function receiptHeaderLines(
  account?: { receipt_descriptions?: string[] | null } | null,
): string[] {
  const lines = account?.receipt_descriptions;
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
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
    sellUnit: line.sell_unit ?? null,
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
    subtotal: order.subtotal ?? null,
    deliveryFee: order.delivery_fee ?? null,
    discount: order.discount ?? null,
    tax: order.tax ?? null,
    returnedTotal: order.returned_total != null ? Number(order.returned_total) : null,
    tableNumber: order.table_number?.trim() || null,
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
    receiptPdfUrl:
      (order as unknown as { receipt_pdf_url?: string | null })?.receipt_pdf_url ?? null,
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
