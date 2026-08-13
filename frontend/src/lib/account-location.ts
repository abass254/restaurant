import type { BusinessAccount } from "@/lib/types";

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
