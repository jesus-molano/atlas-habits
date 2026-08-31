import { describe, expect, it, vi } from 'vitest';

import {
  isWidgetScheduleDueOnDate,
  widgetHabitOccurrenceId,
  type WidgetScheduleDefinition,
} from './widget-data-source';

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(),
}));

function definition(
  overrides: Partial<WidgetScheduleDefinition> = {},
): WidgetScheduleDefinition {
  return {
    itemId: 'habit-water',
    itemType: 'habit',
    title: 'Agua',
    priority: 0,
    dueAt: null,
    isPaused: false,
    scheduleVersionId: 'schedule-v1',
    versionNumber: 1,
    effectiveFrom: '2026-08-01',
    effectiveUntil: null,
    ruleType: 'daily',
    rule: {},
    measurementType: 'boolean',
    goalTarget: 1,
    ...overrides,
  };
}

describe('widget schedule projection', () => {
  it('supports weekday and interval schedules with civil dates', () => {
    const weekdays = definition({
      ruleType: 'weekdays',
      rule: { days: [1, 3, 5] },
    });
    expect(isWidgetScheduleDueOnDate(weekdays, '2026-08-31')).toBe(true);
    expect(isWidgetScheduleDueOnDate(weekdays, '2026-09-01')).toBe(false);

    const interval = definition({
      ruleType: 'interval',
      rule: { anchorDate: '2026-08-30', every: 3 },
    });
    expect(isWidgetScheduleDueOnDate(interval, '2026-09-02')).toBe(true);
    expect(isWidgetScheduleDueOnDate(interval, '2026-09-03')).toBe(false);
  });

  it('does not expose a one-off task before its configured due date', () => {
    const dueAt = new Date(2026, 8, 5, 18, 30).getTime();
    const task = definition({
      itemId: 'task-buy',
      itemType: 'task',
      dueAt,
      ruleType: 'once',
      rule: { date: '2026-08-31' },
    });
    expect(isWidgetScheduleDueOnDate(task, '2026-08-31')).toBe(false);
    expect(isWidgetScheduleDueOnDate(task, '2026-09-05')).toBe(true);
  });

  it('uses stable occurrence IDs and advances quota intent revisions', () => {
    expect(widgetHabitOccurrenceId('agua 2L', '2026-08-31')).toBe(
      'atlas:v1:habit:agua%202L:2026-08-31',
    );
    expect(widgetHabitOccurrenceId('agua 2L', '2026-08-31', 1)).toBe(
      'atlas:v1:habit:agua%202L:quota:widget:1:2026-08-31',
    );
    expect(widgetHabitOccurrenceId('agua 2L', '2026-08-31', 2)).not.toBe(
      widgetHabitOccurrenceId('agua 2L', '2026-08-31', 1),
    );
  });
});
