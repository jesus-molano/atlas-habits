import type { PropsWithChildren } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme, type AtlasTheme } from '@/design';

export type CardVariant = 'default' | 'raised' | 'outlined' | 'tinted';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export type CardProps = PropsWithChildren<
  Omit<ViewProps, 'style'> & {
    variant?: CardVariant;
    padding?: CardPadding;
    onPress?: (event: GestureResponderEvent) => void;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
  }
>;

function cardColors(theme: AtlasTheme, variant: CardVariant) {
  switch (variant) {
    case 'outlined':
      return { background: 'transparent', border: theme.colors.border };
    case 'tinted':
      return {
        background: theme.colors.surfaceAccent,
        border: theme.colors.primaryMuted,
      };
    case 'raised':
      return {
        background: theme.colors.surfaceElevated,
        border: theme.colors.border,
      };
    default:
      return { background: theme.colors.surface, border: theme.colors.border };
  }
}

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  onPress,
  disabled = false,
  accessibilityRole,
  accessibilityState,
  style,
  ...props
}: CardProps) {
  const theme = useTheme();
  const colors = cardColors(theme, variant);
  const cardStyle: StyleProp<ViewStyle> = [
    styles.base,
    styles[`padding_${padding}`],
    {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderRadius: theme.radii.lg,
    },
    variant === 'raised' && theme.shadows.card,
    disabled && styles.disabled,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityState={{ ...accessibilityState, disabled }}
        android_ripple={{ color: theme.colors.surfaceMuted }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          cardStyle,
          pressed && !disabled && styles.pressed,
        ]}
        {...props}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      style={cardStyle}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  padding_none: { padding: 0 },
  padding_sm: { padding: 12 },
  padding_md: { padding: 16 },
  padding_lg: { padding: 24 },
  disabled: { opacity: 0.5 },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.992 }],
  },
});
