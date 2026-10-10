import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { toWhatsAppMsisdn } from "@/lib/whatsapp-phone";
import type {
  ShopCustomer,
  ShopCustomerMutationResponse,
  ShopCustomersListResponse,
} from "@/lib/types";

export function customerPhoneKey(phone: string): string | null {
  return toWhatsAppMsisdn(phone);
}

export function findCustomerByPhone(
  customers: ShopCustomer[],
  phone: string,
): ShopCustomer | undefined {
  const key = customerPhoneKey(phone);
  if (!key) return undefined;
  return customers.find((row) => row.phone && customerPhoneKey(row.phone) === key);
}

export async function fetchShopCustomers(): Promise<ShopCustomer[]> {
  const res = await apiFetch<ShopCustomersListResponse>(apiRoutes.customers);
  return res.data;
}

export async function ensureShopCustomer(
  name: string,
  phone: string,
  existing: ShopCustomer[] = [],
): Promise<ShopCustomer> {
  const found = findCustomerByPhone(existing, phone);
  if (found) return found;
  try {
    const res = await apiFetch<ShopCustomerMutationResponse>(apiRoutes.customers, {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        credit_limit: 0,
      }),
    });
    return res.data;
  } catch (err) {
    const list = await fetchShopCustomers();
    const match = findCustomerByPhone(list, phone);
    if (match) return match;
    throw err;
  }
}
