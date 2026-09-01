import { describe, expect, it } from 'vitest';

import { createEmptySnapshot } from './empty-snapshot';
import { updateOptimisticHistoryForDate } from './optimistic-history';
import type { AtlasSnapshot } from './types';

const dailySchedule = {
  kind: 'daily' as const,
  startDate: '2026-08-01',
  slots: [],
};

function snapshot(): AtlasSnapshot {
  return {
    ...createEmptySnapshot(),
    habits: [
      {
        id: 'habit',
        kind: 'habit',
        title: 'Leer',
        tags: [],
        schedule: dailySchedule,
        reminders: [],
        scheduleLabel: 'Todos los días',
        sortOrder: 0,
        metric: 'boolean',
        target: 1,
        unit: 'vez',
        value: 1,
        completed: true,
        streak: 1,
      },
    ],
    tasks: [
      {
        id: 'task',
        kind: 'task',
        title: 'Preparar informe',
        tags: [],
        schedule: dailySchedule,
        reminders: [],
        scheduleLabel: 'Todos los días',
        sortOrder: 0,
        priority: 'medium',
        recurring: true,
        completed: false,
        subtasks: [],
      },
    ],
    routines: [
      {
        id: 'routine',
        kind: 'routine',
        title: 'Cierre',
        tags: [],
        schedule: dailySchedule,
        reminders: [],
        scheduleLabel: 'Todos los días',
        sortOrder: 0,
        completed: true,
        running: false,
        steps: [],
      },
    ],
  };
}

describe('updateOptimisticHistoryForDate', () => {
  it('preserves canonical history when editing an older date', () => {
    const current = {
      ...snapshot(),
      history: [
        {
          date: '2026-08-31',
          eligibleActions: 3,
          focusSeconds: 600,
          ratio: 2 / 3,
        },
      ],
    };

    const result = updateOptimisticHistoryForDate(
      current,
      '2026-08-31',
      '2026-09-01',
    );

    expect(result).toBe(current);
    expect(result.history[0]).toMatchObject({
      eligibleActions: 3,
      ratio: 2 / 3,
    });
  });

  it('updates all eligible actions for today', () => {
    const current = snapshot();

    const result = updateOptimisticHistoryForDate(
      current,
      '2026-09-01',
      '2026-09-01',
    );

    expect(result.history).toEqual([
      {
        date: '2026-09-01',
        eligibleActions: 3,
        focusSeconds: 0,
        ratio: 2 / 3,
      },
    ]);
  });
});
