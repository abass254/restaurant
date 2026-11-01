import AsyncStorage from '@react-native-async-storage/async-storage';

export type AlertPreferences = {
  soundsEnabled: boolean;
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
};

const KEY = 'TransChap.rider.alertPreferences';

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  soundsEnabled: true,
  hapticsEnabled: true,
  notificationsEnabled: true,
};

export async function loadAlertPreferences(): Promise<AlertPreferences> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_ALERT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<AlertPreferences>;
    return { ...DEFAULT_ALERT_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_ALERT_PREFERENCES };
  }
}

export async function saveAlertPreferences(
  prefs: AlertPreferences,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures — alerts still work with in-memory prefs
  }
}
