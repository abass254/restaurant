import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { getNotifications } from '@/src/alerts/notificationsSafe';
import {
  ensureAndroidChannels,
  preloadAlertSounds,
  refreshAlertPreferences,
  setAlertToastHandler,
  setCachedAlertPreferences,
} from '@/src/alerts/riderAlerts';
import {
  saveAlertPreferences,
  type AlertPreferences,
} from '@/src/alerts/preferences';
import { parsePushPayload } from '@/src/alerts/pushStub';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

type ToastState = { title: string; body: string } | null;

type AlertContextValue = {
  preferences: AlertPreferences;
  preferencesLoaded: boolean;
  updatePreferences: (patch: Partial<AlertPreferences>) => Promise<void>;
  showToast: (title: string, body: string) => void;
};

const AlertCtx = createContext<AlertContextValue | null>(null);

function configureNotificationHandler() {
  const Notifications = getNotifications();
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<AlertPreferences>({
    soundsEnabled: true,
    hapticsEnabled: true,
    notificationsEnabled: true,
  });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((title: string, body: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ title, body });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const updatePreferences = useCallback(async (patch: Partial<AlertPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      setCachedAlertPreferences(next);
      saveAlertPreferences(next).catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    configureNotificationHandler();
    let cancelled = false;
    (async () => {
      const prefs = await refreshAlertPreferences();
      if (!cancelled) {
        setPreferences(prefs);
        setPreferencesLoaded(true);
      }
      await preloadAlertSounds();
      await ensureAndroidChannels();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAlertToastHandler(showToast);
    return () => setAlertToastHandler(null);
  }, [showToast]);

  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const parsed = parsePushPayload(data);
      const route =
        (typeof data?.route === 'string' && data.route) ||
        parsed?.route ||
        null;
      if (route) {
        try {
          router.push(route as never);
        } catch {
          // Ignore navigation failures
        }
      }
    });
    return () => sub.remove();
  }, []);

  const value = useMemo(
    () => ({
      preferences,
      preferencesLoaded,
      updatePreferences,
      showToast,
    }),
    [preferences, preferencesLoaded, updatePreferences, showToast],
  );

  return (
    <AlertCtx.Provider value={value}>
      {children}
      <InAppToast toast={toast} onDismiss={() => setToast(null)} />
    </AlertCtx.Provider>
  );
}

export function useAlerts() {
  const ctx = useContext(AlertCtx);
  if (!ctx) throw new Error('useAlerts must be used within AlertProvider');
  return ctx;
}

function InAppToast({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors, shadow } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          position: 'absolute',
          top: insets.top + 8,
          left: spacing.lg,
          right: spacing.lg,
          zIndex: 100,
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: radius.xl,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          gap: 2,
          ...shadow.lift,
        },
        title: {
          fontFamily: fonts.sansBold,
          fontSize: 15,
          color: colors.text,
        },
        body: {
          fontFamily: fonts.sans,
          fontSize: 13,
          color: colors.muted,
          lineHeight: 18,
        },
      }),
    [colors, insets.top, shadow.lift],
  );

  if (!toast) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(280)}
      exiting={FadeOutUp.duration(220)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <Pressable onPress={onDismiss} style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>{toast.title}</Text>
        <Text style={styles.body}>{toast.body}</Text>
      </Pressable>
    </Animated.View>
  );
}
