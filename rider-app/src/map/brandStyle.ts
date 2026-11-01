/** TransChap-branded Google Maps JSON styles (warm brown + cream) — shared with the web app. */

export type GoogleMapTypeStyle = {
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string | number>>;
};

export const TRANSCHAP_MAP_COLORS = {
  brown950: '#1a100c',
  brown800: '#3d2418',
  brown700: '#523220',
  brown600: '#6b422c',
  brown500: '#855538',
  brown300: '#c4926e',
  brown200: '#ddb896',
  brown100: '#edd9c4',
  brown50: '#f8f0e8',
  cream200: '#e8e2d8',
  cream100: '#f3efe8',
  cream50: '#faf8f4',
  surface: '#f7f4ef',
  water: '#d9e8ec',
  park: '#e8f0e0',
  road: '#ffffff',
  roadAlt: '#faf8f4',
  text: '#5e5749',
  textMuted: '#7a7262',
  primary: '#6b2e14',
} as const;

/** Applied via `customMapStyle` on Google Maps (native) / MapTypeStyle (web). */
export const TRANSCHAP_MAP_STYLES: GoogleMapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: TRANSCHAP_MAP_COLORS.surface }] },
  { elementType: 'labels.text.fill', stylers: [{ color: TRANSCHAP_MAP_COLORS.text }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: TRANSCHAP_MAP_COLORS.cream50 }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.cream200 }],
  },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels.text.fill',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.textMuted }],
  },
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.cream100 }],
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown50 }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown100 }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown600 }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.park }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown700 }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.road }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.roadAlt }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown200 }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown300 }],
  },
  {
    featureType: 'road.local',
    elementType: 'labels.text.fill',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.textMuted }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.cream200 }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.water }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: TRANSCHAP_MAP_COLORS.brown600 }],
  },
];
