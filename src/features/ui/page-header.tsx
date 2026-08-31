import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { IconButton, Text } from '@/components/core';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actionIcon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actionIcon,
  actionLabel,
  onAction,
}: PageHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        {eyebrow ? (
          <Text tone="accent" variant="eyebrow">
            {eyebrow.toLocaleUpperCase('es')}
          </Text>
        ) : null}
        <Text variant="title">{title}</Text>
        {description ? (
          <Text tone="secondary" variant="caption">
            {description}
          </Text>
        ) : null}
      </View>
      {actionIcon && actionLabel && onAction ? (
        <IconButton
          accessibilityLabel={actionLabel}
          icon={actionIcon}
          onPress={onAction}
          variant="tonal"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  copy: { flex: 1, gap: 4 },
});
