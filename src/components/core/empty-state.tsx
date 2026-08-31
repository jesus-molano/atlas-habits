import { MapPinned, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/design';

import { Button } from './button';
import { Text } from './text';

export type EmptyStateProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({
  title,
  description,
  icon: Icon = MapPinned,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
  style,
}: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityLabel={`${title}. ${description}`}
      style={[
        styles.container,
        { paddingVertical: compact ? theme.spacing.xxl : theme.spacing.giant },
        style,
      ]}
    >
      <View
        accessibilityElementsHidden
        style={[
          styles.orbit,
          {
            backgroundColor: theme.colors.surfaceAccent,
            borderColor: theme.colors.borderStrong,
          },
        ]}
      >
        <View style={[styles.route, { borderColor: theme.colors.primary }]} />
        <Icon
          color={theme.colors.primary}
          size={compact ? 26 : 32}
          strokeWidth={1.8}
        />
      </View>
      <View style={styles.copy}>
        <Text align="center" variant={compact ? 'subheading' : 'heading'}>
          {title}
        </Text>
        <Text
          align="center"
          style={styles.description}
          tone="secondary"
          variant="body"
        >
          {description}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <View style={styles.actions}>
          <Button label={actionLabel} onPress={onAction} />
          {secondaryActionLabel && onSecondaryAction ? (
            <Button
              label={secondaryActionLabel}
              onPress={onSecondaryAction}
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 20,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  orbit: {
    alignItems: 'center',
    borderRadius: 40,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  route: {
    borderRadius: 30,
    borderRightWidth: 2,
    borderTopWidth: 2,
    height: 58,
    opacity: 0.45,
    position: 'absolute',
    transform: [{ rotate: '28deg' }],
    width: 58,
  },
  copy: {
    alignItems: 'center',
    gap: 8,
    maxWidth: 420,
  },
  description: { maxWidth: 380 },
  actions: {
    alignItems: 'center',
    gap: 4,
  },
});
