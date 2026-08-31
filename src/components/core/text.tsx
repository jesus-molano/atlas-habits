import {
  Text as NativeText,
  type StyleProp,
  type TextProps as NativeTextProps,
  type TextStyle,
} from 'react-native';

import {
  useTheme,
  type AtlasColorToken,
  type TypographyVariant,
} from '@/design';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'inverse'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export type TextProps = Omit<NativeTextProps, 'style'> & {
  variant?: TypographyVariant;
  tone?: TextTone;
  color?: AtlasColorToken;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
};

const toneTokens: Record<TextTone, AtlasColorToken> = {
  primary: 'text',
  secondary: 'textSecondary',
  muted: 'textMuted',
  inverse: 'textInverse',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function AtlasText({
  variant = 'body',
  tone = 'primary',
  color,
  align,
  allowFontScaling = true,
  maxFontSizeMultiplier,
  style,
  ...props
}: TextProps) {
  const theme = useTheme();
  const colorToken = color ?? toneTokens[tone];
  const variantStyle = theme.typography.variants[variant];
  const fontFamily =
    variantStyle.fontWeight === '700'
      ? theme.typography.fontFamilies.bold
      : variantStyle.fontWeight === '600'
        ? theme.typography.fontFamilies.semibold
        : variantStyle.fontWeight === '500'
          ? theme.typography.fontFamilies.medium
          : theme.typography.fontFamilies.regular;

  return (
    <NativeText
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={
        maxFontSizeMultiplier ?? theme.accessibility.maxFontSizeMultiplier
      }
      style={[
        {
          color: theme.colors[colorToken],
          fontFamily,
        },
        variantStyle,
        align ? { textAlign: align } : undefined,
        style,
      ]}
      {...props}
    />
  );
}

export { AtlasText as Text };
