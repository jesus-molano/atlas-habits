import {
  addDays,
  daysBetween,
  eachDate,
  endOfMonth,
  endOfWeek,
  isLocalDate,
  isLocalTime,
  isoWeekday,
  startOfMonth,
  startOfWeek,
  type LocalDate,
  type LocalTime,
} from '../domain';
import type { CommandTargetKind } from '../platform/commands';

export type ReminderScheduleRuleType =
  'once' | 'daily' | 'weekdays' | 'interval' | 'period_quota';

export type ReminderScheduleDefinition = Readonly<{
  reminderId: string;
  itemId: string;
  itemType: 'habit' | 'task' | 'routine';
  title: string;
  scheduleSlotId: string | null;
  localTime: string | null;
  offsetMinutes: number;
  snoozeMinutes: number;
  scheduleVersionId: string;
  versionNumber: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  ruleType: ReminderScheduleRuleType;
  rule: Readonly<Record<string, unknown>>;
  taskDueAt: number | null;
  measurementType: 'boolean' | 'quantity' | 'duration' | null;
  goalTarget: number;
  goalAggregation: 'count' | 'sum' | 'duration';
}>;

export type ReminderPause = Readonly<{
  itemId: string;
  startDate: string;
  endDate: string | null;
}>;

export type ReminderMeasurement = Readonly<{
  id: string;
  itemId: string;
  occurrenceKey: string | null;
  sessionId: string | null;
  value: number;
  operation: 'add' | 'set';
  occurredAt: number;
  localDate: string;
}>;

export type ReminderOccurrenceOverride = Readonly<{
  itemId: string;
  occurrenceKey: string;
  localDate: string;
  state: 'complete' | 'excused' | 'reset' | 'force_due' | 'force_not_due';
}>;

export type ReminderTaskState = Readonly<{
  itemId: string;
  localDate: string;
  status: 'pending' | 'completed' | 'skipped' | 'cancelled';
}>;

export type ReminderRoutineState = Readonly<{
  itemId: string;
  localDate: string;
  status: 'running' | 'completed' | 'abandoned';
}>;

export type AtlasReminderPlanEntry = Readonly<{
  notificationId: string;
  reminderId: string;
  targetKind: CommandTargetKind;
  targetId: string;
  occurrenceId: string;
  title: string;
  body: string;
  fireAt: Date;
  snoozeMinutes: number;
}>;

export type BuildAtlasReminderPlanInput = Readonly<{
  definitions: readonly ReminderScheduleDefinition[];
  pauses?: readonly ReminderPause[];
  measurements?: readonly ReminderMeasurement[];
  overrides?: readonly ReminderOccurrenceOverride[];
  taskStates?: readonly ReminderTaskState[];
  routineStates?: readonly ReminderRoutineState[];
  now: Date;
  horizonDays?: number;
}>;

type Completion = Readonly<{
  key: string;
  localDate: LocalDate;
  countsTowardGoal: boolean;
}>;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function integer(value: unknown, fallback: number): number {
  return Math.max(1, Math.round(finiteNumber(value, fallback)));
}

function localDate(value: string, fallback: LocalDate): LocalDate {
  return isLocalDate(value) ? value : fallback;
}

function dateFromTimestamp(timestamp: number): LocalDate | null {
  if (!Number.isFinite(timestamp)) return null;
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return null;
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

function timeFromTimestamp(timestamp: number): LocalTime | null {
  if (!Number.isFinite(timestamp)) return null;
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return null;
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}` as LocalTime;
}

function timestampFromLocal(date: LocalDate, time: LocalTime): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function isPaused(
  itemId: string,
  date: LocalDate,
  pauses: readonly ReminderPause[],
): boolean {
  return pauses.some(
    (pause) =>
      pause.itemId === itemId &&
      isLocalDate(pause.startDate) &&
      pause.startDate <= date &&
      (pause.endDate === null ||
        (isLocalDate(pause.endDate) && pause.endDate >= date)),
  );
}

function dueDate(definition: ReminderScheduleDefinition): LocalDate | null {
  return definition.taskDueAt === null
    ? null
    : dateFromTimestamp(definition.taskDueAt);
}

function scheduledOnceDate(definition: ReminderScheduleDefinition): LocalDate {
  const from = localDate(definition.effectiveFrom, '1970-01-01');
  const ruleDate =
    typeof definition.rule.date === 'string'
      ? localDate(definition.rule.date, from)
      : from;
  const taskDate = dueDate(definition);
  return definition.itemType === 'task' && taskDate && taskDate > ruleDate
    ? taskDate
    : ruleDate;
}

function isScheduledOn(
  definition: ReminderScheduleDefinition,
  date: LocalDate,
): boolean {
  const effectiveFrom = localDate(definition.effectiveFrom, date);
  if (
    date < effectiveFrom ||
    (definition.effectiveUntil !== null &&
      isLocalDate(definition.effectiveUntil) &&
      date > definition.effectiveUntil)
  ) {
    return false;
  }

  const firstTaskDate = dueDate(definition);
  if (definition.itemType === 'task' && firstTaskDate && date < firstTaskDate) {
    return false;
  }

  switch (definition.ruleType) {
    case 'once':
      return date === scheduledOnceDate(definition);
    case 'daily':
    case 'period_quota':
      return true;
    case 'weekdays': {
      const days = Array.isArray(definition.rule.days)
        ? definition.rule.days.filter(
            (day): day is number =>
              typeof day === 'number' &&
              Number.isInteger(day) &&
              day >= 1 &&
              day <= 7,
          )
        : [];
      return days.includes(isoWeekday(date));
    }
    case 'interval': {
      const anchor =
        typeof definition.rule.anchorDate === 'string'
          ? localDate(definition.rule.anchorDate, effectiveFrom)
          : effectiveFrom;
      const distance = daysBetween(anchor, date);
      return (
        distance >= 0 && distance % integer(definition.rule.every, 1) === 0
      );
    }
  }
}

function activeDefinition(
  definitions: readonly ReminderScheduleDefinition[],
  date: LocalDate,
): ReminderScheduleDefinition | null {
  return (
    definitions
      .filter((definition) => isScheduledOn(definition, date))
      .sort((left, right) => right.versionNumber - left.versionNumber)[0] ??
    null
  );
}

function measurementKey(measurement: ReminderMeasurement): string {
  return (
    measurement.occurrenceKey ??
    (measurement.sessionId
      ? `session:${measurement.sessionId}`
      : `day:${measurement.localDate}`)
  );
}

function completionsForHabit(
  definition: ReminderScheduleDefinition,
  measurements: readonly ReminderMeasurement[],
  overrides: readonly ReminderOccurrenceOverride[],
): Completion[] {
  const grouped = new Map<
    string,
    { localDate: LocalDate; value: number; sessions: Set<string> }
  >();
  for (const measurement of measurements
    .filter(
      (entry) =>
        entry.itemId === definition.itemId && isLocalDate(entry.localDate),
    )
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
    )) {
    const key = measurementKey(measurement);
    const aggregate = grouped.get(key) ?? {
      localDate: measurement.localDate as LocalDate,
      value: 0,
      sessions: new Set<string>(),
    };
    if (measurement.operation === 'set') {
      aggregate.value = measurement.value;
      aggregate.sessions.clear();
    } else if (definition.goalAggregation === 'count') {
      const session = measurement.sessionId ?? measurement.id;
      if (measurement.value > 0 && !aggregate.sessions.has(session)) {
        aggregate.sessions.add(session);
        aggregate.value += 1;
      }
    } else {
      aggregate.value += measurement.value;
    }
    grouped.set(key, aggregate);
  }

  const completed = new Map<string, Completion>();
  for (const [key, aggregate] of grouped) {
    const goalReached =
      definition.measurementType === 'boolean'
        ? aggregate.value > 0
        : aggregate.value >= Math.max(1, definition.goalTarget);
    if (goalReached) {
      completed.set(key, {
        key,
        localDate: aggregate.localDate,
        countsTowardGoal: true,
      });
    }
  }
  for (const override of overrides) {
    if (
      override.itemId !== definition.itemId ||
      !isLocalDate(override.localDate)
    )
      continue;
    if (override.state === 'complete') {
      completed.set(override.occurrenceKey, {
        key: override.occurrenceKey,
        localDate: override.localDate,
        countsTowardGoal: true,
      });
    } else if (
      override.state === 'excused' ||
      override.state === 'force_not_due'
    ) {
      completed.set(override.occurrenceKey, {
        key: override.occurrenceKey,
        localDate: override.localDate,
        countsTowardGoal: false,
      });
    }
  }
  return [...completed.values()];
}

function quotaBounds(
  definition: ReminderScheduleDefinition,
  date: LocalDate,
): { from: LocalDate; to: LocalDate } {
  if (definition.rule.period === 'month') {
    return { from: startOfMonth(date), to: endOfMonth(date) };
  }
  const rawWeekStart = finiteNumber(definition.rule.weekStartsOn, 1);
  const weekStartsOn =
    rawWeekStart >= 1 && rawWeekStart <= 7
      ? (Math.round(rawWeekStart) as 1 | 2 | 3 | 4 | 5 | 6 | 7)
      : 1;
  return {
    from: startOfWeek(date, weekStartsOn),
    to: endOfWeek(date, weekStartsOn),
  };
}

function occurrenceId(
  definition: ReminderScheduleDefinition,
  date: LocalDate,
): string {
  const kind =
    definition.itemType === 'routine' ? 'routine' : definition.itemType;
  const item = encodeURIComponent(definition.itemId);
  if (definition.ruleType === 'period_quota') {
    const reminder = encodeURIComponent(
      definition.scheduleSlotId ?? definition.reminderId,
    );
    return `atlas:v1:${kind}:${item}:quota:${reminder}:${date}`;
  }
  if (definition.scheduleSlotId) {
    return `atlas:v1:${kind}:${item}:slot:${encodeURIComponent(
      definition.scheduleSlotId,
    )}:${date}`;
  }
  return `atlas:v1:${kind}:${item}:${date}`;
}

function targetKind(definition: ReminderScheduleDefinition): CommandTargetKind {
  return definition.itemType === 'routine'
    ? 'routine-step'
    : definition.itemType;
}

function notificationId(reminderId: string, fireAt: number): string {
  return `atlas-reminder-${encodeURIComponent(reminderId)}-${fireAt}`;
}

function reminderTime(
  definition: ReminderScheduleDefinition,
): LocalTime | null {
  if (definition.localTime && isLocalTime(definition.localTime)) {
    return definition.localTime;
  }
  return definition.taskDueAt === null
    ? null
    : timeFromTimestamp(definition.taskDueAt);
}

function isCompletedForDate(
  itemId: string,
  date: LocalDate,
  states: readonly (ReminderTaskState | ReminderRoutineState)[],
): boolean {
  return states.some(
    (state) =>
      state.itemId === itemId &&
      state.localDate === date &&
      state.status === 'completed',
  );
}

/**
 * Builds deterministic one-shot reminders in device-local wall time. Native
 * scheduling and SQLite reconciliation are intentionally kept outside this
 * pure function.
 */
export function buildAtlasReminderPlan(
  input: BuildAtlasReminderPlanInput,
): AtlasReminderPlanEntry[] {
  const horizonDays = input.horizonDays ?? 35;
  if (
    !Number.isSafeInteger(horizonDays) ||
    horizonDays < 0 ||
    horizonDays > 366
  ) {
    throw new RangeError('horizonDays must be an integer between 0 and 366.');
  }
  const today = dateFromTimestamp(input.now.getTime());
  if (!today) throw new RangeError('now must be a valid date.');
  const dates = eachDate({ from: today, to: addDays(today, horizonDays) });
  const definitionsByReminder = new Map<string, ReminderScheduleDefinition[]>();
  for (const definition of input.definitions) {
    const entries = definitionsByReminder.get(definition.reminderId) ?? [];
    entries.push(definition);
    definitionsByReminder.set(definition.reminderId, entries);
  }

  const plan: AtlasReminderPlanEntry[] = [];
  for (const definitions of definitionsByReminder.values()) {
    for (const date of dates) {
      const definition = activeDefinition(definitions, date);
      if (!definition || isPaused(definition.itemId, date, input.pauses ?? []))
        continue;
      const time = reminderTime(definition);
      if (!time) continue;

      if (
        definition.itemType === 'task' &&
        isCompletedForDate(definition.itemId, date, input.taskStates ?? [])
      ) {
        continue;
      }
      if (
        definition.itemType === 'routine' &&
        isCompletedForDate(definition.itemId, date, input.routineStates ?? [])
      ) {
        continue;
      }

      if (definition.itemType === 'habit') {
        const completions = completionsForHabit(
          definition,
          input.measurements ?? [],
          input.overrides ?? [],
        );
        if (definition.ruleType === 'period_quota') {
          const bounds = quotaBounds(definition, date);
          const quota = integer(definition.rule.quota, 1);
          const progress = new Set(
            completions
              .filter(
                (completion) =>
                  completion.countsTowardGoal &&
                  completion.localDate >= bounds.from &&
                  completion.localDate <= bounds.to,
              )
              .map((completion) => completion.key),
          ).size;
          if (progress >= quota) continue;
          const key = occurrenceId(definition, date);
          if (completions.some((completion) => completion.key === key))
            continue;
        } else if (
          completions.some((completion) =>
            definition.scheduleSlotId
              ? completion.key === occurrenceId(definition, date)
              : completion.localDate === date,
          )
        ) {
          continue;
        }
      }

      const fireAtMs =
        timestampFromLocal(date, time) + definition.offsetMinutes * 60_000;
      if (!Number.isFinite(fireAtMs) || fireAtMs <= input.now.getTime())
        continue;
      const fireAt = new Date(fireAtMs);
      plan.push({
        notificationId: notificationId(definition.reminderId, fireAtMs),
        reminderId: definition.reminderId,
        targetKind: targetKind(definition),
        targetId: definition.itemId,
        occurrenceId: occurrenceId(definition, date),
        title: definition.title,
        body: 'Toca completar o posponer',
        fireAt,
        snoozeMinutes: Math.max(1, Math.round(definition.snoozeMinutes)),
      });
    }
  }

  return plan.sort(
    (left, right) =>
      left.fireAt.getTime() - right.fireAt.getTime() ||
      left.notificationId.localeCompare(right.notificationId),
  );
}
