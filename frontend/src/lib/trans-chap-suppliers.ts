import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type {
  ShopSupplier,
  ShopSupplierMutationResponse,
  ShopSuppliersListResponse,
} from "@/lib/types";

export async function fetchShopSuppliers(): Promise<ShopSupplier[]> {
  const res = await apiFetch<ShopSuppliersListResponse>(apiRoutes.suppliers);
  return res.data;
}

export async function createShopSupplier(payload: {
  name: string;
  phone: string;
  notes?: string | null;
}): Promise<ShopSupplier> {
  const res = await apiFetch<ShopSupplierMutationResponse>(apiRoutes.suppliers, {
    method: "POST",
    body: JSON.stringify({
      name: payload.name.trim(),
      phone: payload.phone.trim(),
      notes: payload.notes?.trim() || null,
    }),
  });
  return res.data;
}
