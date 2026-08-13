/** Maps helpers and trip phase labels for the rider PWA. */

export function mapsUrl(opts: {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  if (opts.lat != null && opts.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${opts.lat},${opts.lng}`;
  }
  const q = (opts.address || "").trim();
  if (!q) return "https://www.google.com/maps";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

export function telHref(phone: string | null | undefined): string | null {
  const raw = (phone || "").replace(/[^\d+]/g, "");
  return raw ? `tel:${raw}` : null;
}

export const TRIP_PHASE_LABELS: Record<string, string> = {
  en_route_to_store: "Rider en route",
  at_store: "Rider at store",
  picking_up: "Picking up",
  en_route_to_client: "Out for delivery",
  at_client: "Arrived at customer",
  completed: "Completed",
  cancelled: "Cancelled",
};
