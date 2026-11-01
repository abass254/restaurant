import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorScheme, Theme, createTheme } from '@/src/theme';

export type ThemePreference = 'system' | ColorScheme;

type ThemeContextValue = Theme & {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggleScheme: () => void;
};

const STORAGE_KEY = '@TransChap-rider/theme-preference';

const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    });
  }, []);

  const resolvedScheme: ColorScheme =
    preference === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : preference;

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const toggleScheme = useCallback(() => {
    setPreference(resolvedScheme === 'dark' ? 'light' : 'dark');
  }, [resolvedScheme, setPreference]);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = createTheme(resolvedScheme);
    return {
      ...theme,
      preference,
      setPreference,
      toggleScheme,
    };
  }, [resolvedScheme, preference, setPreference, toggleScheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
