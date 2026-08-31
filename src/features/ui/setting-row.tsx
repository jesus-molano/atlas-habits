import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/core';
import { useTheme } from '@/design';

type SettingRowProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
};

export function SettingRow({
  icon: Icon,
  title,
  description,
  value,
  onPress,
  destructive = false,
}: SettingRowProps) {
  const theme = useTheme();
  const content = (
    <>
      <View
        style={[styles.icon, { backgroundColor: theme.colors.surfaceMuted }]}
      >
        <Icon
          color={destructive ? theme.colors.danger : theme.colors.primary}
          size={20}
          strokeWidth={2}
        />
      </View>
      <View style={styles.copy}>
        <Text tone={destructive ? 'danger' : 'primary'} variant="bodyStrong">
          {title}
        </Text>
        {description ? (
          <Text tone="secondary" variant="caption">
            {description}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text tone="muted" variant="caption">
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <ChevronRight color={theme.colors.textMuted} size={20} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  copy: { flex: 1, gap: 2 },
});
