import { StyleSheet, ViewStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  danger: string;
  dangerSoft: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  border: string;
  map: string;
  mapPin: string;
  overlay: string;
  success: string;
  star: string;
  /** Auth / marketing screens */
  authBg: string;
  heading: string;
  subtext: string;
  inputBg: string;
  inputText: string;
  placeholder: string;
  tabBarShadow: string;
  shadowBase: string;
};

export const lightColors: ThemeColors = {
  primary: '#3D4732',
  primaryPressed: '#2F3627',
  primarySoft: '#ECEFE8',
  danger: '#B54A3C',
  dangerSoft: '#F8ECEA',
  bg: '#F3F0EA',
  surface: '#FFFFFF',
  surfaceMuted: '#F0EBE3',
  text: '#2A2F24',
  muted: '#7A756C',
  border: '#E8E2D8',
  map: '#E4E8DE',
  mapPin: '#3D4732',
  overlay: 'rgba(42,47,36,0.48)',
  success: '#3D4732',
  star: '#C9A227',
  authBg: '#FFFFFF',
  heading: '#191919',
  subtext: '#6B6B6B',
  inputBg: '#F2F2F2',
  inputText: '#191919',
  placeholder: '#9A9A9A',
  tabBarShadow: '#1C1F18',
  shadowBase: '#1C1F18',
};

export const darkColors: ThemeColors = {
  primary: '#A8B89A',
  primaryPressed: '#8FA382',
  primarySoft: '#2A3324',
  danger: '#E07A6A',
  dangerSoft: '#3D2A28',
  bg: '#121410',
  surface: '#1C1F19',
  surfaceMuted: '#262920',
  text: '#F3F0EA',
  muted: '#A8A299',
  border: '#343830',
  map: '#1E221C',
  mapPin: '#A8B89A',
  overlay: 'rgba(0,0,0,0.62)',
  success: '#A8B89A',
  star: '#D4B84A',
  authBg: '#121410',
  heading: '#F5F2EC',
  subtext: '#A8A299',
  inputBg: '#262920',
  inputText: '#F5F2EC',
  placeholder: '#7A756C',
  tabBarShadow: '#000000',
  shadowBase: '#000000',
};

/** @deprecated Use useTheme() instead */
export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 14,
  md: 18,
  lg: 22,
  xl: 28,
  xxl: 32,
  cta: 999,
};

export const fonts = {
  display: 'PlusJakartaSans_700Bold',
  displayRegular: 'PlusJakartaSans_500Medium',
  sans: 'PlusJakartaSans_400Regular',
  sansMedium: 'PlusJakartaSans_500Medium',
  sansSemi: 'PlusJakartaSans_600SemiBold',
  sansBold: 'PlusJakartaSans_700Bold',
};

export type ThemeShadows = {
  soft: ViewStyle;
  card: ViewStyle;
  lift: ViewStyle;
  cta: ViewStyle;
};

export function createShadow(c: ThemeColors, isDark = false): ThemeShadows {
  const base = c.shadowBase;
  return {
    soft: {
      shadowColor: base,
      shadowOpacity: isDark ? 0.35 : 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
      boxShadow: isDark
          ? '0 8px 24px rgba(0, 0, 0, 0.35)'
          : '0 8px 24px rgba(28, 31, 24, 0.10), 0 2px 6px rgba(28, 31, 24, 0.06)',
    },
    card: {
      shadowColor: base,
      shadowOpacity: isDark ? 0.4 : 0.14,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 7,
      boxShadow: isDark
          ? '0 12px 28px rgba(0, 0, 0, 0.4)'
          : '0 12px 28px rgba(28, 31, 24, 0.12), 0 4px 10px rgba(28, 31, 24, 0.06)',
    },
    lift: {
      shadowColor: base,
      shadowOpacity: isDark ? 0.5 : 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 10,
      boxShadow: isDark
          ? '0 16px 40px rgba(0, 0, 0, 0.45)'
          : '0 16px 40px rgba(28, 31, 24, 0.14), 0 6px 14px rgba(28, 31, 24, 0.08)',
    },
    cta: {
      shadowColor: c.primary,
      shadowOpacity: isDark ? 0.45 : 0.35,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
      boxShadow: isDark
          ? '0 12px 28px rgba(168, 184, 154, 0.25)'
          : '0 12px 28px rgba(61, 71, 50, 0.32)',
    },
  };
}

/** @deprecated Use useTheme() instead */
export const shadow = createShadow(lightColors);

export type ThemeTypography = ReturnType<typeof createTypography>;

export function createTypography(c: ThemeColors) {
  return {
    stageTitle: {
      fontSize: 26,
      fontFamily: fonts.display,
      letterSpacing: -0.4,
      color: c.text,
    },
    title: {
      fontSize: 22,
      fontFamily: fonts.display,
      letterSpacing: -0.3,
      color: c.text,
    },
    body: {
      fontSize: 16,
      fontFamily: fonts.sans,
      lineHeight: 22,
      color: c.text,
    },
    bodyBold: {
      fontSize: 16,
      fontFamily: fonts.sansSemi,
      color: c.text,
    },
    caption: {
      fontSize: 13,
      fontFamily: fonts.sans,
      lineHeight: 18,
      color: c.muted,
    },
    captionBold: {
      fontSize: 13,
      fontFamily: fonts.sansSemi,
      color: c.muted,
    },
    pay: {
      fontSize: 34,
      fontFamily: fonts.display,
      letterSpacing: -0.6,
      color: c.text,
    },
    tab: {
      fontSize: 11,
      fontFamily: fonts.sansMedium,
    },
  };
}

/** @deprecated Use useTheme() instead */
export const typography = createTypography(lightColors);

export type Theme = {
  colors: ThemeColors;
  shadow: ThemeShadows;
  typography: ThemeTypography;
  isDark: boolean;
  scheme: ColorScheme;
};

export function createTheme(scheme: ColorScheme): Theme {
  const isDark = scheme === 'dark';
  const palette = isDark ? darkColors : lightColors;
  return {
    colors: palette,
    shadow: createShadow(palette, isDark),
    typography: createTypography(palette),
    isDark,
    scheme,
  };
}
