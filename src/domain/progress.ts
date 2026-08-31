import {
  addDays,
  addMinutes,
  compareDates,
  compareDateTimes,
  maxDate,
  minDate,
  periodBounds,
  rangesOverlap,
} from './date';
import type {
  AggregationStep,
  GoalAggregation,
  GoalComparator,
  HabitDefinition,
  HabitMeasurement,
  IsoWeekday,
  LocalDateTime,
  OccurrenceOverride,
  ProgressResult,
  ProgressWindow,
  ScheduledOccurrence,
} from './model';

function stableLatestOverrides(
  overrides: readonly OccurrenceOverride[],
): Map<string, OccurrenceOverride> {
  const latest = new Map<string, OccurrenceOverride>();
  for (const override of overrides) {
    const previous = latest.get(override.occurrenceId);
    if (
      !previous ||
      override.updatedAtMs > previous.updatedAtMs ||
      (override.updatedAtMs === previous.updatedAtMs &&
        override.id.localeCompare(previous.id) > 0)
    ) {
      latest.set(override.occurrenceId, override);
    }
  }
  for (const [occurrenceId, override] of latest) {
    if (override.status === 'reset') latest.delete(occurrenceId);
  }
  return latest;
}

function windowId(habitId: string, period: string, key: string): string {
  return [habitId, 'goal', period, key]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

/** Group atomic schedule occurrences into the period used by the goal. */
export function buildProgressWindows(
  habit: HabitDefinition,
  occurrences: readonly ScheduledOccurrence[],
  weekStartsOn: IsoWeekday = 1,
): ProgressWindow[] {
  if (habit.goal.period === 'occurrence') {
    return occurrences.map((occurrence) => ({
      id: windowId(habit.id, 'occurrence', occurrence.id),
      habitId: habit.id,
      period: 'occurrence',
      periodKey: occurrence.id,
      startDate: occurrence.startDate,
      endDate: occurrence.endDate,
      dueAt: occurrence.dueAt,
      closesAt: occurrence.closesAt,
      occurrences: [occurrence],
    }));
  }

  const grouped = new Map<
    string,
    {
      bounds: ReturnType<typeof periodBounds>;
      occurrences: ScheduledOccurrence[];
    }
  >();
  for (const occurrence of occurrences) {
    const bounds = periodBounds(
      occurrence.nominalDate,
      habit.goal.period,
      weekStartsOn,
    );
    const group = grouped.get(bounds.key) ?? { bounds, occurrences: [] };
    group.occurrences.push(occurrence);
    grouped.set(bounds.key, group);
  }

  return [...grouped.values()]
    .map(({ bounds, occurrences: groupedOccurrences }) => {
      const startDate = maxDate(bounds.from, habit.activeFrom);
      const endDate = minDate(bounds.to, habit.activeUntil ?? bounds.to);
      const dueAt: LocalDateTime = { date: addDays(endDate, 1), time: '00:00' };
      return {
        id: windowId(habit.id, habit.goal.period, bounds.key),
        habitId: habit.id,
        period: habit.goal.period,
        periodKey: bounds.key,
        startDate,
        endDate,
        dueAt,
        closesAt: addMinutes(dueAt, habit.grace?.minutes ?? 0),
        occurrences: [...groupedOccurrences].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      };
    })
    .sort((left, right) => {
      const byDate = compareDates(left.startDate, right.startDate);
      return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
    });
}

interface AggregateResult {
  value: number;
  steps: AggregationStep[];
  included: HabitMeasurement[];
  ignoredIds: string[];
}

function applyAggregate(
  aggregation: GoalAggregation,
  measurements: readonly HabitMeasurement[],
): { value: number; steps: AggregationStep[] } {
  let value: number | null = null;
  let averageTotal = 0;
  let averageCount = 0;
  const sessions = new Set<string>();
  const steps: AggregationStep[] = [];

  for (const measurement of measurements) {
    const before = value;
    const sessionKey = measurement.sessionId ?? measurement.id;
    if (
      aggregation === 'count' &&
      measurement.operation === 'add' &&
      sessions.has(sessionKey)
    ) {
      steps.push({
        measurementId: measurement.id,
        operation: measurement.operation,
        amount: measurement.amount,
        before,
        after: value,
        included: false,
        reason: 'duplicate_session',
      });
      continue;
    }

    if (measurement.operation === 'set') {
      value = measurement.amount;
      if (aggregation === 'count') sessions.clear();
      if (aggregation === 'average') {
        averageTotal = measurement.amount;
        averageCount = 1;
      }
    } else {
      switch (aggregation) {
        case 'sum':
          value = (value ?? 0) + measurement.amount;
          break;
        case 'count':
          sessions.add(sessionKey);
          value = (value ?? 0) + (measurement.amount > 0 ? 1 : 0);
          break;
        case 'average':
          averageTotal += measurement.amount;
          averageCount += 1;
          value = averageTotal / averageCount;
          break;
        case 'latest':
          value = measurement.amount;
          break;
        case 'maximum':
          value =
            value === null
              ? measurement.amount
              : Math.max(value, measurement.amount);
          break;
        case 'minimum':
          value =
            value === null
              ? measurement.amount
              : Math.min(value, measurement.amount);
          break;
      }
    }
    steps.push({
      measurementId: measurement.id,
      operation: measurement.operation,
      amount: measurement.amount,
      before,
      after: value,
      included: true,
      reason: 'applied',
    });
  }
  return { value: value ?? 0, steps };
}

function aggregateForWindow(
  habit: HabitDefinition,
  window: ProgressWindow,
  measurements: readonly HabitMeasurement[],
  eligibleOccurrenceIds: ReadonlySet<string>,
  asOf: LocalDateTime,
): AggregateResult {
  const included: HabitMeasurement[] = [];
  const ignoredIds: string[] = [];
  const rejectedSteps: AggregationStep[] = [];

  for (const measurement of measurements) {
    let reason: AggregationStep['reason'] | null = null;
    if (measurement.habitId !== habit.id) {
      reason = 'wrong_habit';
    } else if (compareDates(measurement.localDate, asOf.date) > 0) {
      reason = 'not_in_window';
    } else if (measurement.occurrenceId) {
      if (!eligibleOccurrenceIds.has(measurement.occurrenceId))
        reason = 'not_in_window';
    } else if (
      compareDates(measurement.localDate, window.startDate) < 0 ||
      compareDates(measurement.localDate, window.endDate) > 0 ||
      (window.period === 'occurrence' && eligibleOccurrenceIds.size !== 1)
    ) {
      reason = 'not_in_window';
    }

    if (reason) {
      ignoredIds.push(measurement.id);
      rejectedSteps.push({
        measurementId: measurement.id,
        operation: measurement.operation,
        amount: measurement.amount,
        before: null,
        after: null,
        included: false,
        reason,
      });
    } else {
      included.push(measurement);
    }
  }

  included.sort(
    (left, right) =>
      left.recordedAtMs - right.recordedAtMs || left.id.localeCompare(right.id),
  );
  const aggregate = applyAggregate(habit.goal.aggregation, included);
  return {
    value: aggregate.value,
    steps: [...aggregate.steps, ...rejectedSteps],
    included,
    ignoredIds,
  };
}

function comparatorSatisfied(
  value: number,
  comparator: GoalComparator,
  target: number,
): boolean {
  switch (comparator) {
    case 'at_least':
      return value >= target;
    case 'at_most':
      return value <= target;
    case 'exactly':
      return value === target;
  }
}

function goalDistance(
  value: number,
  comparator: GoalComparator,
  target: number,
): number {
  switch (comparator) {
    case 'at_least':
      return Math.max(target - value, 0);
    case 'at_most':
      return Math.max(value - target, 0);
    case 'exactly':
      return Math.abs(target - value);
  }
}

function goalRatio(
  value: number,
  comparator: GoalComparator,
  target: number,
): number {
  let ratio: number;
  switch (comparator) {
    case 'at_least':
      ratio = target === 0 ? 1 : value / target;
      break;
    case 'at_most':
      ratio = value <= target ? 1 : target === 0 ? 0 : target / value;
      break;
    case 'exactly':
      ratio =
        target === 0
          ? value === 0
            ? 1
            : 0
          : 1 - Math.abs(target - value) / target;
      break;
  }
  return Math.max(0, Math.min(1, ratio));
}

function uniqueCapturedSessions(
  measurements: readonly HabitMeasurement[],
): number {
  const sessions = new Set<string>();
  for (const measurement of measurements) {
    if (measurement.amount > 0)
      sessions.add(measurement.sessionId ?? measurement.id);
  }
  return sessions.size;
}

export interface EvaluateProgressOptions {
  asOf: LocalDateTime;
  measurements?: readonly HabitMeasurement[];
  overrides?: readonly OccurrenceOverride[];
}

/** Evaluate one goal window and return both the result and its audit trail. */
export function evaluateProgressWindow(
  habit: HabitDefinition,
  window: ProgressWindow,
  options: EvaluateProgressOptions,
): ProgressResult {
  const relevantOverrides = stableLatestOverrides(
    (options.overrides ?? []).filter(
      (override) =>
        override.habitId === habit.id &&
        window.occurrences.some(
          (occurrence) => occurrence.id === override.occurrenceId,
        ),
    ),
  );
  const manualCompleted: ScheduledOccurrence[] = [];
  const excused: ScheduledOccurrence[] = [];
  const paused: ScheduledOccurrence[] = [];
  const active: ScheduledOccurrence[] = [];

  for (const occurrence of window.occurrences) {
    const override = relevantOverrides.get(occurrence.id);
    if (override?.status === 'complete') manualCompleted.push(occurrence);
    else if (override?.status === 'excused') excused.push(occurrence);
    else if (occurrence.state === 'paused') paused.push(occurrence);
    else active.push(occurrence);
  }

  const sourceMeasurements = options.measurements ?? [];
  const syntheticBooleanCompletions: HabitMeasurement[] =
    habit.metric.kind === 'boolean' && habit.polarity === 'build'
      ? manualCompleted
          .filter(
            (occurrence) =>
              !sourceMeasurements.some(
                (measurement) =>
                  measurement.habitId === habit.id &&
                  measurement.occurrenceId === occurrence.id &&
                  measurement.amount > 0,
              ),
          )
          .map((occurrence) => {
            const override = relevantOverrides.get(occurrence.id);
            return {
              id: `manual:${override?.id ?? occurrence.id}`,
              habitId: habit.id,
              occurrenceId: occurrence.id,
              sessionId: `manual:${occurrence.id}`,
              localDate: occurrence.nominalDate,
              amount: 1,
              operation: 'add' as const,
              recordedAtMs: override?.updatedAtMs ?? 0,
            };
          })
      : [];

  const eligibleIds = new Set([
    ...active.map((occurrence) => occurrence.id),
    ...manualCompleted.map((occurrence) => occurrence.id),
  ]);
  const aggregate = aggregateForWindow(
    habit,
    window,
    [...sourceMeasurements, ...syntheticBooleanCompletions],
    eligibleIds,
    options.asOf,
  );
  const expectedCompletions = [...active, ...manualCompleted].reduce(
    (total, occurrence) => total + occurrence.expectedCompletions,
    0,
  );
  const manuallyCaptured = manualCompleted.reduce((total, occurrence) => {
    const capturedForOccurrence = new Set(
      aggregate.included
        .filter(
          (measurement) =>
            measurement.occurrenceId === occurrence.id &&
            measurement.amount > 0,
        )
        .map((measurement) => measurement.sessionId ?? measurement.id),
    ).size;
    return (
      total +
      Math.max(occurrence.expectedCompletions - capturedForOccurrence, 0)
    );
  }, 0);
  const capturedSessions =
    uniqueCapturedSessions(aggregate.included) + manuallyCaptured;
  const quotaSatisfied =
    habit.polarity === 'avoid' || capturedSessions >= expectedCompletions;
  const goalSatisfied = comparatorSatisfied(
    aggregate.value,
    habit.goal.comparator,
    habit.goal.target,
  );
  const allRequirementsManuallyResolved =
    active.length === 0 && manualCompleted.length > 0;
  const deadlinePassed = compareDateTimes(options.asOf, window.closesAt) >= 0;

  let status: ProgressResult['status'];
  let reason: ProgressResult['reason'];
  if (allRequirementsManuallyResolved) {
    status = 'completed';
    reason = 'manual_completion';
  } else if (
    active.length === 0 &&
    manualCompleted.length === 0 &&
    excused.length > 0
  ) {
    status = 'excused';
    reason = 'all_occurrences_excused';
  } else if (active.length === 0 && manualCompleted.length === 0) {
    status = 'paused';
    reason = 'all_occurrences_paused';
  } else if (
    habit.polarity === 'avoid' &&
    (habit.goal.comparator === 'at_most' ||
      habit.goal.comparator === 'exactly') &&
    aggregate.value > habit.goal.target
  ) {
    status = 'failed';
    reason = 'avoid_limit_exceeded';
  } else if (goalSatisfied && quotaSatisfied) {
    const canCloseEarly =
      habit.polarity === 'build' && habit.goal.comparator === 'at_least';
    status = canCloseEarly || deadlinePassed ? 'completed' : 'pending';
    reason =
      status === 'completed' ? 'goal_reached' : 'goal_reached_but_period_open';
  } else if (deadlinePassed) {
    status = 'missed';
    reason = 'deadline_passed';
  } else if (goalSatisfied && !quotaSatisfied) {
    status = 'pending';
    reason = 'waiting_for_sessions';
  } else {
    status = 'pending';
    reason = 'goal_not_reached';
  }

  return {
    window,
    status,
    reason,
    value: aggregate.value,
    target: habit.goal.target,
    comparator: habit.goal.comparator,
    aggregation: habit.goal.aggregation,
    satisfied: goalSatisfied,
    remaining: goalDistance(
      aggregate.value,
      habit.goal.comparator,
      habit.goal.target,
    ),
    ratio: goalRatio(aggregate.value, habit.goal.comparator, habit.goal.target),
    expectedCompletions,
    capturedSessions,
    quotaSatisfied,
    manualCompletedOccurrenceIds: manualCompleted.map(
      (occurrence) => occurrence.id,
    ),
    excusedOccurrenceIds: excused.map((occurrence) => occurrence.id),
    pausedOccurrenceIds: paused.map((occurrence) => occurrence.id),
    ignoredMeasurementIds: aggregate.ignoredIds,
    aggregationSteps: aggregate.steps,
  };
}

export function windowsOverlappingRange<T extends ProgressWindow>(
  windows: readonly T[],
  range: {
    from: HabitDefinition['activeFrom'];
    to: HabitDefinition['activeFrom'];
  },
): T[] {
  return windows.filter((window) =>
    rangesOverlap(
      { from: window.startDate, to: window.endDate },
      { from: range.from, to: range.to },
    ),
  );
}
