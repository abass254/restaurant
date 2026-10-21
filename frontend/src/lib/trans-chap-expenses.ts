import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { extractErrorMessage } from "@/lib/alerts";
import type { ExpenseListResponse, ShopExpense } from "@/lib/types";

export type FetchExpensesResult = {
  expenses: ShopExpense[];
  totalAmount: number;
  count: number;
  error: string | null;
};

export async function fetchTransChapExpenses(params?: {
  from?: string;
  to?: string;
  category?: string;
}): Promise<FetchExpensesResult> {
  try {
    const res = await apiFetch<ExpenseListResponse>(
      apiRoutes.expenses(params?.from, params?.to, params?.category),
    );
    return {
      expenses: res?.data ?? [],
      totalAmount: res?.total_amount ?? 0,
      count: res?.count ?? 0,
      error: null,
    };
  } catch (err) {
    return {
      expenses: [],
      totalAmount: 0,
      count: 0,
      error: extractErrorMessage(err) || "Failed to load expenses",
    };
  }
}

export async function createTransChapExpense(payload: {
  title: string;
  amount: number;
  category?: string;
  payment_method?: string;
  spent_at?: string;
  notes?: string;
}): Promise<{ expense: ShopExpense | null; error: string | null }> {
  try {
    const expense = await apiFetch<ShopExpense>(apiRoutes.expenses(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { expense: expense ?? null, error: null };
  } catch (err) {
    return { expense: null, error: extractErrorMessage(err) || "Failed to save errand" };
  }
}

export async function deleteTransChapExpense(
  id: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    await apiFetch<void>(apiRoutes.expense(id), { method: "DELETE" });
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) || "Failed to delete errand" };
  }
}
