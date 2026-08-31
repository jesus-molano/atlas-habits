import { describe, expect, it } from 'vitest';

import {
  calculateHabitTimeline,
  generateOccurrences,
  validateHabitDefinition,
  type HabitDefinition,
  type HabitMeasurement,
  type OccurrenceOverride,
} from './index';

function booleanHabit(
  overrides: Partial<HabitDefinition> = {},
): HabitDefinition {
  return {
    id: 'read',
    title: 'Read',
    scheduleVersionId: 'schedule-v1',
    metric: { kind: 'boolean' },
    polarity: 'build',
    goal: {
      period: 'occurrence',
      aggregation: 'sum',
      comparator: 'at_least',
      target: 1,
      unit: 'completion',
    },
    schedule: { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] },
    slots: [],
    activeFrom: '2026-08-01',
    ...overrides,
  };
}

function measurement(
  id: string,
  occurrenceId: string,
  amount = 1,
  extra: Partial<HabitMeasurement> = {},
): HabitMeasurement {
  return {
    id,
    habitId: 'read',
    occurrenceId,
    localDate: '2026-08-31',
    amount,
    operation: 'add',
    recordedAtMs: Number(id.replace(/\D/g, '')) || 1,
    ...extra,
  };
}

describe('occurrence generation', () => {
  it('creates every weekday slot and marks paused dates without deleting history', () => {
    const habit = booleanHabit({
      schedule: { kind: 'weekdays', days: [1, 3, 5] },
      slots: [
        { id: 'morning', time: '08:00', label: 'Morning' },
        { id: 'evening', time: '20:00', label: 'Evening' },
      ],
      pauses: [
        { id: 'holiday', startDate: '2026-09-02', endDate: '2026-09-02' },
      ],
    });

    const occurrences = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-09-04',
    });

    expect(occurrences).toHaveLength(6);
    expect(occurrences.map((item) => item.nominalDate)).toEqual([
      '2026-08-31',
      '2026-08-31',
      '2026-09-02',
      '2026-09-02',
      '2026-09-04',
      '2026-09-04',
    ]);
    expect(occurrences.filter((item) => item.state === 'paused')).toHaveLength(
      2,
    );
    expect(occurrences[0].scheduledAt).toEqual({
      date: '2026-08-31',
      time: '08:00',
    });
    expect(occurrences[0].id).toContain('schedule-v1');
  });

  it('uses a forward-only anchored interval', () => {
    const habit = booleanHabit({
      schedule: { kind: 'interval_days', every: 2, anchorDate: '2026-08-31' },
    });
    const occurrences = generateOccurrences(habit, {
      from: '2026-08-28',
      to: '2026-09-06',
    });
    expect(occurrences.map((item) => item.nominalDate)).toEqual([
      '2026-08-31',
      '2026-09-02',
      '2026-09-04',
      '2026-09-06',
    ]);
  });

  it('generates a once schedule only once', () => {
    const habit = booleanHabit({
      schedule: { kind: 'once', date: '2026-09-03' },
    });
    expect(
      generateOccurrences(habit, { from: '2026-09-01', to: '2026-09-05' }).map(
        (item) => item.nominalDate,
      ),
    ).toEqual(['2026-09-03']);
  });

  it('creates one flexible weekly quota window with a stable period boundary', () => {
    const habit = booleanHabit({
      schedule: { kind: 'period_quota', period: 'week', quota: 3 },
      slots: [
        { id: 'morning', time: '09:00' },
        { id: 'evening', time: '19:00' },
      ],
    });
    const occurrences = generateOccurrences(habit, {
      from: '2026-09-02',
      to: '2026-09-02',
    });
    expect(occurrences).toHaveLength(1);
    const [occurrence] = occurrences;
    expect(occurrence).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      expectedCompletions: 3,
      dueAt: { date: '2026-09-07', time: '00:00' },
    });
  });

  it('supports monthly quotas and reports partial pauses inside the period', () => {
    const habit = booleanHabit({
      schedule: { kind: 'period_quota', period: 'month', quota: 4 },
      pauses: [{ id: 'trip', startDate: '2026-09-10', endDate: '2026-09-12' }],
    });
    const [occurrence] = generateOccurrences(habit, {
      from: '2026-09-20',
      to: '2026-09-20',
    });
    expect(occurrence).toMatchObject({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      expectedCompletions: 4,
      state: 'active',
      pausedDates: ['2026-09-10', '2026-09-11', '2026-09-12'],
    });
  });
});

describe('generic goals and progress', () => {
  it.each([
    ['sum', 6],
    ['count', 2],
    ['average', 3],
    ['latest', 4],
    ['maximum', 4],
    ['minimum', 2],
  ] as const)('calculates the %s aggregation', (aggregation, expectedValue) => {
    const habit = booleanHabit({
      goal: {
        period: 'occurrence',
        aggregation,
        comparator: 'at_least',
        target: 0,
        unit: 'units',
      },
    });
    const occurrence = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
    })[0];
    const result = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-08-31', time: '12:00' },
      measurements: [
        measurement('m1', occurrence.id, 2, { sessionId: 'one' }),
        measurement('m2', occurrence.id, 4, { sessionId: 'two' }),
      ],
    }).progress[0];
    expect(result.value).toBe(expectedValue);
  });

  it('requires both a duration target and the requested number of weekly sessions', () => {
    const habit: HabitDefinition = {
      ...booleanHabit(),
      metric: { kind: 'duration', unit: 'seconds' },
      goal: {
        period: 'occurrence',
        aggregation: 'sum',
        comparator: 'at_least',
        target: 7_200,
        unit: 'seconds',
      },
      schedule: { kind: 'period_quota', period: 'week', quota: 3 },
    };
    const occurrence = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-09-06',
    })[0];
    const twoSessions = [
      measurement('m1', occurrence.id, 3_600, { sessionId: 'run-1' }),
      measurement('m2', occurrence.id, 3_600, { sessionId: 'run-2' }),
    ];
    const pending = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-09-06',
      asOf: { date: '2026-09-05', time: '12:00' },
      measurements: twoSessions,
    }).progress[0];

    expect(pending).toMatchObject({
      value: 7_200,
      satisfied: true,
      capturedSessions: 2,
      expectedCompletions: 3,
      quotaSatisfied: false,
      status: 'pending',
      reason: 'waiting_for_sessions',
    });

    const completed = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-09-06',
      asOf: { date: '2026-09-05', time: '12:00' },
      measurements: [
        ...twoSessions,
        measurement('m3', occurrence.id, 60, { sessionId: 'run-3' }),
      ],
    }).progress[0];
    expect(completed.status).toBe('completed');
    expect(completed.quotaSatisfied).toBe(true);
  });

  it('applies set corrections in timestamp order and exposes every step', () => {
    const habit = booleanHabit({
      metric: { kind: 'count', unit: 'glass' },
      goal: {
        period: 'occurrence',
        aggregation: 'sum',
        comparator: 'at_least',
        target: 6,
        unit: 'glass',
      },
    });
    const occurrence = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
    })[0];
    const result = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-08-31', time: '18:00' },
      measurements: [
        measurement('m1', occurrence.id, 10, { recordedAtMs: 1 }),
        measurement('m2', occurrence.id, 4, {
          operation: 'set',
          recordedAtMs: 2,
        }),
        measurement('m3', occurrence.id, 2, { recordedAtMs: 3 }),
      ],
    }).progress[0];
    expect(result.value).toBe(6);
    expect(result.status).toBe('completed');
    expect(result.aggregationSteps.map((step) => step.after)).toEqual([
      10, 4, 6,
    ]);
  });

  it('deduplicates sessions for count aggregation', () => {
    const habit = booleanHabit({
      goal: {
        period: 'occurrence',
        aggregation: 'count',
        comparator: 'at_least',
        target: 2,
        unit: 'sessions',
      },
    });
    const occurrence = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
    })[0];
    const result = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-08-31', time: '22:00' },
      measurements: [
        measurement('m1', occurrence.id, 1, { sessionId: 'a' }),
        measurement('m2', occurrence.id, 1, { sessionId: 'a' }),
        measurement('m3', occurrence.id, 1, { sessionId: 'b' }),
      ],
    }).progress[0];
    expect(result.value).toBe(2);
    expect(
      result.aggregationSteps.find((step) => step.measurementId === 'm2'),
    ).toMatchObject({
      included: false,
      reason: 'duplicate_session',
    });
  });

  it('groups multiple slots into one daily target', () => {
    const habit = booleanHabit({
      slots: [
        { id: 'am', time: '08:00' },
        { id: 'pm', time: '20:00' },
      ],
      goal: {
        period: 'day',
        aggregation: 'sum',
        comparator: 'at_least',
        target: 2,
        unit: 'steps',
      },
    });
    const occurrences = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
    });
    const timeline = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-08-31', time: '21:00' },
      measurements: [
        measurement('m1', occurrences[0].id),
        measurement('m2', occurrences[1].id),
      ],
    });
    expect(timeline.windows).toHaveLength(1);
    expect(timeline.progress[0]).toMatchObject({
      value: 2,
      expectedCompletions: 2,
      capturedSessions: 2,
      status: 'completed',
    });
  });

  it('loads a complete calendar week when evaluating a weekly goal from one queried day', () => {
    const habit = booleanHabit({
      schedule: { kind: 'weekdays', days: [1, 3, 5] },
      goal: {
        period: 'week',
        aggregation: 'count',
        comparator: 'at_least',
        target: 3,
        unit: 'sessions',
      },
    });
    const timeline = calculateHabitTimeline(habit, {
      from: '2026-09-02',
      to: '2026-09-02',
      asOf: { date: '2026-09-02', time: '12:00' },
    });
    expect(timeline.occurrences.map((item) => item.nominalDate)).toEqual([
      '2026-08-31',
      '2026-09-02',
      '2026-09-04',
    ]);
    expect(timeline.windows[0]).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
  });
});

describe('avoid habits, grace and streaks', () => {
  it('fails an avoid habit as soon as its at-most limit is exceeded', () => {
    const habit = booleanHabit({
      id: 'monster',
      title: 'No Monster',
      polarity: 'avoid',
      goal: {
        period: 'occurrence',
        aggregation: 'sum',
        comparator: 'at_most',
        target: 0,
        unit: 'cans',
      },
    });
    const occurrence = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
    })[0];
    const result = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-08-31', time: '10:00' },
      measurements: [
        {
          ...measurement('m1', occurrence.id),
          habitId: 'monster',
        },
      ],
    }).progress[0];
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'avoid_limit_exceeded',
    });
  });

  it('keeps an avoid success open through its configured grace period', () => {
    const habit = booleanHabit({
      id: 'monster',
      title: 'No Monster',
      polarity: 'avoid',
      grace: { minutes: 60 },
      goal: {
        period: 'occurrence',
        aggregation: 'sum',
        comparator: 'at_most',
        target: 0,
        unit: 'cans',
      },
    });
    const duringGrace = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-09-01', time: '00:30' },
    }).progress[0];
    const afterGrace = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-09-01', time: '01:00' },
    }).progress[0];
    expect(duringGrace.status).toBe('pending');
    expect(duringGrace.reason).toBe('goal_reached_but_period_open');
    expect(afterGrace.status).toBe('completed');
  });

  it('shows exactly how completion, excuse and failure affect the streak', () => {
    const habit = booleanHabit();
    const occurrences = generateOccurrences(habit, {
      from: '2026-08-31',
      to: '2026-09-04',
    });
    const statuses: OccurrenceOverride['status'][] = [
      'complete',
      'complete',
      'excused',
      'reset',
      'complete',
    ];
    const overrides: OccurrenceOverride[] = statuses.map((status, index) => ({
      id: `o${index}`,
      habitId: habit.id,
      occurrenceId: occurrences[index].id,
      status,
      updatedAtMs: index,
    }));
    const timeline = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-09-04',
      asOf: { date: '2026-09-05', time: '12:00' },
      overrides,
    });

    expect(timeline.progress.map((item) => item.status)).toEqual([
      'completed',
      'completed',
      'excused',
      'missed',
      'completed',
    ]);
    expect(timeline.streak).toMatchObject({ current: 1, best: 2 });
    expect(timeline.streak.steps.map((step) => step.decision)).toEqual([
      'increment',
      'increment',
      'neutral',
      'break',
      'increment',
    ]);
  });

  it('treats a full pause as neutral rather than missed', () => {
    const habit = booleanHabit({
      pauses: [{ id: 'rest', startDate: '2026-08-31', endDate: '2026-08-31' }],
    });
    const result = calculateHabitTimeline(habit, {
      from: '2026-08-31',
      to: '2026-08-31',
      asOf: { date: '2026-09-02', time: '12:00' },
    }).progress[0];
    expect(result).toMatchObject({
      status: 'paused',
      reason: 'all_occurrences_paused',
    });
  });
});

describe('validation', () => {
  it('reports invalid schedules and duplicate slots before generation', () => {
    const issues = validateHabitDefinition(
      booleanHabit({
        schedule: { kind: 'interval_days', every: 0, anchorDate: '2026-08-31' },
        slots: [{ id: 'same' }, { id: 'same', time: '99:00' }],
      }),
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_interval', 'duplicate', 'invalid_time']),
    );
  });
});
