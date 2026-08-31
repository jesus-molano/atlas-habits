import type {
  DashboardItem,
  DashboardScheduleVersion,
  DashboardSnapshot,
  MeasurementType,
  ReminderRuleRecord,
  RoutineRunStep,
  RoutineStepDefinition,
  TaskSubtaskDefinition,
} from '../data';
import {
  addDays,
  calculateHabitTimeline,
  daysBetween,
  generateOccurrences,
  isLocalDate,
  isoWeekday,
  type HabitDefinition,
  type HabitMeasurement,
  type IsoWeekday,
  type LocalDate,
  type OccurrenceOverride,
  type ProgressStatus,
  type ScheduleRule,
} from '../domain';
import {
  firstReminderTime,
  scheduleLabel as atlasScheduleLabel,
} from '../features/atlas/schedule';
import {
  taskDefinitionUiValue,
  taskOccurrenceTimestamps,
} from '../features/atlas/task-occurrence';
import type {
  AtlasReminder,
  AtlasSchedule,
  AtlasSnapshot,
  DashboardSectionId,
  HabitItem,
  Priority,
  RoutineItem,
  SyncState,
  TaskItem,
} from '../features/atlas/types';

import {
  localDateFromDate,
  localTimeFromDate,
  uiTimeFromTimestamp,
} from './date-time';

const DEFAULT_DASHBOARD_ORDER: DashboardSectionId[] = [
  'routines',
  'habits',
  'tasks',
];

export type AtlasProjectionRelations = Readonly<{
  activePausesByItemId?: Readonly<
    Record<string, Readonly<{ endDate: string | null }>>
  >;
  dashboardOrder?: readonly DashboardSectionId[];
  remindersByItemId?: Readonly<Record<string, readonly ReminderRuleRecord[]>>;
  routineRunStepsByRunId?: Readonly<Record<string, readonly RoutineRunStep[]>>;
  routineStepsByRoutineId?: Readonly<
    Record<string, readonly RoutineStepDefinition[]>
  >;
  sync?: SyncState;
  tagNamesById?: Readonly<Record<string, string>>;
  taskSubtaskStatesByTaskId?: Readonly<
    Record<string, Readonly<Record<string, boolean>>>
  >;
  taskSubtasksByTaskId?: Readonly<
    Record<string, readonly TaskSubtaskDefinition[]>
  >;
}>;

export type AtlasProjectionInput = Readonly<{
  day: DashboardSnapshot;
  historyDays?: readonly DashboardSnapshot[];
  now: Date;
  relations?: AtlasProjectionRelations;
}>;

type HabitDayState = Readonly<{
  completed: boolean;
  due: boolean;
  neutral: boolean;
  skipped: boolean;
  status: ProgressStatus | null;
  value: number;
}>;

type JsonObject = Record<string, unknown>;

function parseObject(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function scheduleForItem(
  day: DashboardSnapshot,
  itemId: string,
): DashboardScheduleVersion | null {
  const candidates = day.scheduleVersions.filter(
    (version) => version.itemId === itemId,
  );
  return (
    candidates.sort(
      (left, right) => right.versionNumber - left.versionNumber,
    )[0] ?? null
  );
}

function ruleLocalDate(value: unknown, fallback: LocalDate): LocalDate {
  return typeof value === 'string' && isLocalDate(value) ? value : fallback;
}

function isoDays(value: unknown): IsoWeekday[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6, 7];
  const days = value.filter(
    (entry): entry is IsoWeekday =>
      typeof entry === 'number' &&
      Number.isInteger(entry) &&
      entry >= 1 &&
      entry <= 7,
  );
  return [...new Set(days)].sort() as IsoWeekday[];
}

function domainSchedule(
  version: DashboardScheduleVersion | null,
  localDate: LocalDate,
): ScheduleRule {
  if (!version || version.ruleType === 'daily') {
    return { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] };
  }

  switch (version.ruleType) {
    case 'once':
      return {
        kind: 'once',
        date: ruleLocalDate(
          version.rule.date,
          version.effectiveFrom as LocalDate,
        ),
      };
    case 'weekdays': {
      const days = isoDays(version.rule.days);
      return {
        kind: 'weekdays',
        days: days.length > 0 ? days : [1, 2, 3, 4, 5, 6, 7],
      };
    }
    case 'interval':
      return {
        kind: 'interval_days',
        every: Math.max(1, Math.round(numberValue(version.rule.every, 1))),
        anchorDate: ruleLocalDate(
          version.rule.anchorDate,
          version.effectiveFrom as LocalDate,
        ),
      };
    case 'period_quota':
      return {
        kind: 'period_quota',
        period: version.rule.period === 'month' ? 'month' : 'week',
        quota: Math.max(1, Math.round(numberValue(version.rule.quota, 1))),
        weekStartsOn:
          typeof version.rule.weekStartsOn === 'number' &&
          version.rule.weekStartsOn >= 1 &&
          version.rule.weekStartsOn <= 7
            ? (version.rule.weekStartsOn as IsoWeekday)
            : 1,
      };
  }
}

function projectedSchedule(
  day: DashboardSnapshot,
  itemId: string,
): AtlasSchedule {
  const version = scheduleForItem(day, itemId);
  const startDate = version?.effectiveFrom ?? day.localDate;
  const slots = day.scheduleSlots
    .filter((slot) => slot.scheduleVersionId === version?.id)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((slot) => ({
      id: slot.key,
      ...(slot.localTime ? { time: slot.localTime } : {}),
      ...(slot.label ? { label: slot.label } : {}),
    }));
  if (!version || version.ruleType === 'daily') {
    return { kind: 'daily', startDate, slots };
  }

  switch (version.ruleType) {
    case 'once':
      return {
        kind: 'once',
        date: ruleLocalDate(version.rule.date, startDate as LocalDate),
        startDate,
        slots,
      };
    case 'weekdays':
      return {
        kind: 'weekdays',
        days: isoDays(version.rule.days),
        startDate,
        slots,
      };
    case 'interval':
      return {
        kind: 'interval_days',
        every: Math.max(1, Math.round(numberValue(version.rule.every, 1))),
        anchorDate: ruleLocalDate(
          version.rule.anchorDate,
          startDate as LocalDate,
        ),
        startDate,
        slots,
      };
    case 'period_quota':
      return {
        kind: 'period_quota',
        period: version.rule.period === 'month' ? 'month' : 'week',
        quota: Math.max(1, Math.round(numberValue(version.rule.quota, 1))),
        weekStartsOn:
          typeof version.rule.weekStartsOn === 'number' &&
          version.rule.weekStartsOn >= 1 &&
          version.rule.weekStartsOn <= 7
            ? (version.rule.weekStartsOn as IsoWeekday)
            : 1,
        startDate,
        slots,
      };
  }
}

function projectedReminders(
  itemId: string,
  relations: AtlasProjectionRelations,
): AtlasReminder[] {
  return (relations.remindersByItemId?.[itemId] ?? []).flatMap((entry) =>
    entry.localTime
      ? [
          {
            id: entry.id,
            time: entry.localTime,
            enabled: entry.enabled,
            snoozeMinutes: entry.snoozeMinutes,
          },
        ]
      : [],
  );
}

function reduceMeasurements(
  measurements: DashboardSnapshot['measurements'],
  itemId: string,
): number {
  let value = 0;
  for (const measurement of measurements
    .filter((entry) => entry.itemId === itemId)
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
    )) {
    value =
      measurement.operation === 'set'
        ? measurement.value
        : value + measurement.value;
  }
  return Math.max(0, value);
}

function quotaMeasurements(
  definition: HabitDefinition,
  days: readonly DashboardSnapshot[],
  itemId: string,
): HabitMeasurement[] {
  const grouped = new Map<
    string,
    {
      id: string;
      localDate: LocalDate;
      recordedAtMs: number;
      value: number;
    }
  >();
  const rawMeasurements = days
    .flatMap((entry) => entry.measurements)
    .filter((entry) => entry.itemId === itemId)
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
    );
  for (const measurement of rawMeasurements) {
    const key =
      measurement.occurrenceKey ??
      (measurement.sessionId
        ? `session:${measurement.sessionId}`
        : `day:${measurement.localDate}`);
    const aggregate = grouped.get(key) ?? {
      id: measurement.id,
      localDate: measurement.localDate as LocalDate,
      recordedAtMs: measurement.occurredAt,
      value: 0,
    };
    aggregate.value =
      measurement.operation === 'set'
        ? measurement.value
        : aggregate.value + measurement.value;
    aggregate.id = measurement.id;
    aggregate.localDate = measurement.localDate as LocalDate;
    aggregate.recordedAtMs = measurement.occurredAt;
    grouped.set(key, aggregate);
  }

  const result: HabitMeasurement[] = [...grouped.entries()]
    .filter(([, aggregate]) => aggregate.value > 0)
    .map(([key, aggregate]) => ({
      id: `quota:${aggregate.id}`,
      habitId: itemId,
      sessionId: `quota:${key}`,
      localDate: aggregate.localDate,
      amount: definition.metric.kind === 'boolean' ? 1 : aggregate.value,
      operation: 'add' as const,
      recordedAtMs: aggregate.recordedAtMs,
    }));

  const measuredKeys = new Set(grouped.keys());
  const perSessionTarget = Math.max(1, definition.goal.target);
  for (const override of days.flatMap((entry) => entry.overrides)) {
    if (
      override.itemId !== itemId ||
      override.state !== 'complete' ||
      measuredKeys.has(override.occurrenceKey)
    ) {
      continue;
    }
    result.push({
      id: `quota-override:${override.id}`,
      habitId: itemId,
      sessionId: `quota-override:${override.occurrenceKey}`,
      localDate: override.localDate as LocalDate,
      amount: definition.metric.kind === 'boolean' ? 1 : perSessionTarget,
      operation: 'add',
      recordedAtMs: override.updatedAt,
    });
  }
  return result.sort(
    (left, right) =>
      left.recordedAtMs - right.recordedAtMs || left.id.localeCompare(right.id),
  );
}

function measurementType(value: unknown): MeasurementType {
  return value === 'quantity' || value === 'duration' ? value : 'boolean';
}

function habitDefinition(
  day: DashboardSnapshot,
  item: DashboardItem,
): HabitDefinition {
  const subtype = parseObject(item.subtypeJson);
  const version = scheduleForItem(day, item.id);
  const goal = day.scheduleGoals.find(
    (entry) => entry.scheduleVersionId === version?.id,
  );
  const metric = measurementType(subtype.measurementType);
  const unit =
    goal?.unit ??
    stringValue(subtype.unit) ??
    (metric === 'duration' ? 'seconds' : 'vez');
  const slots = day.scheduleSlots
    .filter((slot) => slot.scheduleVersionId === version?.id)
    .map((slot) => ({
      id: slot.id,
      ...(slot.localTime
        ? { time: slot.localTime as `${number}:${number}` }
        : {}),
      ...(slot.label ? { label: slot.label } : {}),
    }));
  const rule = domainSchedule(version, day.localDate as LocalDate);
  const goalPeriod =
    rule.kind === 'period_quota' ? rule.period : ('day' as const);
  const baseTarget =
    goal?.targetValue ??
    (metric === 'boolean'
      ? 1
      : Math.max(1, numberValue(subtype.defaultValue, 1)));

  return {
    id: item.id,
    title: item.title,
    scheduleVersionId: version?.id ?? `unscheduled:${item.id}`,
    metric:
      metric === 'quantity'
        ? { kind: 'count', unit }
        : metric === 'duration'
          ? { kind: 'duration', unit: 'seconds' }
          : { kind: 'boolean' },
    polarity: 'build',
    goal: {
      period: goalPeriod,
      aggregation: goal?.aggregation === 'count' ? 'count' : 'sum',
      comparator: goal?.comparison ?? 'at_least',
      target: baseTarget,
      unit,
    },
    schedule: rule,
    slots,
    activeFrom: (version?.effectiveFrom ?? day.localDate) as LocalDate,
    ...(version?.effectiveUntil
      ? { activeUntil: version.effectiveUntil as LocalDate }
      : {}),
    ...(version?.graceMinutes
      ? { grace: { minutes: version.graceMinutes } }
      : {}),
  };
}

function habitDayState(
  day: DashboardSnapshot,
  item: DashboardItem,
  today: LocalDate,
  now: Date,
  contextDays: readonly DashboardSnapshot[] = [day],
): HabitDayState {
  if (item.isPaused) {
    return {
      completed: false,
      due: true,
      neutral: true,
      skipped: false,
      status: 'paused',
      value: reduceMeasurements(day.measurements, item.id),
    };
  }

  try {
    const definition = habitDefinition(day, item);
    const date = day.localDate as LocalDate;
    const isQuota = definition.schedule.kind === 'period_quota';
    const occurrences = generateOccurrences(definition, {
      from: date,
      to: date,
    });
    if (occurrences.length === 0) {
      return {
        completed: false,
        due: false,
        neutral: true,
        skipped: false,
        status: null,
        value: 0,
      };
    }
    const relevantDays = isQuota
      ? [...contextDays, day]
          .filter(
            (entry, index, source) =>
              entry.localDate >= occurrences[0]!.startDate &&
              entry.localDate <= occurrences[0]!.endDate &&
              source.findIndex(
                (candidate) => candidate.localDate === entry.localDate,
              ) === index,
          )
          .sort((left, right) => left.localDate.localeCompare(right.localDate))
      : [day];
    const measurements: HabitMeasurement[] = isQuota
      ? quotaMeasurements(definition, relevantDays, item.id)
      : day.measurements
          .filter((entry) => entry.itemId === item.id)
          .map((entry) => ({
            id: entry.id,
            habitId: item.id,
            localDate: entry.localDate as LocalDate,
            amount: entry.value,
            operation: entry.operation,
            recordedAtMs: entry.occurredAt,
            ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
          }));
    const overrides: OccurrenceOverride[] = isQuota
      ? []
      : day.overrides.flatMap((entry) => {
          if (
            entry.itemId !== item.id ||
            (entry.state !== 'complete' &&
              entry.state !== 'excused' &&
              entry.state !== 'reset')
          ) {
            return [];
          }
          const matching = entry.slotId
            ? occurrences.find(
                (occurrence) => occurrence.slotId === entry.slotId,
              )
            : occurrences[0];
          if (!matching) return [];
          return [
            {
              id: entry.id,
              habitId: item.id,
              occurrenceId: matching.id,
              status: entry.state,
              updatedAtMs: entry.updatedAt,
              ...(entry.note ? { reason: entry.note } : {}),
            },
          ];
        });
    const asOf =
      date < today
        ? { date: addDays(date, 1), time: '00:00' as const }
        : { date, time: localTimeFromDate(now) };
    const timeline = calculateHabitTimeline(definition, {
      from: date,
      to: date,
      asOf,
      measurements,
      overrides,
    });
    const statuses = timeline.progress.map((entry) => entry.status);
    const value = isQuota
      ? definition.metric.kind === 'boolean'
        ? (timeline.progress[0]?.capturedSessions ?? 0)
        : (timeline.progress[0]?.value ?? 0)
      : reduceMeasurements(day.measurements, item.id);
    const overrideCompleted = day.overrides.some(
      (entry) => entry.itemId === item.id && entry.state === 'complete',
    );
    const overrideExcused = day.overrides.some(
      (entry) => entry.itemId === item.id && entry.state === 'excused',
    );
    const effectiveTarget =
      definition.metric.kind === 'boolean' &&
      definition.slots.length > 1 &&
      !isQuota
        ? definition.slots.length
        : definition.goal.target;
    const completed = isQuota
      ? statuses.some((status) => status === 'completed')
      : overrideCompleted ||
        value >= effectiveTarget ||
        (statuses.length > 0 &&
          statuses.every((status) => status === 'completed'));
    const neutral = isQuota
      ? false
      : overrideExcused ||
        (statuses.length > 0 &&
          statuses.every(
            (status) => status === 'excused' || status === 'paused',
          ));
    return {
      completed,
      due: true,
      neutral,
      skipped: overrideExcused,
      status: statuses[0] ?? null,
      value:
        !isQuota && overrideCompleted
          ? Math.max(value, effectiveTarget)
          : value,
    };
  } catch {
    const subtype = parseObject(item.subtypeJson);
    const target = Math.max(1, numberValue(subtype.defaultValue, 1));
    const value = reduceMeasurements(day.measurements, item.id);
    const isQuota = scheduleForItem(day, item.id)?.ruleType === 'period_quota';
    const completed =
      (!isQuota &&
        day.overrides.some(
          (entry) => entry.itemId === item.id && entry.state === 'complete',
        )) ||
      (!isQuota && value >= target);
    return {
      completed,
      due: true,
      neutral: false,
      skipped: false,
      status: completed ? 'completed' : 'pending',
      value,
    };
  }
}

function isScheduledForDay(day: DashboardSnapshot, itemId: string): boolean {
  const version = scheduleForItem(day, itemId);
  if (
    !version ||
    version.ruleType === 'daily' ||
    version.ruleType === 'period_quota'
  )
    return true;
  const date = day.localDate as LocalDate;
  if (version.ruleType === 'once') {
    return (
      ruleLocalDate(version.rule.date, version.effectiveFrom as LocalDate) ===
      date
    );
  }
  if (version.ruleType === 'weekdays')
    return isoDays(version.rule.days).includes(isoWeekday(date));
  const every = Math.max(1, Math.round(numberValue(version.rule.every, 1)));
  const anchor = ruleLocalDate(
    version.rule.anchorDate,
    version.effectiveFrom as LocalDate,
  );
  const distance = daysBetween(anchor, date);
  return distance >= 0 && distance % every === 0;
}

function taskIsComplete(day: DashboardSnapshot, itemId: string): boolean {
  return day.taskInstances
    .filter((instance) => instance.taskId === itemId)
    .some((instance) => instance.status === 'completed');
}

function routineState(
  day: DashboardSnapshot,
  itemId: string,
): { completed: boolean; running: boolean; runId: string | null } {
  const run = day.routineRuns
    .filter((entry) => entry.routineId === itemId)
    .sort((left, right) => {
      if (left.status === 'running' && right.status !== 'running') return -1;
      if (right.status === 'running' && left.status !== 'running') return 1;
      return right.startedAt - left.startedAt;
    })[0];
  return {
    completed: run?.status === 'completed',
    running: run?.status === 'running',
    runId: run?.id ?? null,
  };
}

function historyRatio(
  day: DashboardSnapshot,
  today: LocalDate,
  now: Date,
  historyDays: readonly DashboardSnapshot[],
): number {
  let completed = 0;
  let total = 0;
  for (const item of day.items) {
    if (item.isPaused || !isScheduledForDay(day, item.id)) continue;
    if (item.type === 'habit') {
      const state = habitDayState(day, item, today, now, historyDays);
      if (!state.due || state.neutral) continue;
      total += 1;
      if (state.completed) completed += 1;
      continue;
    }
    total += 1;
    if (
      item.type === 'task'
        ? taskIsComplete(day, item.id)
        : routineState(day, item.id).completed
    ) {
      completed += 1;
    }
  }
  return total === 0 ? 0 : completed / total;
}

function habitStreak(
  itemId: string,
  days: readonly DashboardSnapshot[],
  today: LocalDate,
  now: Date,
): number {
  let running = 0;
  const ordered = [...days].sort((left, right) =>
    left.localDate.localeCompare(right.localDate),
  );
  for (const day of ordered) {
    const item = day.items.find(
      (entry) => entry.id === itemId && entry.type === 'habit',
    );
    if (!item) continue;
    const state = habitDayState(day, item, today, now, days);
    if (!state.due || state.neutral) continue;
    if (state.completed) running += 1;
    else if (day.localDate < today) running = 0;
  }
  return running;
}

function itemTags(
  item: DashboardItem,
  relations: AtlasProjectionRelations,
): string[] {
  return item.tagIds.map((tagId) => relations.tagNamesById?.[tagId] ?? tagId);
}

function priorityFromNumber(value: number): Priority {
  if (value >= 3) return 'high';
  if (value >= 2) return 'medium';
  return 'low';
}

function mapHabit(
  item: DashboardItem,
  input: AtlasProjectionInput,
  historyDays: readonly DashboardSnapshot[],
): HabitItem {
  const { day, now } = input;
  const relations = input.relations ?? {};
  const subtype = parseObject(item.subtypeJson);
  const definition = habitDefinition(day, item);
  const state = habitDayState(
    day,
    item,
    day.localDate as LocalDate,
    now,
    historyDays,
  );
  const rawMetric = measurementType(subtype.measurementType);
  const schedule = projectedSchedule(day, item.id);
  const reminders = projectedReminders(item.id, relations);
  const displayTarget =
    schedule.kind === 'period_quota' && rawMetric === 'boolean'
      ? schedule.quota
      : definition.goal.target;
  return {
    id: item.id,
    kind: 'habit',
    title: item.title,
    notes: item.notes ?? undefined,
    category: item.categoryName ?? undefined,
    tags: itemTags(item, relations),
    schedule,
    reminders,
    scheduleLabel: atlasScheduleLabel(schedule),
    reminderTime: firstReminderTime(reminders),
    sortOrder: item.sortOrder,
    metric: rawMetric === 'quantity' ? 'count' : rawMetric,
    target: Math.max(1, displayTarget),
    unit: definition.goal.unit,
    value: state.value,
    completed: state.completed,
    skipped: state.skipped,
    paused: item.isPaused,
    pauseUntil: relations.activePausesByItemId?.[item.id]?.endDate ?? undefined,
    graceMinutes: definition.grace?.minutes,
    streak: habitStreak(item.id, historyDays, day.localDate as LocalDate, now),
    ...(typeof subtype.timerStartedAt === 'number'
      ? { timerStartedAt: subtype.timerStartedAt }
      : {}),
  };
}

function mapTask(item: DashboardItem, input: AtlasProjectionInput): TaskItem {
  const { day } = input;
  const relations = input.relations ?? {};
  const subtype = parseObject(item.subtypeJson);
  const instance = day.taskInstances
    .filter((entry) => entry.taskId === item.id)
    .sort(
      (left, right) =>
        (right.completedAt ?? right.scheduledFor ?? 0) -
        (left.completedAt ?? left.scheduledFor ?? 0),
    )[0];
  const version = scheduleForItem(day, item.id);
  const recurring = Boolean(version && version.ruleType !== 'once');
  const definitionDueAt =
    typeof subtype.dueAt === 'number' ? subtype.dueAt : null;
  const definitionDeadlineAt =
    typeof subtype.deadlineAt === 'number' ? subtype.deadlineAt : null;
  const occurrence = taskOccurrenceTimestamps({
    definitionDueAt,
    definitionDeadlineAt,
    ...(instance
      ? {
          instanceDueAt: instance.dueAt,
          instanceDeadlineAt: instance.deadlineAt,
        }
      : {}),
    localDate: day.localDate as LocalDate,
    recurring,
  });
  const subtaskStates = relations.taskSubtaskStatesByTaskId?.[item.id] ?? {};
  const schedule = projectedSchedule(day, item.id);
  const reminders = projectedReminders(item.id, relations);
  return {
    id: item.id,
    kind: 'task',
    title: item.title,
    notes: item.notes ?? undefined,
    category: item.categoryName ?? undefined,
    tags: itemTags(item, relations),
    schedule,
    reminders,
    scheduleLabel: atlasScheduleLabel(schedule),
    reminderTime: firstReminderTime(reminders),
    sortOrder: item.sortOrder,
    priority: priorityFromNumber(numberValue(subtype.priority, 0)),
    dueAt: taskDefinitionUiValue(definitionDueAt),
    deadlineAt: taskDefinitionUiValue(definitionDeadlineAt),
    occurrenceDueAt: uiTimeFromTimestamp(
      occurrence.dueAt,
      day.localDate as LocalDate,
    ),
    occurrenceDeadlineAt: uiTimeFromTimestamp(
      occurrence.deadlineAt,
      day.localDate as LocalDate,
    ),
    recurring,
    completed: instance?.status === 'completed',
    subtasks: (relations.taskSubtasksByTaskId?.[item.id] ?? []).map(
      (subtask) => ({
        id: subtask.id,
        title: subtask.title,
        completed: subtaskStates[subtask.id] ?? false,
        required: subtask.required,
      }),
    ),
  };
}

function mapRoutine(
  item: DashboardItem,
  input: AtlasProjectionInput,
): RoutineItem {
  const { day } = input;
  const relations = input.relations ?? {};
  const state = routineState(day, item.id);
  const runSteps = state.runId
    ? (relations.routineRunStepsByRunId?.[state.runId] ?? [])
    : [];
  const runStepById = new Map(runSteps.map((step) => [step.stepId, step]));
  const schedule = projectedSchedule(day, item.id);
  const reminders = projectedReminders(item.id, relations);
  return {
    id: item.id,
    kind: 'routine',
    title: item.title,
    notes: item.notes ?? undefined,
    category: item.categoryName ?? undefined,
    tags: itemTags(item, relations),
    schedule,
    reminders,
    scheduleLabel: atlasScheduleLabel(schedule),
    reminderTime: firstReminderTime(reminders),
    sortOrder: item.sortOrder,
    completed: state.completed,
    running: state.running,
    steps: (relations.routineStepsByRoutineId?.[item.id] ?? []).map((step) => ({
      id: step.id,
      title: step.title,
      required: step.required,
      durationSeconds: step.durationSeconds ?? undefined,
      completed: runStepById.get(step.id)?.status === 'completed',
    })),
  };
}

function normalizeDashboardOrder(
  order: readonly DashboardSectionId[] | undefined,
): DashboardSectionId[] {
  const valid = new Set<DashboardSectionId>(DEFAULT_DASHBOARD_ORDER);
  const unique = (order ?? []).filter(
    (entry, index, source) =>
      valid.has(entry) && source.indexOf(entry) === index,
  );
  return [
    ...unique,
    ...DEFAULT_DASHBOARD_ORDER.filter((entry) => !unique.includes(entry)),
  ];
}

export function mapDashboardToAtlasSnapshot(
  input: AtlasProjectionInput,
): AtlasSnapshot {
  const historyDays = [...(input.historyDays ?? [input.day])]
    .filter(
      (day, index, source) =>
        source.findIndex(
          (candidate) => candidate.localDate === day.localDate,
        ) === index,
    )
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const relations = input.relations ?? {};
  const habits = input.day.items
    .filter((item) => item.type === 'habit')
    .map((item) => mapHabit(item, input, historyDays));
  const tasks = input.day.items
    .filter((item) => item.type === 'task')
    .map((item) => mapTask(item, input));
  const routines = input.day.items
    .filter((item) => item.type === 'routine')
    .map((item) => mapRoutine(item, input));
  const today = localDateFromDate(input.now);
  const habitHistory = Object.fromEntries(
    historyDays
      .filter((historyDay) => historyDay.localDate !== today)
      .map((historyDay) => [
        historyDay.localDate,
        Object.fromEntries(
          historyDay.items
            .filter((item) => item.type === 'habit')
            .map((item) => {
              const state = habitDayState(
                historyDay,
                item,
                today,
                input.now,
                historyDays,
              );
              return [
                item.id,
                {
                  value: state.value,
                  completed: state.completed,
                  ...(state.skipped ? { skipped: true } : {}),
                  ...(item.isPaused ? { paused: true } : {}),
                  scheduled: isScheduledForDay(historyDay, item.id),
                },
              ];
            }),
        ),
      ]),
  );

  return {
    schemaVersion: 1,
    source: 'local_store',
    habits,
    tasks,
    routines,
    dashboardOrder: normalizeDashboardOrder(relations.dashboardOrder),
    history: historyDays.map((day) => ({
      date: day.localDate,
      ratio: historyRatio(day, today, input.now, historyDays),
    })),
    habitHistory,
    sync: relations.sync ?? { status: 'local-only' },
  };
}

export function dashboardSectionForItem(
  item: DashboardItem,
): DashboardSectionId {
  return item.type === 'habit'
    ? 'habits'
    : item.type === 'task'
      ? 'tasks'
      : 'routines';
}
