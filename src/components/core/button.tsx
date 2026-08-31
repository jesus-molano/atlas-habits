import type { LucideIcon } from 'lucide-react-native';
import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useTheme, type AtlasTheme } from '@/design';

import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  badge?: ReactNode;
};

function buttonColors(theme: AtlasTheme, variant: ButtonVariant) {
  switch (variant) {
    case 'secondary':
      return {
        background: theme.colors.surfaceMuted,
        pressed: theme.colors.border,
        foreground: theme.colors.text,
        border: theme.colors.border,
      };
    case 'ghost':
      return {
        background: 'transparent',
        pressed: theme.colors.surfaceMuted,
        foreground: theme.colors.primary,
        border: 'transparent',
      };
    case 'danger':
      return {
        background: theme.colors.danger,
        pressed: theme.colors.dangerPressed,
        foreground: theme.colors.textInverse,
        border: theme.colors.danger,
      };
    default:
      return {
        background: theme.colors.primary,
        pressed: theme.colors.primaryPressed,
        foreground: theme.colors.textInverse,
        border: theme.colors.primary,
      };
  }
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    label,
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leadingIcon: LeadingIcon,
    trailingIcon: TrailingIcon,
    disabled = false,
    accessibilityLabel,
    accessibilityState,
    style,
    labelStyle,
    badge,
    ...props
  },
  ref,
) {
  const theme = useTheme();
  const colors = buttonColors(theme, variant);
  const isDisabled = disabled || loading;
  const iconSize = size === 'sm' ? 17 : size === 'lg' ? 21 : 19;

  return (
    <Pressable
      ref={ref}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{
        ...accessibilityState,
        busy: loading,
        disabled: isDisabled,
      }}
      android_ripple={{ color: theme.colors.surfaceAccent }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        fullWidth && styles.fullWidth,
        {
          backgroundColor: pressed ? colors.pressed : colors.background,
          borderColor: colors.border,
          opacity: isDisabled ? 0.5 : 1,
        },
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      <View style={styles.content} pointerEvents="none">
        {loading ? (
          <ActivityIndicator color={colors.foreground} size="small" />
        ) : LeadingIcon ? (
          <LeadingIcon
            color={colors.foreground}
            size={iconSize}
            strokeWidth={2.2}
          />
        ) : null}
        <Text
          color={variant === 'ghost' ? 'primary' : undefined}
          style={[{ color: colors.foreground }, labelStyle]}
          variant="label"
        >
          {label}
        </Text>
        {badge}
        {!loading && TrailingIcon ? (
          <TrailingIcon
            color={colors.foreground}
            size={iconSize}
            strokeWidth={2.2}
          />
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sm: {
    minHeight: 48,
    paddingHorizontal: 16,
  },
  md: {
    minHeight: 52,
    paddingHorizontal: 20,
  },
  lg: {
    minHeight: 58,
    paddingHorizontal: 24,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
});
