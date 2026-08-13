import { AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import {
  canUseOsNotifications,
  getNotifications,
} from '@/src/alerts/notificationsSafe';
import {
  loadAlertPreferences,
  type AlertPreferences,
} from '@/src/alerts/preferences';

export type RiderAlertEvent =
  | 'new_offer'
  | 'trip_accepted'
  | 'arrived_store'
  | 'delivery_complete';

export type RiderAlertMeta = {
  title?: string;
  body?: string;
  payoutKes?: number;
  offerId?: string;
  /** When true, skip in-app toast (caller already shows UI). */
  skipToast?: boolean;
};

type ToastHandler = (title: string, body: string) => void;

const CHANNEL_OFFERS = 'offers';
const CHANNEL_TRIPS = 'trips';

let playersReady = false;
const players: Partial<Record<'offer' | 'milestone' | 'success', AudioPlayer>> = {};
let toastHandler: ToastHandler | null = null;
let prefsCache: AlertPreferences | null = null;
/** Deduplicate new_offer when online + offer screen both fire. */
let lastOfferAt = 0;

const EVENT_COPY: Record<
  RiderAlertEvent,
  {
    title: string;
    body: (m?: RiderAlertMeta) => string;
    sound: 'offer' | 'milestone' | 'success';
    route?: (m?: RiderAlertMeta) => string;
  }
> = {
  new_offer: {
    title: 'New delivery offer',
    body: (m) =>
      m?.payoutKes != null
        ? `KES ${m.payoutKes} · tap to review`
        : 'A nearby delivery is waiting for you',
    sound: 'offer',
    route: (m) => `/offer/${m?.offerId ?? 'offer-1'}`,
  },
  trip_accepted: {
    title: 'Trip accepted',
    body: () => 'Head to the store to pick up the order',
    sound: 'milestone',
    route: () => '/trip/to-store',
  },
  arrived_store: {
    title: 'Arrived at store',
    body: () => 'Pickup the items and confirm when ready',
    sound: 'milestone',
    route: () => '/trip/arrived',
  },
  delivery_complete: {
    title: 'Delivery complete',
    body: (m) =>
      m?.payoutKes != null
        ? `You earned KES ${m.payoutKes}`
        : 'Payout added to today’s earnings',
    sound: 'success',
    route: () => '/trip/complete',
  },
};

export function setAlertToastHandler(handler: ToastHandler | null) {
  toastHandler = handler;
}

export async function refreshAlertPreferences(): Promise<AlertPreferences> {
  prefsCache = await loadAlertPreferences();
  return prefsCache;
}

export function getCachedAlertPreferences(): AlertPreferences | null {
  return prefsCache;
}

export function setCachedAlertPreferences(prefs: AlertPreferences) {
  prefsCache = prefs;
}

export { canUseOsNotifications };

export async function preloadAlertSounds(): Promise<void> {
  if (playersReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
    });
  } catch {
    // Web / restricted environments may reject mode changes
  }

  try {
    players.offer = createAudioPlayer(require('../../assets/sounds/offer.wav'));
    players.milestone = createAudioPlayer(require('../../assets/sounds/milestone.wav'));
    players.success = createAudioPlayer(require('../../assets/sounds/success.wav'));
    playersReady = true;
  } catch {
    playersReady = false;
  }
}

export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_OFFERS, {
      name: 'Delivery offers',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 120, 250],
      sound: 'offer.wav',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_TRIPS, {
      name: 'Trip updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'milestone.wav',
    });
  } catch {
    // Channels may fail on restricted environments
  }
}

export async function getNotificationPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined' | 'unavailable'
> {
  const Notifications = getNotifications();
  if (!Notifications) return 'unavailable';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') {
      await ensureAndroidChannels();
      return true;
    }
    const requested = await Notifications.requestPermissionsAsync();
    if (requested.status === 'granted') {
      await ensureAndroidChannels();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

async function playSound(key: 'offer' | 'milestone' | 'success') {
  const player = players[key];
  if (!player) {
    await preloadAlertSounds();
  }
  const p = players[key];
  if (!p) return;
  try {
    await p.seekTo(0);
    p.play();
  } catch {
    try {
      p.play();
    } catch {
      // Ignore playback failures
    }
  }
}

async function fireHaptic(event: RiderAlertEvent) {
  try {
    if (event === 'new_offer') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }
    if (event === 'trip_accepted') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    if (event === 'arrived_store') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics unavailable on web / simulator
  }
}

async function scheduleLocalNotification(
  event: RiderAlertEvent,
  title: string,
  body: string,
  meta?: RiderAlertMeta,
) {
  const Notifications = getNotifications();
  if (!Notifications) return;

  const channelId = event === 'new_offer' ? CHANNEL_OFFERS : CHANNEL_TRIPS;
  const route = EVENT_COPY[event].route?.(meta);
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound:
          event === 'new_offer'
            ? 'offer.wav'
            : event === 'delivery_complete'
              ? 'success.wav'
              : 'milestone.wav',
        data: { event, route, offerId: meta?.offerId, payoutKes: meta?.payoutKes },
        ...(Platform.OS === 'android' ? { channelId } : null),
      },
      trigger: null,
    });
  } catch {
    // Local notifications may be unavailable
  }
}

/**
 * Central alert entry point — screens should only call this.
 */
export async function notifyRider(
  event: RiderAlertEvent,
  meta?: RiderAlertMeta,
): Promise<void> {
  if (event === 'new_offer') {
    const now = Date.now();
    if (now - lastOfferAt < 2500) return;
    lastOfferAt = now;
  }

  const prefs = prefsCache ?? (await loadAlertPreferences());
  prefsCache = prefs;

  const copy = EVENT_COPY[event];
  const title = meta?.title ?? copy.title;
  const body = meta?.body ?? copy.body(meta);
  const active = isAppActive();

  if (prefs.soundsEnabled && (active || event === 'new_offer')) {
    await playSound(copy.sound);
  }

  if (prefs.hapticsEnabled && active) {
    await fireHaptic(event);
  }

  if (active) {
    if (!meta?.skipToast && toastHandler && event !== 'trip_accepted') {
      toastHandler(title, body);
    }
    return;
  }

  if (!prefs.notificationsEnabled) return;
  if (event === 'trip_accepted') return;

  const permission = await getNotificationPermissionStatus();
  if (permission !== 'granted') return;
  await scheduleLocalNotification(event, title, body, meta);
}
