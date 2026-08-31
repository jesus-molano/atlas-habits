import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Runtime names registered by `@expo-google-fonts/manrope`. */
export const fontFamilies = {
  manrope: {
    regular: 'Manrope_400Regular',
    medium: 'Manrope_500Medium',
    semibold: 'Manrope_600SemiBold',
    bold: 'Manrope_700Bold',
  },
  fallbackSans: Platform.select({
    android: 'sans-serif',
    ios: 'System',
    web: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    default: 'sans-serif',
  }) as string,
  mono: Platform.select({
    android: 'monospace',
    ios: 'Menlo',
    web: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    default: 'monospace',
  }) as string,
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
  map: 64,
} as const;

export const radii = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  sheet: 30,
  pill: 999,
} as const;

type TypeScale = Readonly<
  Pick<TextStyle, 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight'>
>;

export const typography = {
  fontFamily: fontFamilies.manrope.regular,
  fontFamilies: fontFamilies.manrope,
  fallbackFontFamily: fontFamilies.fallbackSans,
  monoFontFamily: fontFamilies.mono,
  variants: {
    display: {
      fontSize: 40,
      lineHeight: 44,
      fontWeight: '700',
      letterSpacing: -1.1,
    },
    title: {
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '700',
      letterSpacing: -0.6,
    },
    heading: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '700',
      letterSpacing: -0.25,
    },
    subheading: {
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '600',
      letterSpacing: -0.1,
    },
    body: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '400',
      letterSpacing: 0,
    },
    bodyStrong: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '600',
      letterSpacing: 0,
    },
    label: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    caption: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '500',
      letterSpacing: 0.15,
    },
    eyebrow: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    metric: {
      fontSize: 28,
      lineHeight: 32,
      fontWeight: '700',
      letterSpacing: -0.45,
    },
  } satisfies Record<string, TypeScale>,
} as const;

export type TypographyVariant = keyof typeof typography.variants;

export const motion = {
  duration: {
    instant: 0,
    quick: 120,
    standard: 220,
    deliberate: 360,
    orbit: 600,
  },
  easing: {
    enter: [0.16, 1, 0.3, 1],
    exit: [0.7, 0, 0.84, 0],
    standard: [0.2, 0, 0, 1],
  },
} as const;

export const reducedMotion = {
  ...motion,
  duration: {
    instant: 0,
    quick: 0,
    standard: 0,
    deliberate: 0,
    orbit: 0,
  },
} as const;

export const accessibility = {
  minimumTouchTarget: 48,
  compactTouchTarget: 40,
  compactHitSlop: 4,
  focusRingWidth: 3,
  maxFontSizeMultiplier: 2,
  minimumTextContrast: 4.5,
  minimumLargeTextContrast: 3,
} as const;

export const layout = {
  contentMaxWidth: 760,
  readingMaxWidth: 620,
  screenGutter: spacing.lg,
} as const;

export type AtlasShadow = Readonly<ViewStyle>;
