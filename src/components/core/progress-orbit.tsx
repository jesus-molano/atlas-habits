import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { useTheme, type AtlasColorToken } from '@/design';

import { Text } from './text';

export type ProgressOrbitProps = {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  tone?: Extract<
    AtlasColorToken,
    'primary' | 'accent' | 'success' | 'warning' | 'danger'
  >;
  showValue?: boolean;
  label?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ProgressOrbit({
  value,
  max = 100,
  size = 76,
  strokeWidth = 7,
  tone = 'primary',
  showValue = true,
  label,
  accessibilityLabel = 'Progress',
  style,
}: ProgressOrbitProps) {
  const theme = useTheme();
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), safeMax)
    : 0;
  const progress = safeValue / safeMax;
  const center = size / 2;
  const radius = Math.max((size - strokeWidth) / 2 - 3, 1);
  const circumference = 2 * Math.PI * radius;
  const endpointAngle = progress * Math.PI * 2 - Math.PI / 2;
  const endpointX = center + radius * Math.cos(endpointAngle);
  const endpointY = center + radius * Math.sin(endpointAngle);
  const percentage = Math.round(progress * 100);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: safeMax,
        now: safeValue,
        text: `${percentage}%`,
      }}
      style={[styles.container, { height: size, width: size }, style]}
    >
      <Svg
        accessibilityElementsHidden
        height={size}
        width={size}
        style={StyleSheet.absoluteFill}
      >
        <Circle
          cx={center}
          cy={center}
          fill="none"
          opacity={0.45}
          r={radius + 3}
          stroke={theme.colors.borderStrong}
          strokeDasharray={[1, 7]}
          strokeLinecap="round"
          strokeWidth={1}
        />
        <G origin={`${center}, ${center}`} rotation="-90">
          <Circle
            cx={center}
            cy={center}
            fill="none"
            r={radius}
            stroke={theme.colors.track}
            strokeWidth={strokeWidth}
          />
          <Circle
            cx={center}
            cy={center}
            fill="none"
            r={radius}
            stroke={theme.colors[tone]}
            strokeDasharray={[circumference, circumference]}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
          />
        </G>
        {progress > 0 ? (
          <Circle
            cx={endpointX}
            cy={endpointY}
            fill={theme.colors.surface}
            r={Math.max(strokeWidth / 3, 2)}
            stroke={theme.colors[tone]}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      {showValue ? (
        <View pointerEvents="none" style={styles.value}>
          <Text align="center" variant={size < 68 ? 'label' : 'bodyStrong'}>
            {percentage}%
          </Text>
          {label ? (
            <Text
              align="center"
              numberOfLines={1}
              tone="muted"
              variant="caption"
            >
              {label}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '68%',
  },
});
