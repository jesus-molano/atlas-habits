import { describe, expect, it } from 'vitest';

import type { DashboardSnapshot } from '../data';

import { timestampFromUiValue } from './date-time';
import { mapDashboardToAtlasSnapshot } from './projection';

function timestamp(value: string): number {
  return new Date(value).getTime();
}

function quotaDay(
  localDate: string,
  options: {
    measurementType?: 'boolean' | 'quantity';
    goalTarget?: number;
    measurements?: DashboardSnapshot['measurements'];
    overrides?: DashboardSnapshot['overrides'];
  } = {},
): DashboardSnapshot {
  const measurementType = options.measurementType ?? 'boolean';
  return {
    localDate,
    items: [
      {
        id: 'habit-quota',
        workspaceId: 'local',
        type: 'habit',
        title: 'Entrenar',
        notes: null,
        color: null,
        icon: null,
        categoryId: null,
        categoryName: null,
        categoryColor: null,
        tagIds: [],
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
        archivedAt: null,
        deletedAt: null,
        isPaused: false,
        subtypeJson: JSON.stringify({
          measurementType,
          unit: measurementType === 'quantity' ? 'km' : 'vez',
          defaultValue: options.goalTarget ?? 1,
        }),
      },
    ],
    scheduleVersions: [
      {
        id: 'quota-version',
        scheduleId: 'quota-schedule',
        itemId: 'habit-quota',
        timezone: 'Atlantic/Canary',
        versionNumber: 1,
        effectiveFrom: '2026-08-31',
        effectiveUntil: null,
        ruleType: 'period_quota',
        rule: { period: 'week', quota: 3, weekStartsOn: 1 },
        graceMinutes: 0,
      },
    ],
    scheduleSlots: [],
    scheduleGoals: [
      {
        id: 'quota-goal',
        scheduleVersionId: 'quota-version',
        slotId: null,
        measurementType,
        aggregation: measurementType === 'boolean' ? 'count' : 'sum',
        comparison: 'at_least',
        targetValue: options.goalTarget ?? 1,
        unit: measurementType === 'quantity' ? 'km' : 'vez',
      },
    ],
    measurements: options.measurements ?? [],
    overrides: options.overrides ?? [],
    taskInstances: [],
    routineRuns: [],
  };
}

function quotaMeasurement(
  id: string,
  localDate: string,
  value: number,
): DashboardSnapshot['measurements'][number] {
  return {
    id,
    itemId: 'habit-quota',
    occurrenceKey: `quota:${id}:${localDate}`,
    sessionId: `session:${id}`,
    scheduleVersionId: 'quota-version',
    slotId: null,
    value,
    operation: 'add',
    unit: 'vez',
    occurredAt: timestamp(`${localDate}T09:00:00`),
    localDate,
    note: null,
  };
}

function dailyHabitDay(
  localDate: string,
  options: {
    completed?: boolean;
    paused?: boolean;
    weekdays?: number[];
  } = {},
): DashboardSnapshot {
  const versionId = `daily-version:${localDate}`;
  return {
    localDate,
    items: [
      {
        id: 'habit-daily',
        workspaceId: 'local',
        type: 'habit',
        title: 'Leer',
        notes: null,
        color: null,
        icon: null,
        categoryId: null,
        categoryName: null,
        categoryColor: null,
        tagIds: [],
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
        archivedAt: null,
        deletedAt: null,
        isPaused: options.paused ?? false,
        subtypeJson: JSON.stringify({
          measurementType: 'boolean',
          unit: 'vez',
          defaultValue: 1,
        }),
      },
    ],
    scheduleVersions: [
      {
        id: versionId,
        scheduleId: 'daily-schedule',
        itemId: 'habit-daily',
        timezone: 'Atlantic/Canary',
        versionNumber: 1,
        effectiveFrom: '2026-08-31',
        effectiveUntil: null,
        ruleType: options.weekdays ? 'weekdays' : 'daily',
        rule: options.weekdays ? { days: options.weekdays } : {},
        graceMinutes: 0,
      },
    ],
    scheduleSlots: [],
    scheduleGoals: [
      {
        id: `daily-goal:${localDate}`,
        scheduleVersionId: versionId,
        slotId: null,
        measurementType: 'boolean',
        aggregation: 'sum',
        comparison: 'at_least',
        targetValue: 1,
        unit: 'vez',
      },
    ],
    measurements: options.completed
      ? [
          {
            id: `daily-measurement:${localDate}`,
            itemId: 'habit-daily',
            occurrenceKey: `daily:${localDate}`,
            sessionId: null,
            scheduleVersionId: versionId,
            slotId: null,
            value: 1,
            operation: 'set',
            unit: 'vez',
            occurredAt: timestamp(`${localDate}T09:00:00`),
            localDate,
            note: null,
          },
        ]
      : [],
    overrides: [],
    taskInstances: [],
    routineRuns: [],
  };
}

describe('task projection', () => {
  it('parses the task editor date separator', () => {
    expect(timestampFromUiValue('2026-09-02 · 09:30', '2026-09-02')).toBe(
      timestamp('2026-09-02T09:30:00'),
    );
  });

  it('keeps definition dates separate from the current recurring occurrence', () => {
    const day: DashboardSnapshot = {
      localDate: '2026-09-09',
      items: [
        {
          id: 'task-1',
          workspaceId: 'local',
          type: 'task',
          title: 'Preparar informe',
          notes: null,
          color: null,
          icon: null,
          categoryId: null,
          categoryName: null,
          categoryColor: null,
          tagIds: [],
          sortOrder: 0,
          createdAt: 0,
          updatedAt: 0,
          archivedAt: null,
          deletedAt: null,
          isPaused: false,
          subtypeJson: JSON.stringify({
            priority: 2,
            dueAt: timestamp('2026-09-02T09:30:00'),
            deadlineAt: timestamp('2026-09-03T18:15:00'),
          }),
        },
      ],
      scheduleVersions: [
        {
          id: 'version-1',
          scheduleId: 'schedule-1',
          itemId: 'task-1',
          timezone: 'UTC',
          versionNumber: 1,
          effectiveFrom: '2026-09-02',
          effectiveUntil: null,
          ruleType: 'weekdays',
          rule: { days: [3] },
          graceMinutes: 0,
        },
      ],
      scheduleSlots: [],
      scheduleGoals: [],
      measurements: [],
      overrides: [],
      taskInstances: [],
      routineRuns: [],
    };

    const task = mapDashboardToAtlasSnapshot({
      day,
      now: new Date('2026-09-09T12:00:00'),
    }).tasks[0];

    expect(task).toMatchObject({
      dueAt: '2026-09-02 · 09:30',
      deadlineAt: '2026-09-03 · 18:15',
      occurrenceDueAt: '09:30',
      occurrenceDeadlineAt: '2026-09-10 18:15',
      recurring: true,
    });
  });
});

describe('period quota projection', () => {
  it('aggregates prior days and advances a weekly boolean quota 1 → 2 → 3', () => {
    const monday = quotaDay('2026-08-31', {
      measurements: [quotaMeasurement('monday', '2026-08-31', 1)],
    });
    const tuesday = quotaDay('2026-09-01', {
      measurements: [quotaMeasurement('tuesday', '2026-09-01', 1)],
    });
    const wednesday = quotaDay('2026-09-02');

    const partial = mapDashboardToAtlasSnapshot({
      day: wednesday,
      historyDays: [monday, tuesday, wednesday],
      now: new Date('2026-09-02T12:00:00'),
    }).habits[0];
    expect(partial).toMatchObject({ value: 2, target: 3, completed: false });

    const completedWednesday = quotaDay('2026-09-02', {
      measurements: [quotaMeasurement('wednesday', '2026-09-02', 1)],
    });
    const completed = mapDashboardToAtlasSnapshot({
      day: completedWednesday,
      historyDays: [monday, tuesday, completedWednesday],
      now: new Date('2026-09-02T12:00:00'),
    }).habits[0];
    expect(completed).toMatchObject({ value: 3, target: 3, completed: true });
  });

  it('treats a legacy daily override as one session, not the whole quota', () => {
    const monday = quotaDay('2026-08-31', {
      overrides: [
        {
          id: 'legacy-override',
          itemId: 'habit-quota',
          occurrenceKey: 'atlas:v1:habit:habit-quota:2026-08-31',
          localDate: '2026-08-31',
          slotId: null,
          state: 'complete',
          value: 1,
          note: null,
          updatedAt: timestamp('2026-08-31T09:00:00'),
        },
      ],
    });
    const wednesday = quotaDay('2026-09-02');
    const habit = mapDashboardToAtlasSnapshot({
      day: wednesday,
      historyDays: [monday, wednesday],
      now: new Date('2026-09-02T12:00:00'),
    }).habits[0];

    expect(habit).toMatchObject({ value: 1, target: 3, completed: false });
  });

  it('keeps the numeric goal while requiring all quota sessions', () => {
    const monday = quotaDay('2026-08-31', {
      measurementType: 'quantity',
      goalTarget: 5,
      measurements: [quotaMeasurement('monday-km', '2026-08-31', 5)],
    });
    const tuesday = quotaDay('2026-09-01', {
      measurementType: 'quantity',
      goalTarget: 5,
      measurements: [quotaMeasurement('tuesday-km', '2026-09-01', 5)],
    });
    const wednesday = quotaDay('2026-09-02', {
      measurementType: 'quantity',
      goalTarget: 5,
      measurements: [quotaMeasurement('wednesday-km', '2026-09-02', 5)],
    });
    const partial = mapDashboardToAtlasSnapshot({
      day: tuesday,
      historyDays: [monday, tuesday],
      now: new Date('2026-09-01T12:00:00'),
    }).habits[0];
    expect(partial).toMatchObject({ value: 10, target: 5, completed: false });

    const completed = mapDashboardToAtlasSnapshot({
      day: wednesday,
      historyDays: [monday, tuesday, wednesday],
      now: new Date('2026-09-02T12:00:00'),
    }).habits[0];
    expect(completed).toMatchObject({ value: 15, target: 5, completed: true });
  });
});

describe('history eligibility projection', () => {
  it('distinguishes failed, neutral and completed history days', () => {
    const failed = dailyHabitDay('2026-08-31');
    const paused = dailyHabitDay('2026-09-01', { paused: true });
    const completed = dailyHabitDay('2026-09-02', { completed: true });

    const snapshot = mapDashboardToAtlasSnapshot({
      day: completed,
      historyDays: [failed, paused, completed],
      now: new Date('2026-09-02T12:00:00'),
    });

    expect(snapshot.history).toEqual([
      {
        date: '2026-08-31',
        eligibleActions: 1,
        focusSeconds: 0,
        ratio: 0,
      },
      {
        date: '2026-09-01',
        eligibleActions: 0,
        focusSeconds: 0,
        ratio: 0,
      },
      {
        date: '2026-09-02',
        eligibleActions: 1,
        focusSeconds: 0,
        ratio: 1,
      },
    ]);
  });

  it('marks a day outside the habit schedule as neutral', () => {
    const tuesday = dailyHabitDay('2026-09-01', { weekdays: [1] });

    const snapshot = mapDashboardToAtlasSnapshot({
      day: tuesday,
      now: new Date('2026-09-01T12:00:00'),
    });

    expect(snapshot.history[0]).toMatchObject({
      eligibleActions: 0,
      ratio: 0,
    });
  });
});
