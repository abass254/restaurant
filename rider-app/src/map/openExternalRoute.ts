import { Linking, Platform } from 'react-native';
import type { LatLng } from '@/src/map/tripLocations';

function coords(point: LatLng): string {
  return `${point.latitude},${point.longitude}`;
}

/**
 * Opens turn-by-turn directions from A → B in Maps
 * (Google Maps dir URL is the reliable cross-platform path).
 */
export async function openExternalRoute(
  origin: LatLng,
  destination: LatLng,
  label?: string,
): Promise<boolean> {
  const originStr = coords(origin);
  const destStr = coords(destination);
  const destLabel = encodeURIComponent(label?.trim() || 'Destination');

  const googleDir =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${originStr}` +
    `&destination=${destStr}` +
    `&travelmode=driving`;

  const candidates: string[] =
    Platform.OS === 'ios'
      ? [
          `comgooglemaps://?saddr=${originStr}&daddr=${destStr}&directionsmode=driving`,
          `maps://?saddr=${originStr}&daddr=${destStr}&dirflg=d`,
          googleDir,
        ]
      : Platform.OS === 'android'
        ? [
            // Explicit A → B (preferred for merchant / customer legs)
            `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destStr}&travelmode=driving`,
            `google.navigation:q=${destStr}&mode=d`,
            `geo:0,0?q=${destStr}(${destLabel})`,
          ]
        : [googleDir];

  for (const url of candidates) {
    try {
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        const can = await Linking.canOpenURL(url);
        if (!can) continue;
      }
      await Linking.openURL(url);
      return true;
    } catch {
      // try next scheme
    }
  }
  return false;
}
