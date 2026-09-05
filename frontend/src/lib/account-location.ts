import type { BusinessAccount } from "@/lib/types";

export const STORE_LOCATION_REQUIRED_FOR_RIDERS =
  "Pin your store location before connecting riders. They use it to find your shop.";

export function accountHasLocationCoordinates(
  account: BusinessAccount | null | undefined,
): boolean {
  return account?.latitude != null && account?.longitude != null;
}

export function accountNeedsLocationSetup(
  account: BusinessAccount | null | undefined,
): boolean {
  return Boolean(account) && !accountHasLocationCoordinates(account);
}
