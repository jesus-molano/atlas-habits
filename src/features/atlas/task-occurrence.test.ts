import { describe, expect, it } from 'vitest';

import {
  taskDefinitionUiValue,
  taskOccurrenceTimestamps,
} from './task-occurrence';

function localTimestamp(value: string): number {
  return new Date(value).getTime();
}

describe('taskOccurrenceTimestamps', () => {
  it('formats definition timestamps for the task editor', () => {
    expect(taskDefinitionUiValue(localTimestamp('2026-09-02T09:30:00'))).toBe(
      '2026-09-02 · 09:30',
    );
  });

  it('keeps definition timestamps for a one-off task', () => {
    const dueAt = localTimestamp('2026-09-02T09:30:00');
    expect(
      taskOccurrenceTimestamps({
        definitionDueAt: dueAt,
        definitionDeadlineAt: null,
        localDate: '2026-09-08',
        recurring: false,
      }),
    ).toEqual({ dueAt, deadlineAt: null });
  });

  it('moves recurring times to the selected occurrence and preserves deadline day offset', () => {
    const result = taskOccurrenceTimestamps({
      definitionDueAt: localTimestamp('2026-09-02T09:30:00'),
      definitionDeadlineAt: localTimestamp('2026-09-03T18:15:00'),
      localDate: '2026-09-09',
      recurring: true,
    });

    expect(result).toEqual({
      dueAt: localTimestamp('2026-09-09T09:30:00'),
      deadlineAt: localTimestamp('2026-09-10T18:15:00'),
    });
  });

  it('does not create an occurrence before the task definition starts', () => {
    expect(
      taskOccurrenceTimestamps({
        definitionDueAt: localTimestamp('2026-09-09T09:30:00'),
        definitionDeadlineAt: null,
        localDate: '2026-09-02',
        recurring: true,
      }),
    ).toEqual({ dueAt: null, deadlineAt: null });
  });

  it('prefers timestamps already persisted on the concrete instance', () => {
    const instanceDueAt = localTimestamp('2026-09-09T11:00:00');
    expect(
      taskOccurrenceTimestamps({
        definitionDueAt: localTimestamp('2026-09-02T09:30:00'),
        definitionDeadlineAt: null,
        instanceDueAt,
        instanceDeadlineAt: null,
        localDate: '2026-09-09',
        recurring: true,
      }),
    ).toEqual({ dueAt: instanceDueAt, deadlineAt: null });
  });
});
