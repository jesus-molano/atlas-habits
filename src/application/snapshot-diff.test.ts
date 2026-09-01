import { describe, expect, it } from 'vitest';

import { createTestSnapshot } from '../test-support/create-test-snapshot';

import { diffAtlasSnapshots } from './snapshot-diff';

describe('snapshot definition diff', () => {
  it('turns a removed UI item into a durable delete command', () => {
    const before = createTestSnapshot();
    const removed = before.tasks[0]!;
    const next = {
      ...before,
      tasks: before.tasks.filter((item) => item.id !== removed.id),
    };

    expect(diffAtlasSnapshots(before, next, '2026-08-31')).toContainEqual({
      kind: 'item.delete',
      itemId: removed.id,
    });
  });

  it('persists schedule, reminder and habit goal edits', () => {
    const before = createTestSnapshot();
    const habit = before.habits[0]!;
    const next = {
      ...before,
      habits: before.habits.map((item) =>
        item.id === habit.id
          ? {
              ...item,
              target: 10,
              graceMinutes: 180,
              schedule: {
                kind: 'period_quota' as const,
                period: 'week' as const,
                quota: 3,
                weekStartsOn: 1 as const,
                startDate: item.schedule.startDate,
                slots: item.schedule.slots,
              },
              reminders: [
                ...item.reminders,
                {
                  id: 'second-reminder',
                  time: '18:00',
                  enabled: true,
                  snoozeMinutes: 15,
                },
              ],
            }
          : item,
      ),
    };

    expect(diffAtlasSnapshots(before, next, '2026-08-31')).toContainEqual({
      kind: 'item.definition',
      before: habit,
      item: next.habits[0],
    });
  });

  it('does not treat runtime completion as a definition edit', () => {
    const before = createTestSnapshot();
    const next = {
      ...before,
      habits: before.habits.map((item, index) =>
        index === 0 ? { ...item, value: item.target, completed: true } : item,
      ),
    };
    const changes = diffAtlasSnapshots(before, next, '2026-08-31');
    expect(changes.some((change) => change.kind === 'item.definition')).toBe(
      false,
    );
    expect(changes.some((change) => change.kind === 'habit.progress')).toBe(
      true,
    );
  });

  it('persists only the new contribution of an aggregated period quota', () => {
    const fallback = createTestSnapshot();
    const quotaSchedule = {
      kind: 'period_quota' as const,
      period: 'week' as const,
      quota: 3,
      weekStartsOn: 1 as const,
      startDate: '2026-08-31',
      slots: [],
    };
    const before = {
      ...fallback,
      habits: fallback.habits.map((habit, index) =>
        index === 0
          ? {
              ...habit,
              schedule: quotaSchedule,
              value: 2,
              completed: false,
            }
          : habit,
      ),
    };
    const next = {
      ...before,
      habits: before.habits.map((habit, index) =>
        index === 0 ? { ...habit, value: 3, completed: true } : habit,
      ),
    };

    expect(diffAtlasSnapshots(before, next, '2026-09-02')).toContainEqual(
      expect.objectContaining({
        kind: 'habit.progress',
        localDate: '2026-09-02',
        value: 1,
      }),
    );
  });

  it('does not discard a partial boolean quota contribution', () => {
    const fallback = createTestSnapshot();
    const before = {
      ...fallback,
      habits: fallback.habits.map((habit, index) =>
        index === 0
          ? {
              ...habit,
              schedule: {
                kind: 'period_quota' as const,
                period: 'week' as const,
                quota: 3,
                weekStartsOn: 1 as const,
                startDate: '2026-08-31',
                slots: [],
              },
              value: 0,
              completed: false,
            }
          : habit,
      ),
    };
    const next = {
      ...before,
      habits: before.habits.map((habit, index) =>
        index === 0 ? { ...habit, value: 1, completed: false } : habit,
      ),
    };

    expect(diffAtlasSnapshots(before, next, '2026-08-31')).toContainEqual(
      expect.objectContaining({ kind: 'habit.progress', value: 1 }),
    );
  });
});
