import { Platform } from 'react-native';
import Constants from 'expo-constants';

type Extra = {
  googleMapsApiKey?: string;
  googleMapsMapId?: string;
};

function readExtra(): Extra {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
  return extra;
}

export function getGoogleMapsApiKey(): string {
  const fromExtra = readExtra().googleMapsApiKey?.trim();
  if (fromExtra) return fromExtra;
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  return fromEnv || '';
}

export function getGoogleMapsMapId(): string | null {
  const fromExtra = readExtra().googleMapsMapId?.trim();
  if (fromExtra) return fromExtra;
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim();
  return fromEnv || null;
}

/** Prefer Google Maps wherever a key is available (needed for brand styles). */
export function useGoogleMapsProvider(): boolean {
  if (Platform.OS === 'web') return true;
  return Boolean(getGoogleMapsApiKey());
}
