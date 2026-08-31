import {
  addDays,
  addMinutes,
  compareDates,
  dateIsInRange,
  daysBetween,
  eachDate,
  endOfMonth,
  endOfWeek,
  isoWeekday,
  maxDate,
  minDate,
  periodBounds,
  rangesOverlap,
  startOfMonth,
  startOfWeek,
} from './date';
import type {
  DateRange,
  HabitDefinition,
  IsoWeekday,
  LocalDate,
  LocalDateTime,
  ScheduleSlot,
  ScheduledOccurrence,
} from './model';
import { assertValidHabitDefinition } from './validation';

const IMPLICIT_SLOT: ScheduleSlot = { id: 'all-day' };

function occurrenceId(
  habit: HabitDefinition,
  periodKey: string,
  slotId: string,
): string {
  return [habit.id, habit.scheduleVersionId, periodKey, slotId]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

function endBoundary(endDate: LocalDate): LocalDateTime {
  return { date: addDays(endDate, 1), time: '00:00' };
}

function pauseDetails(
  habit: HabitDefinition,
  startDate: LocalDate,
  endDate: LocalDate,
): {
  state: 'active' | 'paused';
  pauseIds: string[];
  pausedDates: LocalDate[];
} {
  const pauses = habit.pauses ?? [];
  const pausedDates = eachDate({ from: startDate, to: endDate }).filter(
    (date) => pauses.some((pause) => dateIsInRange(date, pause)),
  );
  const pauseIds = pauses
    .filter((pause) =>
      rangesOverlap(
        { from: startDate, to: endDate },
        { from: pause.startDate, to: pause.endDate ?? endDate },
      ),
    )
    .map((pause) => pause.id);
  const dayCount = daysBetween(startDate, endDate) + 1;
  return {
    state: pausedDates.length === dayCount ? 'paused' : 'active',
    pauseIds,
    pausedDates,
  };
}

function makeOccurrence(
  habit: HabitDefinition,
  slot: ScheduleSlot,
  periodKey: string,
  nominalDate: LocalDate,
  startDate: LocalDate,
  endDate: LocalDate,
  expectedCompletions: number,
): ScheduledOccurrence {
  const dueAt = endBoundary(endDate);
  const pause = pauseDetails(habit, startDate, endDate);
  return {
    id: occurrenceId(habit, periodKey, slot.id),
    habitId: habit.id,
    scheduleVersionId: habit.scheduleVersionId,
    slotId: slot.id,
    ...(slot.label ? { slotLabel: slot.label } : {}),
    nominalDate,
    ...(slot.time
      ? { scheduledAt: { date: nominalDate, time: slot.time } }
      : {}),
    startDate,
    endDate,
    dueAt,
    closesAt: addMinutes(dueAt, habit.grace?.minutes ?? 0),
    expectedCompletions,
    ...pause,
  };
}

function isScheduledOn(habit: HabitDefinition, date: LocalDate): boolean {
  switch (habit.schedule.kind) {
    case 'once':
      return date === habit.schedule.date;
    case 'weekdays':
      return habit.schedule.days.includes(isoWeekday(date));
    case 'interval_days': {
      const distance = daysBetween(habit.schedule.anchorDate, date);
      return distance >= 0 && distance % habit.schedule.every === 0;
    }
    case 'period_quota':
      return false;
  }
}

function effectiveRange(
  habit: HabitDefinition,
  requested: DateRange,
): DateRange | null {
  const from = maxDate(requested.from, habit.activeFrom);
  const to = minDate(requested.to, habit.activeUntil ?? requested.to);
  return compareDates(from, to) <= 0 ? { from, to } : null;
}

function generateFixedOccurrences(
  habit: HabitDefinition,
  requested: DateRange,
): ScheduledOccurrence[] {
  const range = effectiveRange(habit, requested);
  if (!range) return [];
  const slots = habit.slots.length > 0 ? habit.slots : [IMPLICIT_SLOT];
  return eachDate(range).flatMap((date) => {
    if (!isScheduledOn(habit, date)) return [];
    return slots.map((slot) =>
      makeOccurrence(habit, slot, date, date, date, date, 1),
    );
  });
}

function quotaPeriodBounds(
  date: LocalDate,
  period: 'week' | 'month',
  weekStartsOn: IsoWeekday,
): { from: LocalDate; to: LocalDate; key: string } {
  if (period === 'week') {
    const from = startOfWeek(date, weekStartsOn);
    return { from, to: endOfWeek(date, weekStartsOn), key: `week-${from}` };
  }
  return {
    from: startOfMonth(date),
    to: endOfMonth(date),
    key: `month-${date.slice(0, 7)}`,
  };
}

function generateQuotaOccurrences(
  habit: HabitDefinition & {
    schedule: Extract<HabitDefinition['schedule'], { kind: 'period_quota' }>;
  },
  requested: DateRange,
  defaultWeekStartsOn: IsoWeekday,
): ScheduledOccurrence[] {
  const activeRange: DateRange = {
    from: habit.activeFrom,
    to: habit.activeUntil ?? requested.to,
  };
  if (!rangesOverlap(requested, activeRange)) return [];

  const weekStartsOn = habit.schedule.weekStartsOn ?? defaultWeekStartsOn;
  const keys = new Map<
    string,
    { from: LocalDate; to: LocalDate; key: string }
  >();
  for (const date of eachDate(requested)) {
    const bounds = quotaPeriodBounds(date, habit.schedule.period, weekStartsOn);
    keys.set(bounds.key, bounds);
  }

  return [...keys.values()]
    .filter((bounds) => rangesOverlap(bounds, activeRange))
    .map((bounds) => {
      const startDate = maxDate(bounds.from, habit.activeFrom);
      const endDate = minDate(bounds.to, habit.activeUntil ?? bounds.to);
      // A quota is one flexible occurrence for its period. Reminder/check-in
      // times are delivery opportunities and must never multiply the target.
      return makeOccurrence(
        habit,
        IMPLICIT_SLOT,
        bounds.key,
        startDate,
        startDate,
        endDate,
        habit.schedule.quota,
      );
    });
}

export interface GenerateOccurrencesOptions extends DateRange {
  weekStartsOn?: IsoWeekday;
}

/** Generate deterministic schedule instances. No wall clock or timezone is read. */
export function generateOccurrences(
  habit: HabitDefinition,
  options: GenerateOccurrencesOptions,
): ScheduledOccurrence[] {
  assertValidHabitDefinition(habit);
  if (compareDates(options.from, options.to) > 0) return [];

  const occurrences =
    habit.schedule.kind === 'period_quota'
      ? generateQuotaOccurrences(
          habit as HabitDefinition & {
            schedule: Extract<
              HabitDefinition['schedule'],
              { kind: 'period_quota' }
            >;
          },
          options,
          options.weekStartsOn ?? 1,
        )
      : generateFixedOccurrences(habit, options);

  return occurrences.sort((left, right) => {
    const byDate = compareDates(left.startDate, right.startDate);
    if (byDate !== 0) return byDate;
    const leftTime = left.scheduledAt?.time ?? '00:00';
    const rightTime = right.scheduledAt?.time ?? '00:00';
    const byTime = leftTime.localeCompare(rightTime);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}

export function expandRangeForGoal(
  range: DateRange,
  period: HabitDefinition['goal']['period'],
  weekStartsOn: IsoWeekday = 1,
): DateRange {
  if (period === 'occurrence' || period === 'day') return range;
  const fromBounds = periodBounds(range.from, period, weekStartsOn);
  const toBounds = periodBounds(range.to, period, weekStartsOn);
  return { from: fromBounds.from, to: toBounds.to };
}
