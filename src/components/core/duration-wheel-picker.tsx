import { useEffect, useMemo, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { accessibility, useTheme } from '@/design';

import {
  DURATION_WHEEL_MAX_HOURS,
  durationWheelColumnMaximum,
  durationWheelParts,
  durationWheelSeconds,
  durationWheelText,
  type DurationWheelUnit,
  wheelIndexFromOffset,
} from './duration-wheel-state';
import { Text } from './text';

const ROW_HEIGHT = accessibility.minimumTouchTarget;
const VISIBLE_ROWS = 3;
const WHEEL_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS;

export type DurationWheelPickerProps = Readonly<{
  valueSeconds: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}>;

type DurationWheelColumnProps = Readonly<{
  unit: DurationWheelUnit;
  maximum: number;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}>;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function unitLabel(unit: DurationWheelUnit): string {
  switch (unit) {
    case 'hours':
      return 'Horas';
    case 'minutes':
      return 'Minutos';
    case 'seconds':
      return 'Segundos';
  }
}

function DurationWheelColumn({
  unit,
  maximum,
  value,
  disabled,
  onChange,
}: DurationWheelColumnProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const values = useMemo(
    () => Array.from({ length: maximum + 1 }, (_, index) => index),
    [maximum],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: value * ROW_HEIGHT, animated: false });
  }, [value]);

  const changeToOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = wheelIndexFromOffset(
      event.nativeEvent.contentOffset.y,
      ROW_HEIGHT,
      maximum,
    );
    if (next !== value) onChange(next);
  };

  const changeBy = (amount: number) => {
    onChange(Math.min(maximum, Math.max(0, value + amount)));
  };

  return (
    <View style={styles.column}>
      <Text align="center" tone="secondary" variant="caption">
        {unitLabel(unit)}
      </Text>
      <View style={styles.wheelFrame}>
        <View
          pointerEvents="none"
          style={[
            styles.selection,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.borderStrong,
            },
          ]}
        />
        <ScrollView
          ref={scrollRef}
          accessibilityActions={[
            {
              name: 'increment',
              label: `Aumentar ${unitLabel(unit).toLocaleLowerCase('es-ES')}`,
            },
            {
              name: 'decrement',
              label: `Reducir ${unitLabel(unit).toLocaleLowerCase('es-ES')}`,
            },
          ]}
          accessibilityLabel={unitLabel(unit)}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled }}
          accessibilityValue={{
            min: 0,
            max: maximum,
            now: value,
            text: `${twoDigits(value)} ${unitLabel(unit).toLocaleLowerCase('es-ES')}`,
          }}
          contentContainerStyle={styles.wheelContent}
          decelerationRate="fast"
          disableIntervalMomentum
          nestedScrollEnabled
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') changeBy(1);
            if (event.nativeEvent.actionName === 'decrement') changeBy(-1);
          }}
          onMomentumScrollEnd={changeToOffset}
          onScrollEndDrag={changeToOffset}
          scrollEnabled={!disabled}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={ROW_HEIGHT}
          style={styles.wheel}
        >
          {values.map((entry) => (
            <View key={entry} style={styles.row}>
              <Text
                align="center"
                maxFontSizeMultiplier={1.35}
                tone={entry === value ? 'accent' : 'secondary'}
                variant={entry === value ? 'subheading' : 'body'}
              >
                {twoDigits(entry)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * A keyboard-free, controlled duration picker. The visible rows snap to one
 * value each; TalkBack can change every wheel with increment/decrement.
 */
export function DurationWheelPicker({
  valueSeconds,
  onChange,
  disabled = false,
  accessibilityLabel = 'Duración manual',
}: DurationWheelPickerProps) {
  const theme = useTheme();
  const parts = durationWheelParts(valueSeconds);
  const updateUnit = (unit: DurationWheelUnit, value: number) => {
    onChange(durationWheelSeconds({ ...parts, [unit]: value }));
  };

  return (
    <View style={styles.root}>
      <View
        accessible
        accessibilityLabel={`${accessibilityLabel}: ${durationWheelText(parts)}`}
        accessibilityLiveRegion="polite"
        style={styles.summary}
      >
        <Text tone="secondary" variant="caption">
          Duración seleccionada
        </Text>
        <Text style={styles.summaryDigits} variant="subheading">
          {twoDigits(parts.hours)}:{twoDigits(parts.minutes)}:
          {twoDigits(parts.seconds)}
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.divider, { backgroundColor: theme.colors.border }]}
      />
      <View style={styles.columns}>
        <DurationWheelColumn
          disabled={disabled}
          maximum={DURATION_WHEEL_MAX_HOURS}
          onChange={(value) => updateUnit('hours', value)}
          unit="hours"
          value={parts.hours}
        />
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.separator}
        >
          <Text maxFontSizeMultiplier={1.35} tone="secondary" variant="metric">
            :
          </Text>
        </View>
        <DurationWheelColumn
          disabled={disabled}
          maximum={durationWheelColumnMaximum('minutes', parts.hours)}
          onChange={(value) => updateUnit('minutes', value)}
          unit="minutes"
          value={parts.minutes}
        />
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.separator}
        >
          <Text maxFontSizeMultiplier={1.35} tone="secondary" variant="metric">
            :
          </Text>
        </View>
        <DurationWheelColumn
          disabled={disabled}
          maximum={durationWheelColumnMaximum('seconds', parts.hours)}
          onChange={(value) => updateUnit('seconds', value)}
          unit="seconds"
          value={parts.seconds}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  summary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 24,
  },
  summaryDigits: { fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth },
  columns: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  column: { flex: 1, gap: 6 },
  separator: { justifyContent: 'center', paddingTop: 23 },
  wheelFrame: { height: WHEEL_HEIGHT, overflow: 'hidden' },
  wheel: { height: WHEEL_HEIGHT },
  wheelContent: { paddingVertical: ROW_HEIGHT },
  row: { height: ROW_HEIGHT, justifyContent: 'center' },
  selection: {
    borderRadius: 10,
    borderWidth: 1,
    height: ROW_HEIGHT,
    left: 0,
    position: 'absolute',
    right: 0,
    top: ROW_HEIGHT,
  },
});
