import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/design';

import { Button } from './button';
import { Text } from './text';

export type SectionHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({
  title,
  eyebrow,
  description,
  icon: Icon,
  action,
  actionLabel,
  onAction,
  style,
}: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {eyebrow ? (
          <Text style={styles.eyebrow} tone="accent" variant="eyebrow">
            {eyebrow.toLocaleUpperCase()}
          </Text>
        ) : null}
        <View style={styles.titleRow}>
          {Icon ? (
            <Icon color={theme.colors.primary} size={20} strokeWidth={2.2} />
          ) : null}
          <Text style={styles.title} variant="heading">
            {title}
          </Text>
        </View>
        {description ? (
          <Text tone="secondary" variant="caption">
            {description}
          </Text>
        ) : null}
      </View>
      {action ??
        (actionLabel && onAction ? (
          <Button
            label={actionLabel}
            onPress={onAction}
            size="sm"
            variant="ghost"
          />
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    minHeight: 56,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: { marginBottom: 2 },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: { flexShrink: 1 },
});
