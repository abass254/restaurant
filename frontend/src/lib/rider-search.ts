import { parseIso } from "@/lib/nairobi-time";
import type { DeliveryRecord } from "@/lib/types";

/** Keep in sync with backend RIDER_SEARCH_TTL_SECONDS. */
export const RIDER_SEARCH_TTL_SECONDS = 60;

export function isActivelyLookingForRider(delivery: DeliveryRecord): boolean {
  return (
    delivery.status === "searching" &&
    !delivery.assigned_rider_id
  );
}

export function isTimedOutHail(delivery: DeliveryRecord): boolean {
  return canRetryRiderSearch(delivery);
}

/** Cancelled standalone hail with no rider — can look again. */
export function canRetryRiderSearch(delivery: DeliveryRecord): boolean {
  return delivery.status === "cancelled" && !delivery.assigned_rider_id;
}

/** When the look-for-rider window ends (API field or created_at + TTL). */
export function riderSearchDeadline(delivery: DeliveryRecord): Date | null {
  if (!isActivelyLookingForRider(delivery)) return null;
  const expiresAt = parseIso(delivery.rider_search_expires_at);
  if (expiresAt) return expiresAt;
  const createdAt = parseIso(delivery.created_at);
  if (!createdAt) return null;
  return new Date(createdAt.getTime() + RIDER_SEARCH_TTL_SECONDS * 1000);
}
