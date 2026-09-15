import { apiFetch } from "@/lib/api";
import { internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatKsh, whatsappChatUrl } from "@/lib/trans-chap-receipt";
import type { ShopCustomer, ShopCustomersListResponse } from "@/lib/types";

export async function fetchOwingCustomers(): Promise<{
  customers: ShopCustomer[];
  owingTotal: number;
  error: string | null;
}> {
  try {
    const res = await apiFetch<ShopCustomersListResponse>(apiRoutes.customersOwing);
    return {
      customers: res.data,
      owingTotal:
        res.owing_total ??
        res.data.reduce((sum, row) => sum + (row.outstanding_balance || 0), 0),
      error: null,
    };
  } catch {
    return {
      customers: [],
      owingTotal: 0,
      error: internalErrorMessage(),
    };
  }
}

export function buildDebtReminderWhatsAppUrl({
  customerName,
  shopName,
  amount,
  phone,
  payBillUrl,
}: {
  customerName: string;
  shopName?: string | null;
  amount: number;
  phone: string;
  payBillUrl?: string | null;
}): string | null {
  const shop = shopName?.trim() || "the shop";
  const formattedAmount = formatKsh(amount);
  const firstName = customerName ? customerName.trim().split(" ")[0] : "";
  const namePart = firstName ? `Hi ${firstName}, ` : "Hi, ";

  let message = `${namePart}this is a payment reminder from ${shop} regarding your outstanding tab balance of ${formattedAmount}.`;

  if (payBillUrl) {
    message += `\n\nYou can view your bill details and pay securely via M-PESA here:\n${payBillUrl}`;
  } else {
    message += `\n\nPlease reach out to clear your balance via M-PESA. Thank you!`;
  }

  return whatsappChatUrl(phone, "254", message);
}

