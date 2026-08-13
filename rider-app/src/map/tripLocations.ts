export type LatLng = { latitude: number; longitude: number };

export type MapVariant = 'store' | 'customer' | 'idle';

/** Nairobi demo pins — Ngong Road store ↔ Kilimani customer. */
export const NAIROBI_CENTER: LatLng = {
  latitude: -1.2921,
  longitude: 36.8219,
};

export const STORE_COORD: LatLng = {
  latitude: -1.2985,
  longitude: 36.7906,
};

export const CUSTOMER_COORD: LatLng = {
  latitude: -1.2892,
  longitude: 36.7855,
};

/** Rider waiting / en-route position (midway idle near CBD). */
export const RIDER_COORD: LatLng = {
  latitude: -1.2934,
  longitude: 36.8012,
};

export function focusForVariant(variant: MapVariant): {
  center: LatLng;
  pins: Array<{ id: string; coord: LatLng; kind: 'store' | 'customer' | 'rider' }>;
  delta: number;
} {
  if (variant === 'store') {
    return {
      center: STORE_COORD,
      delta: 0.018,
      pins: [
        { id: 'rider', coord: RIDER_COORD, kind: 'rider' },
        { id: 'store', coord: STORE_COORD, kind: 'store' },
      ],
    };
  }
  if (variant === 'customer') {
    return {
      center: {
        latitude: (STORE_COORD.latitude + CUSTOMER_COORD.latitude) / 2,
        longitude: (STORE_COORD.longitude + CUSTOMER_COORD.longitude) / 2,
      },
      delta: 0.022,
      pins: [
        { id: 'rider', coord: STORE_COORD, kind: 'rider' },
        { id: 'customer', coord: CUSTOMER_COORD, kind: 'customer' },
      ],
    };
  }
  return {
    center: RIDER_COORD,
    delta: 0.028,
    pins: [{ id: 'rider', coord: RIDER_COORD, kind: 'rider' }],
  };
}
