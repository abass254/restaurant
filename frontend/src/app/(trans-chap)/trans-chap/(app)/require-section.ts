import { redirect } from "next/navigation";
import {
  isShopOwner,
  userCanAccessSection,
  type MerchantSection,
} from "@/lib/merchant-permissions";
import { getServerUser } from "@/lib/server-auth";

export async function requireTransChapSection(section: MerchantSection) {
  const user = await getServerUser();
  if (!user || !userCanAccessSection(user, section)) {
    redirect("/trans-chap");
  }
}

/** Shop owner only (e.g. stock quantity / purchases). */
export async function requireTransChapOwner() {
  const user = await getServerUser();
  if (!user || !isShopOwner(user)) {
    redirect("/trans-chap");
  }
}
