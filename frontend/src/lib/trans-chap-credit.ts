import { apiFetch } from "@/lib/api";
import { internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
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
