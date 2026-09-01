import type { ColorSchemeName } from 'react-native';

import {
  accessibility,
  layout,
  motion,
  radii,
  reducedMotion,
  spacing,
  typography,
  type AtlasShadow,
} from './tokens';

export type AtlasScheme = Exclude<ColorSchemeName, null | 'unspecified'>;
export type ThemeMode = AtlasScheme | 'system';

export type AtlasColors = Readonly<{
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  surfaceAccent: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  primaryMuted: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  dangerPressed: string;
  info: string;
  focus: string;
  track: string;
  scrim: string;
}>;

const lightColors: AtlasColors = {
  background: '#F7F5F2',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EFEAE5',
  surfaceAccent: '#FFE5DF',
  text: '#20242A',
  textSecondary: '#525B66',
  textMuted: '#5F6975',
  textInverse: '#FFFFFF',
  border: '#DDD6D0',
  borderStrong: '#A69B93',
  primary: '#B83232',
  primaryPressed: '#922626',
  primaryMuted: '#FFE5DF',
  accent: '#8A5A12',
  success: '#26734A',
  warning: '#83550B',
  danger: '#9D174D',
  dangerPressed: '#7A103B',
  info: '#256B98',
  focus: '#B83232',
  track: '#E3DDD7',
  scrim: 'rgba(17, 14, 14, 0.56)',
};

const darkColors: AtlasColors = {
  background: '#070A0F',
  surface: '#0E131B',
  surfaceElevated: '#151C26',
  surfaceMuted: '#1C2531',
  surfaceAccent: '#3A1D21',
  text: '#F4F1EE',
  textSecondary: '#B8C0CB',
  textMuted: '#8792A1',
  textInverse: '#070A0F',
  border: '#2A3442',
  borderStrong: '#526071',
  primary: '#FF6B5E',
  primaryPressed: '#E8564C',
  primaryMuted: '#3A1D21',
  accent: '#F2B76E',
  success: '#71D39B',
  warning: '#F1C168',
  danger: '#FF5C8A',
  dangerPressed: '#DF3E70',
  info: '#7FC5F4',
  focus: '#FF9C92',
  track: '#202936',
  scrim: 'rgba(0, 5, 10, 0.72)',
};

const lightShadows = {
  none: {},
  card: {
    shadowColor: '#17211E',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  floating: {
    shadowColor: '#17211E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
} as const satisfies Record<string, AtlasShadow>;

const darkShadows = {
  none: {},
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 4,
  },
  floating: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 10,
  },
} as const satisfies Record<string, AtlasShadow>;

export type AtlasTheme = Readonly<{
  name: 'atlas-light' | 'atlas-dark';
  scheme: AtlasScheme;
  isDark: boolean;
  colors: AtlasColors;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  motion: typeof motion | typeof reducedMotion;
  accessibility: typeof accessibility;
  layout: typeof layout;
  shadows: typeof lightShadows | typeof darkShadows;
  preferences: Readonly<{
    reduceMotion: boolean;
    highContrast: boolean;
  }>;
}>;

export type AtlasColorToken = keyof AtlasColors;

type ThemePreferences = {
  reduceMotion?: boolean;
  highContrast?: boolean;
};

export function createAtlasTheme(
  scheme: AtlasScheme,
  preferences: ThemePreferences = {},
): AtlasTheme {
  const isDark = scheme === 'dark';
  const baseColors = isDark ? darkColors : lightColors;
  const colors: AtlasColors = preferences.highContrast
    ? {
        ...baseColors,
        border: baseColors.borderStrong,
        textMuted: baseColors.textSecondary,
      }
    : baseColors;

  return {
    name: isDark ? 'atlas-dark' : 'atlas-light',
    scheme,
    isDark,
    colors,
    spacing,
    radii,
    typography,
    motion: preferences.reduceMotion ? reducedMotion : motion,
    accessibility,
    layout,
    shadows: isDark ? darkShadows : lightShadows,
    preferences: {
      reduceMotion: preferences.reduceMotion ?? false,
      highContrast: preferences.highContrast ?? false,
    },
  };
}

export const atlasLightTheme = createAtlasTheme('light');
export const atlasDarkTheme = createAtlasTheme('dark');
