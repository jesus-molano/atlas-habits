import type { ColorProp } from 'react-native-android-widget';

export interface AtlasWidgetPalette {
  readonly background: ColorProp;
  readonly surface: ColorProp;
  readonly text: ColorProp;
  readonly muted: ColorProp;
  readonly border: ColorProp;
  readonly accent: ColorProp;
  readonly accentText: ColorProp;
}

export const atlasWidgetPalettes = {
  light: {
    background: '#F4F1EE',
    surface: '#FFFFFF',
    text: '#070A0F',
    muted: '#626C79',
    border: '#D7DCE2',
    accent: '#E9574C',
    accentText: '#FFFFFF',
  },
  dark: {
    background: '#070A0F',
    surface: '#111720',
    text: '#F4F1EE',
    muted: '#8792A1',
    border: '#2A3442',
    accent: '#FF6B5E',
    accentText: '#070A0F',
  },
} as const satisfies Record<'light' | 'dark', AtlasWidgetPalette>;

export const widgetFonts = {
  medium: 'Manrope_500Medium',
  bold: 'Manrope_700Bold',
} as const;
