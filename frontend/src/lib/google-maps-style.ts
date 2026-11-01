/** TransChap-branded Google Maps JSON styles (warm brown + cream). */

export type GoogleMapTypeStyle = {
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string | number>>;
};

/** Matches design tokens in `styles/tokens.css`. */
export const TRANSCHAP_MAP_COLORS = {
  brown950: "#1a100c",
  brown800: "#3d2418",
  brown700: "#523220",
  brown600: "#6b422c",
  brown500: "#855538",
  brown300: "#c4926e",
  brown200: "#ddb896",
  brown100: "#edd9c4",
  brown50: "#f8f0e8",
  cream200: "#e8e2d8",
  cream100: "#f3efe8",
  cream50: "#faf8f4",
  surface: "#f7f4ef",
  water: "#d9e8ec",
  park: "#e8f0e0",
  road: "#ffffff",
  roadAlt: "#faf8f4",
  text: "#5e5749",
  textMuted: "#7a7262",
  primary: "#6b2e14",
} as const;

export const TRANSCHAP_MAP_STYLES: GoogleMapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: TRANSCHAP_MAP_COLORS.surface }] },
  { elementType: "labels.text.fill", stylers: [{ color: TRANSCHAP_MAP_COLORS.text }] },
  { elementType: "labels.text.stroke", stylers: [{ color: TRANSCHAP_MAP_COLORS.cream50 }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.cream200 }],
  },
  {
    featureType: "administrative.land_parcel",
    elementType: "labels.text.fill",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.textMuted }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.cream100 }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown50 }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown100 }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown600 }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.park }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown700 }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.road }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.roadAlt }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown200 }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown300 }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.textMuted }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.cream200 }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.water }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown600 }],
  },
];

/** Classic map pin tinted with TransChap primary brown. */
export const TRANSCHAP_MAP_MARKER_ICON = {
  path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  fillColor: TRANSCHAP_MAP_COLORS.primary,
  fillOpacity: 1,
  strokeColor: TRANSCHAP_MAP_COLORS.brown950,
  strokeWeight: 1,
  scale: 1.45,
  anchor: { x: 12, y: 22 },
} as const;

/** Store marker token — pass as `icon` to `createMarker` for merchant maps. */
export const STORE_MARKER = { type: "store" } as const;

export function isStoreMarkerIcon(icon: unknown): boolean {
  return (
    typeof icon === "object" &&
    icon !== null &&
    "type" in icon &&
    (icon as { type: string }).type === "store"
  );
}

const STORE_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 44 52" fill="none">
  <defs>
    <linearGradient id="TransChap-store-pin" x1="22" y1="2" x2="22" y2="50" gradientUnits="userSpaceOnUse">
      <stop stop-color="#855538"/>
      <stop offset="1" stop-color="#6b2e14"/>
    </linearGradient>
    <filter id="TransChap-store-shadow" x="-10%" y="-6%" width="120%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#1a100c" flood-opacity="0.24"/>
    </filter>
  </defs>
  <path filter="url(#TransChap-store-shadow)" d="M22 2C13.16 2 6 9.16 6 18c0 11.4 16 30 16 30s16-18.6 16-30C38 9.16 30.84 2 22 2Z" fill="url(#TransChap-store-pin)" stroke="#3d2418" stroke-width="1.4"/>
  <circle cx="22" cy="18" r="10.5" fill="#faf8f4" fill-opacity="0.98"/>
  <path fill="#6b2e14" d="M16.2 16.8h11.6v1.6H16.2v-1.6Zm.9-4.2h9.8l.9 3.4H16.2l.9-3.4Zm0 5.8v5.4h3.4v-2.7h3.2v2.7h3.4V18.4H17.1Z"/>
</svg>`;

/** Advanced marker DOM node for merchant store pins. */
export function createStoreMarkerElement(): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;align-items:center;width:44px;" +
    "cursor:pointer;filter:drop-shadow(0 3px 8px rgba(26,16,12,0.22));" +
    "transform:translateY(-8px);";

  const bubble = document.createElement("div");
  bubble.style.cssText =
    "width:40px;height:40px;border-radius:14px;" +
    "background:linear-gradient(145deg,#855538 0%,#6b2e14 100%);" +
    "border:2px solid #3d2418;display:grid;place-items:center;color:#faf8f4;" +
    "font-size:17px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.28);";
  bubble.innerHTML = '<i class="fas fa-store" aria-hidden="true"></i>';

  const point = document.createElement("div");
  point.style.cssText =
    "width:0;height:0;margin-top:-2px;" +
    "border-left:7px solid transparent;border-right:7px solid transparent;" +
    "border-top:10px solid #6b2e14;";

  root.append(bubble, point);
  return root;
}

function clusterMarkerSize(count: number): number {
  if (count < 10) return 44;
  if (count < 100) return 48;
  return 52;
}

function clusterMarkerSvg(count: number): string {
  const size = clusterMarkerSize(count);
  const radius = size / 2 - 2;
  const center = size / 2;
  const fontSize = count < 10 ? 15 : count < 100 ? 14 : 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <defs>
    <linearGradient id="TransChap-cluster-pin" x1="${center}" y1="2" x2="${center}" y2="${size - 2}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#855538"/>
      <stop offset="1" stop-color="#6b2e14"/>
    </linearGradient>
    <filter id="TransChap-cluster-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#1a100c" flood-opacity="0.24"/>
    </filter>
  </defs>
  <circle filter="url(#TransChap-cluster-shadow)" cx="${center}" cy="${center}" r="${radius}" fill="url(#TransChap-cluster-pin)" stroke="#3d2418" stroke-width="1.6"/>
  <text x="${center}" y="${center + fontSize * 0.35}" text-anchor="middle" fill="#faf8f4" font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="700">${count}</text>
</svg>`;
}

/** Classic `google.maps.Marker` icon config for merchant store pins. */
export function getStoreMarkerIcon() {
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(STORE_MARKER_SVG)}`,
    scaledSize: { width: 44, height: 52 },
    anchor: { x: 22, y: 52 },
  };
}

/** Classic cluster marker icon showing how many stores are grouped. */
export function getStoreClusterMarkerIcon(count: number) {
  const size = clusterMarkerSize(count);
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(clusterMarkerSvg(count))}`,
    scaledSize: { width: size, height: size },
    anchor: { x: size / 2, y: size / 2 },
  };
}

/** Advanced marker DOM node for grouped store clusters. */
export function createStoreClusterMarkerElement(count: number): HTMLElement {
  const size = clusterMarkerSize(count);
  const root = document.createElement("div");
  root.style.cssText =
    `width:${size}px;height:${size}px;border-radius:999px;` +
    "background:linear-gradient(145deg,#855538 0%,#6b2e14 100%);" +
    "border:2px solid #3d2418;color:#faf8f4;display:grid;place-items:center;" +
    `font:700 ${size < 52 ? 15 : 13}px/1 system-ui,sans-serif;` +
    "box-shadow:0 3px 8px rgba(26,16,12,0.22);cursor:pointer;";
  root.textContent = String(count);
  root.setAttribute("aria-label", `${count} merchant locations`);
  return root;
}

/** @deprecated Use `STORE_MARKER` with `createMarker` instead. */
export const TRANSCHAP_MAP_STORE_MARKER_ICON = STORE_MARKER;
