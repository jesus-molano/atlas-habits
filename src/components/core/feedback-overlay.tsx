import type { LucideIcon } from 'lucide-react-native';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
} from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/design';

import { Button, type ButtonVariant } from './button';
import { IconButton } from './icon-button';
import { Text } from './text';

export type FeedbackTone = 'neutral' | 'success' | 'warning' | 'danger';

export type FeedbackAction = Readonly<{
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}>;

export type FeedbackSheetProps = Readonly<{
  visible: boolean;
  title: string;
  message?: string;
  tone?: FeedbackTone;
  icon?: LucideIcon;
  actions?: readonly FeedbackAction[];
  children?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}>;

const toneIcons: Record<FeedbackTone, LucideIcon> = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  danger: AlertCircle,
};

export function FeedbackSheet({
  visible,
  title,
  message,
  tone = 'neutral',
  icon,
  actions = [],
  children,
  onClose,
  closeLabel = 'Cerrar',
}: FeedbackSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const ToneIcon = icon ?? toneIcons[tone];
  const toneColor =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'danger'
          ? theme.colors.danger
          : theme.colors.info;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modal}>
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: theme.colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.sheet,
              paddingBottom: Math.max(insets.bottom, theme.spacing.lg),
            },
            theme.shadows.floating,
          ]}
        >
          <View
            style={[
              styles.handle,
              { backgroundColor: theme.colors.borderStrong },
            ]}
          />
          <View style={styles.headingRow}>
            <View
              style={[
                styles.icon,
                { backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <ToneIcon color={toneColor} size={22} strokeWidth={2.2} />
            </View>
            <Text
              accessibilityRole="header"
              style={styles.title}
              variant="subheading"
            >
              {title}
            </Text>
            <IconButton
              accessibilityLabel={closeLabel}
              icon={X}
              onPress={onClose}
              size="compact"
              variant="ghost"
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.sheetScroll}
          >
            {message ? (
              <Text style={styles.message} tone="secondary" variant="body">
                {message}
              </Text>
            ) : null}
            {children}
            {actions.length > 0 ? (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Button
                    disabled={action.disabled}
                    fullWidth
                    key={action.label}
                    label={action.label}
                    onPress={action.onPress}
                    variant={action.variant ?? 'secondary'}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export type AtlasCalendarSheetProps = Readonly<{
  visible: boolean;
  title: string;
  value: string | null;
  initialMonth?: string;
  minDate?: string;
  maxDate?: string;
  allowClear?: boolean;
  onConfirm: (date: string | null) => void;
  onClose: () => void;
}>;

const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value?: string | null): Date | null {
  if (!value || !localDatePattern.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return localDateKey(date) === value ? date : null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function clampDateKey(value: string, minDate?: string, maxDate?: string) {
  if (minDate && value < minDate) return minDate;
  if (maxDate && value > maxDate) return maxDate;
  return value;
}

function monthHasSelectableDate(
  month: Date,
  minDate?: string,
  maxDate?: string,
): boolean {
  const first = localDateKey(startOfMonth(month));
  const last = localDateKey(
    new Date(month.getFullYear(), month.getMonth() + 1, 0, 12),
  );
  return (!minDate || last >= minDate) && (!maxDate || first <= maxDate);
}

function calendarDays(month: Date) {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date,
      key: localDateKey(date),
      outsideMonth: date.getMonth() !== month.getMonth(),
    };
  });
}

function capitalized(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es') + value.slice(1);
}

/** A civil-date picker that stays inside Atlas instead of opening Android UI. */
export function AtlasCalendarSheet({
  visible,
  title,
  value,
  initialMonth,
  minDate,
  maxDate,
  allowClear = false,
  onConfirm,
  onClose,
}: AtlasCalendarSheetProps) {
  const contentKey = [value, initialMonth, minDate, maxDate]
    .map((part) => part ?? '')
    .join(':');

  return (
    <FeedbackSheet
      closeLabel="Cerrar calendario"
      icon={CalendarDays}
      onClose={onClose}
      title={title}
      visible={visible}
    >
      {visible ? (
        <AtlasCalendarContent
          allowClear={allowClear}
          initialMonth={initialMonth}
          key={contentKey}
          maxDate={maxDate}
          minDate={minDate}
          onClose={onClose}
          onConfirm={onConfirm}
          value={value}
        />
      ) : null}
    </FeedbackSheet>
  );
}

type AtlasCalendarContentProps = Omit<
  AtlasCalendarSheetProps,
  'title' | 'visible'
>;

function AtlasCalendarContent({
  value,
  initialMonth,
  minDate,
  maxDate,
  allowClear = false,
  onConfirm,
  onClose,
}: AtlasCalendarContentProps) {
  const theme = useTheme();
  const today = localDateKey(new Date());
  const initialKey = clampDateKey(
    value ?? initialMonth ?? today,
    minDate,
    maxDate,
  );
  const initialDate = parseLocalDate(initialKey) ?? new Date();
  const valueIsSelectable =
    value !== null &&
    Boolean(parseLocalDate(value)) &&
    (!minDate || value >= minDate) &&
    (!maxDate || value <= maxDate);
  const [draft, setDraft] = useState<string | null>(
    valueIsSelectable ? value : null,
  );
  const [month, setMonth] = useState(() => startOfMonth(initialDate));

  const days = useMemo(() => calendarDays(month), [month]);
  const previousMonth = addMonths(month, -1);
  const nextMonth = addMonths(month, 1);
  const selectedLabel = draft
    ? capitalized(
        (parseLocalDate(draft) ?? new Date()).toLocaleDateString('es-ES', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      )
    : 'Selecciona un día';

  return (
    <View testID="atlas-calendar" style={styles.calendar}>
      <Text tone="secondary" variant="caption">
        {selectedLabel}
      </Text>
      <View style={styles.calendarNavigation}>
        <IconButton
          accessibilityLabel="Mes anterior"
          disabled={!monthHasSelectableDate(previousMonth, minDate, maxDate)}
          icon={ChevronLeft}
          onPress={() => setMonth(previousMonth)}
          size="compact"
          testID="calendar-previous-month"
          variant="tonal"
        />
        <Text
          accessibilityLiveRegion="polite"
          align="center"
          style={styles.calendarMonth}
          variant="subheading"
        >
          {capitalized(
            month.toLocaleDateString('es-ES', {
              month: 'long',
              year: 'numeric',
            }),
          )}
        </Text>
        <IconButton
          accessibilityLabel="Mes siguiente"
          disabled={!monthHasSelectableDate(nextMonth, minDate, maxDate)}
          icon={ChevronRight}
          onPress={() => setMonth(nextMonth)}
          size="compact"
          testID="calendar-next-month"
          variant="tonal"
        />
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.calendarGrid}
      >
        {weekdays.map((weekday) => (
          <View key={weekday} style={styles.calendarWeekdaySlot}>
            <Text
              align="center"
              maxFontSizeMultiplier={1.2}
              tone="muted"
              variant="eyebrow"
            >
              {weekday}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {days.map(({ date, key, outsideMonth }) => {
          const selected = key === draft;
          const disabled =
            (minDate !== undefined && key < minDate) ||
            (maxDate !== undefined && key > maxDate);
          const isToday = key === today;
          return (
            <View
              importantForAccessibility={
                disabled ? 'no-hide-descendants' : 'auto'
              }
              key={key}
              style={styles.calendarDaySlot}
            >
              <Pressable
                accessibilityLabel={date.toLocaleDateString('es-ES', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected }}
                disabled={disabled}
                importantForAccessibility={disabled ? 'no' : 'auto'}
                onPress={() => {
                  setDraft(key);
                  if (outsideMonth) setMonth(startOfMonth(date));
                }}
                style={({ pressed }) => [
                  styles.calendarDay,
                  {
                    backgroundColor: selected
                      ? theme.colors.primary
                      : isToday
                        ? theme.colors.surfaceMuted
                        : 'transparent',
                    borderColor: selected
                      ? theme.colors.primary
                      : isToday
                        ? theme.colors.borderStrong
                        : 'transparent',
                    opacity: disabled ? 0.3 : outsideMonth ? 0.55 : 1,
                  },
                  pressed && !disabled && styles.calendarDayPressed,
                ]}
                testID={`calendar-day-${key}`}
              >
                <Text
                  align="center"
                  color={selected ? 'textInverse' : 'text'}
                  maxFontSizeMultiplier={1.3}
                  variant="bodyStrong"
                >
                  {date.getDate()}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {allowClear && value ? (
        <Button
          fullWidth
          label="Quitar fecha"
          onPress={() => onConfirm(null)}
          size="sm"
          variant="ghost"
        />
      ) : null}
      <View style={styles.calendarActions}>
        <Button
          label="Cancelar"
          onPress={onClose}
          size="sm"
          style={styles.calendarAction}
          variant="secondary"
        />
        <Button
          disabled={!draft}
          label="Aplicar"
          onPress={() => draft && onConfirm(draft)}
          size="sm"
          style={styles.calendarAction}
        />
      </View>
    </View>
  );
}

export type InlineFeedbackProps = Readonly<{
  title: string;
  message?: string;
  tone?: FeedbackTone;
  action?: FeedbackAction;
  onClose?: () => void;
  style?: StyleProp<ViewStyle>;
}>;

export function InlineFeedback({
  title,
  message,
  tone = 'neutral',
  action,
  onClose,
  style,
}: InlineFeedbackProps) {
  const theme = useTheme();
  const ToneIcon = toneIcons[tone];
  const toneColor =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'danger'
          ? theme.colors.danger
          : theme.colors.info;

  return (
    <View
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      style={[
        styles.inline,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: toneColor,
          borderRadius: theme.radii.md,
        },
        style,
      ]}
    >
      <ToneIcon color={toneColor} size={20} strokeWidth={2.2} />
      <View style={styles.inlineCopy}>
        <Text variant="label">{title}</Text>
        {message ? (
          <Text tone="secondary" variant="caption">
            {message}
          </Text>
        ) : null}
        {action ? (
          <Button
            label={action.label}
            onPress={action.onPress}
            size="sm"
            variant={action.variant ?? 'ghost'}
          />
        ) : null}
      </View>
      {onClose ? (
        <IconButton
          accessibilityLabel="Cerrar mensaje"
          icon={X}
          onPress={onClose}
          size="compact"
          variant="ghost"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 16,
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 4,
    opacity: 0.7,
    width: 42,
  },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  icon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  title: { flex: 1 },
  sheetScroll: { flexShrink: 1 },
  sheetBody: { flexGrow: 1, gap: 16 },
  message: { paddingRight: 12 },
  actions: { gap: 8 },
  calendar: { gap: 12 },
  calendarNavigation: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  calendarMonth: { flex: 1 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarWeekdaySlot: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 30,
    width: '14.285714%',
  },
  calendarDaySlot: { padding: 2, width: '14.285714%' },
  calendarDay: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    height: 48,
  },
  calendarDayPressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },
  calendarActions: { flexDirection: 'row', gap: 8 },
  calendarAction: { flex: 1 },
  inline: {
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  inlineCopy: { flex: 1, gap: 3 },
});
