/** Shared helpers for merchant Delivery presence UI. */

import { parseIso } from "@/lib/nairobi-time";
import type { RiderSummary } from "@/lib/types";

/** Matches backend RiderTripService.HEARTBEAT_STALE_SECONDS. */
export const RIDER_HEARTBEAT_STALE_SECONDS = 120;

export function riderIsLiveOnline(rider: RiderSummary): boolean {
  if (rider.status !== "active") return false;
  if (!rider.is_online) return false;
  const seen = parseIso(rider.last_seen_at);
  if (!seen) return false;
  return (Date.now() - seen.getTime()) / 1000 <= RIDER_HEARTBEAT_STALE_SECONDS;
}

export function formatRiderLastSeen(lastSeenAt: string | null | undefined): string {
  const seen = parseIso(lastSeenAt);
  if (!seen) return lastSeenAt ? "Unknown" : "Never seen";
  const seconds = Math.max(0, Math.round((Date.now() - seen.getTime()) / 1000));
  if (seconds < 15) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function riderInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
