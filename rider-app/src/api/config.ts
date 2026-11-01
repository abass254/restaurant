import Constants from 'expo-constants';

/**
 * Backend base URL for the rider API.
 * Set EXPO_PUBLIC_API_URL (e.g. http://192.168.1.10:7001 or https://uat.transchap.app).
 * On device/simulator, localhost will not reach the host machine — use LAN IP or tunnel.
 */
export function getApiBaseUrl(): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_API_URL?.trim() ||
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl?.trim() ||
    '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Dev default: local FastAPI. Override for physical devices.
  return 'http://127.0.0.1:7001';
}
