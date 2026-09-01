import { describe, expect, it } from 'vitest';

import {
  buildAtlasReminderPlan,
  type ReminderScheduleDefinition,
} from './reminder-plan';

function definition(
  overrides: Partial<ReminderScheduleDefinition> = {},
): ReminderScheduleDefinition {
  return {
    reminderId: 'reminder-1',
    itemId: 'habit-1',
    itemType: 'habit',
    title: 'Moverse',
    scheduleSlotId: null,
    localTime: '09:00',
    offsetMinutes: 0,
    snoozeMinutes: 10,
    scheduleVersionId: 'schedule-version-1',
    versionNumber: 1,
    effectiveFrom: '2026-08-01',
    effectiveUntil: null,
    ruleType: 'daily',
    rule: {},
    taskDueAt: null,
    measurementType: 'boolean',
    goalTarget: 1,
    goalAggregation: 'count',
    ...overrides,
  };
}

function planDates(plan: ReturnType<typeof buildAtlasReminderPlan>): string[] {
  return plan.map((entry) => entry.occurrenceId.slice(-10));
}

describe('buildAtlasReminderPlan', () => {
  it('does not schedule alarms inside a pause range', () => {
    const plan = buildAtlasReminderPlan({
      definitions: [definition()],
      pauses: [
        { itemId: 'habit-1', startDate: '2026-09-01', endDate: '2026-09-02' },
      ],
      now: new Date(2026, 7, 31, 7, 0),
      horizonDays: 3,
    });

    expect(planDates(plan)).toEqual(['2026-08-31', '2026-09-03']);
  });

  it('cancels the rest of a completed quota period and resumes next period', () => {
    const quotaDefinition = definition({
      ruleType: 'period_quota',
      rule: { period: 'week', quota: 2, weekStartsOn: 1 },
    });
    const plan = buildAtlasReminderPlan({
      definitions: [quotaDefinition],
      overrides: [
        {
          itemId: 'habit-1',
          occurrenceKey: 'atlas:v1:habit:habit-1:quota:reminder-1:2026-08-31',
          localDate: '2026-08-31',
          state: 'complete',
        },
        {
          itemId: 'habit-1',
          occurrenceKey: 'atlas:v1:habit:habit-1:quota:reminder-1:2026-09-01',
          localDate: '2026-09-01',
          state: 'complete',
        },
      ],
      now: new Date(2026, 8, 2, 7, 0),
      horizonDays: 7,
    });

    expect(planDates(plan)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
  });

  it('does not schedule a one-off task before its original due date', () => {
    const plan = buildAtlasReminderPlan({
      definitions: [
        definition({
          reminderId: 'task-reminder',
          itemId: 'task-1',
          itemType: 'task',
          localTime: null,
          ruleType: 'once',
          rule: { date: '2026-08-31' },
          taskDueAt: new Date(2026, 8, 3, 18, 15).getTime(),
        }),
      ],
      now: new Date(2026, 7, 31, 7, 0),
      horizonDays: 7,
    });

    expect(plan).toHaveLength(1);
    expect(planDates(plan)).toEqual(['2026-09-03']);
    expect(plan[0]?.fireAt.getHours()).toBe(18);
    expect(plan[0]?.fireAt.getMinutes()).toBe(15);
  });

  it('trata las rutinas como un aviso para abrir Atlas, no para completarlas', () => {
    const [entry] = buildAtlasReminderPlan({
      definitions: [
        definition({
          itemId: 'routine-1',
          itemType: 'routine',
          exactAlarm: true,
        }),
      ],
      now: new Date(2026, 7, 31, 7, 0),
      horizonDays: 0,
    });

    expect(entry).toMatchObject({
      targetKind: 'routine-step',
      targetId: 'routine-1',
      body: 'Toca para abrir Atlas o posponer',
    });
    expect(entry).not.toHaveProperty('exactAlarm');
  });
});
