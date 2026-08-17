export const TRANS_CHAP_RECEIPT_KEY = "trans-chap:last-receipt";

export type TransChapReceipt = {
  orderId: string | null;
  orderNumber: string;
  shopName: string;
  productName: string;
  amount: number;
  currency: string;
  payMode: "cash";
  paidAt: string;
  customerName: string | null;
  customerPhone: string | null;
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
    const parsed = JSON.parse(raw) as TransChapReceipt;
    if (!parsed?.productName || !Number.isFinite(parsed.amount)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toWhatsAppMsisdn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("254") && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return null;
}

export function transChapReceiptMessage(receipt: TransChapReceipt): string {
  const total = formatKsh(receipt.amount);
  return [
    `${receipt.orderNumber} Confirmed.`,
    `${total} paid to ${receipt.shopName} for ${receipt.productName}.`,
    receipt.customerName ? `Customer ${receipt.customerName}.` : "",
    "Paid in cash.",
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
  order: {
    id: string;
    order_number: string;
    total: number;
    currency: string;
    customer_name: string | null;
    customer_phone: string | null;
    placed_at: string | null;
    created_at: string | null;
    items?: { product_name: string }[] | null;
  },
  shopName: string,
): TransChapReceipt {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    shopName,
    productName: order.items?.[0]?.product_name || "Sale",
    amount: order.total,
    currency: order.currency || "KES",
    payMode: "cash",
    paidAt: order.placed_at || order.created_at || new Date().toISOString(),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
  };
}

export function whatsappReceiptUrl(phone: string, receipt: TransChapReceipt): string | null {
  const msisdn = toWhatsAppMsisdn(phone);
  if (!msisdn) return null;
  const text = encodeURIComponent(transChapReceiptMessage(receipt));
  return `https://wa.me/${msisdn}?text=${text}`;
}
