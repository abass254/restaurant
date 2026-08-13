import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';

/**
 * Expo Go on Android throws if `expo-notifications` is loaded (push token auto-reg).
 * Sounds / haptics / in-app toasts still work without this module.
 */
export function canUseOsNotifications(): boolean {
  if (Platform.OS === 'web') return false;
  if (isRunningInExpoGo() && Platform.OS === 'android') return false;
  return true;
}

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/** Lazily load expo-notifications only when safe for this runtime. */
export function getNotifications(): NotificationsModule | null {
  if (!canUseOsNotifications()) return null;
  if (cached !== undefined) return cached;
  try {
    // Dynamic require avoids evaluating Expo Go Android push side-effects at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
