import {
  Check,
  Circle as CircleIcon,
  Minus,
  Navigation,
  Pause,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme, type AtlasColorToken, type AtlasTheme } from '@/design';

import { Text } from './text';

export type WaypointStatus =
  'planned' | 'active' | 'complete' | 'skipped' | 'missed' | 'paused';

export type StatusWaypointProps = {
  title: string;
  status: WaypointStatus;
  description?: string;
  trailingText?: string;
  statusLabel?: string;
  showConnector?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type WaypointSpec = {
  color: AtlasColorToken;
  background: AtlasColorToken;
  icon: LucideIcon;
  label: string;
};

function waypointSpec(theme: AtlasTheme, status: WaypointStatus): WaypointSpec {
  void theme;
  switch (status) {
    case 'active':
      return {
        color: 'primary',
        background: 'primaryMuted',
        icon: Navigation,
        label: 'In progress',
      };
    case 'complete':
      return {
        color: 'success',
        background: 'surfaceAccent',
        icon: Check,
        label: 'Complete',
      };
    case 'skipped':
      return {
        color: 'textMuted',
        background: 'surfaceMuted',
        icon: Minus,
        label: 'Skipped',
      };
    case 'missed':
      return {
        color: 'danger',
        background: 'surfaceMuted',
        icon: X,
        label: 'Missed',
      };
    case 'paused':
      return {
        color: 'warning',
        background: 'surfaceMuted',
        icon: Pause,
        label: 'Paused',
      };
    default:
      return {
        color: 'textMuted',
        background: 'surfaceMuted',
        icon: CircleIcon,
        label: 'Planned',
      };
  }
}

export function StatusWaypoint({
  title,
  status,
  description,
  trailingText,
  statusLabel,
  showConnector = true,
  onPress,
  disabled = false,
  style,
  testID,
}: StatusWaypointProps) {
  const theme = useTheme();
  const spec = waypointSpec(theme, status);
  const Icon = spec.icon;
  const content = (
    <>
      <View style={styles.markerColumn}>
        <View
          style={[
            styles.marker,
            {
              backgroundColor: theme.colors[spec.background],
              borderColor: theme.colors[spec.color],
            },
          ]}
        >
          <Icon color={theme.colors[spec.color]} size={15} strokeWidth={2.4} />
        </View>
        {showConnector ? (
          <View
            style={[styles.connector, { backgroundColor: theme.colors.border }]}
          />
        ) : null}
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text numberOfLines={2} style={styles.title} variant="bodyStrong">
            {title}
          </Text>
          {trailingText ? (
            <Text numberOfLines={1} tone="muted" variant="caption">
              {trailingText}
            </Text>
          ) : null}
        </View>
        {description ? (
          <Text tone="secondary" variant="caption">
            {description}
          </Text>
        ) : null}
      </View>
    </>
  );
  const accessibilityLabel = `${title}, ${statusLabel ?? spec.label}${description ? `, ${description}` : ''}`;

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: status === 'active' }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.container,
          pressed && { backgroundColor: theme.colors.surfaceMuted },
          disabled && styles.disabled,
          style,
        ]}
        testID={testID}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible
      style={[styles.container, disabled && styles.disabled, style]}
      testID={testID}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  markerColumn: {
    alignItems: 'center',
    width: 30,
  },
  marker: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1.5,
    height: 30,
    justifyContent: 'center',
    width: 30,
    zIndex: 1,
  },
  connector: {
    bottom: -16,
    position: 'absolute',
    top: 32,
    width: 1,
  },
  copy: {
    flex: 1,
    gap: 2,
    paddingBottom: 8,
    paddingTop: 3,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  title: { flex: 1 },
  disabled: { opacity: 0.5 },
});
