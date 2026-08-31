import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, ViewStyle, type StyleProp } from 'react-native';

import { Text } from '@/components/core';
import { useTheme } from '@/design';

type ChoiceChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
};

export function ChoiceChip({
  label,
  selected = false,
  onPress,
  icon: Icon,
  style,
}: ChoiceChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      android_ripple={{ color: theme.colors.primaryMuted }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: selected
            ? theme.colors.primaryMuted
            : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      {Icon ? (
        <Icon
          color={selected ? theme.colors.primary : theme.colors.textSecondary}
          size={17}
          strokeWidth={2.2}
        />
      ) : null}
      <Text color={selected ? 'primary' : undefined} variant="label">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
});
