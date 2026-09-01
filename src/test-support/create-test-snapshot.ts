import { createEmptySnapshot } from '../features/atlas/empty-snapshot';
import type { AtlasSnapshot } from '../features/atlas/types';

/** A deliberately test-only snapshot with one item of every supported kind. */
export function createTestSnapshot(localDate = '2026-08-31'): AtlasSnapshot {
  return {
    ...createEmptySnapshot(),
    habits: [
      {
        id: 'test-habit',
        kind: 'habit',
        title: 'Test habit',
        tags: ['test'],
        schedule: { kind: 'daily', startDate: localDate, slots: [] },
        reminders: [
          {
            id: 'test-reminder',
            time: '09:00',
            enabled: true,
            snoozeMinutes: 10,
          },
        ],
        scheduleLabel: 'Daily',
        reminderTime: '09:00',
        sortOrder: 0,
        metric: 'boolean',
        target: 1,
        unit: 'time',
        value: 0,
        completed: false,
        streak: 0,
      },
    ],
    tasks: [
      {
        id: 'test-task',
        kind: 'task',
        title: 'Test task',
        tags: [],
        schedule: {
          kind: 'once',
          date: localDate,
          startDate: localDate,
          slots: [],
        },
        reminders: [],
        scheduleLabel: 'Once',
        sortOrder: 0,
        priority: 'medium',
        recurring: false,
        completed: false,
        subtasks: [],
      },
    ],
    routines: [
      {
        id: 'test-routine',
        kind: 'routine',
        title: 'Test routine',
        tags: [],
        schedule: { kind: 'daily', startDate: localDate, slots: [] },
        reminders: [],
        scheduleLabel: 'Daily',
        sortOrder: 0,
        completed: false,
        running: false,
        steps: [],
      },
    ],
  };
}
