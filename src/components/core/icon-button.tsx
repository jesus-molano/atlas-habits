import type { LucideIcon } from 'lucide-react-native';
import { forwardRef } from 'react';
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';

import { useTheme, type AtlasTheme } from '@/design';

export type IconButtonVariant = 'ghost' | 'tonal' | 'solid' | 'danger';
export type IconButtonSize = 'compact' | 'default' | 'large';

export type IconButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  accessibilityLabel: string;
  icon: LucideIcon;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

function iconButtonColors(
  theme: AtlasTheme,
  variant: IconButtonVariant,
  selected: boolean,
) {
  if (selected || variant === 'solid') {
    return {
      background: theme.colors.primary,
      pressed: theme.colors.primaryPressed,
      foreground: theme.colors.textInverse,
      border: theme.colors.primary,
    };
  }

  switch (variant) {
    case 'tonal':
      return {
        background: theme.colors.surfaceMuted,
        pressed: theme.colors.border,
        foreground: theme.colors.text,
        border: theme.colors.border,
      };
    case 'danger':
      return {
        background: 'transparent',
        pressed: theme.colors.surfaceMuted,
        foreground: theme.colors.danger,
        border: 'transparent',
      };
    default:
      return {
        background: 'transparent',
        pressed: theme.colors.surfaceMuted,
        foreground: theme.colors.textSecondary,
        border: 'transparent',
      };
  }
}

export const IconButton = forwardRef<View, IconButtonProps>(function IconButton(
  {
    accessibilityLabel,
    icon: Icon,
    variant = 'ghost',
    size = 'default',
    selected = false,
    disabled = false,
    accessibilityState,
    hitSlop,
    style,
    ...props
  },
  ref,
) {
  const theme = useTheme();
  const isDisabled = disabled === true;
  const colors = iconButtonColors(theme, variant, selected);
  const dimension = size === 'compact' ? 40 : size === 'large' ? 56 : 48;
  const iconSize = size === 'compact' ? 19 : size === 'large' ? 25 : 22;

  return (
    <Pressable
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{
        ...accessibilityState,
        disabled: isDisabled,
        selected,
      }}
      android_ripple={{ borderless: true, color: theme.colors.surfaceAccent }}
      disabled={isDisabled}
      hitSlop={
        hitSlop ??
        (size === 'compact' ? theme.accessibility.compactHitSlop : undefined)
      }
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed ? colors.pressed : colors.background,
          borderColor: colors.border,
          borderRadius: dimension / 2,
          height: dimension,
          opacity: isDisabled ? 0.45 : 1,
          width: dimension,
        },
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      <Icon color={colors.foreground} size={iconSize} strokeWidth={2.1} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressed: {
    transform: [{ scale: 0.94 }],
  },
});
