import { describe, expect, it } from 'vitest';

import type { AtlasDayView } from '../features/atlas/types';
import { createTestSnapshot } from '../test-support/create-test-snapshot';

import { changesForAtlasDayMutation } from './day-mutation';

function dayView(): AtlasDayView {
  const snapshot = createTestSnapshot();
  return {
    localDate: '2026-08-31',
    habits: snapshot.habits,
    tasks: [
      {
        ...snapshot.tasks[0]!,
        subtasks: [
          {
            id: 'required',
            title: 'Required',
            required: true,
            completed: false,
          },
          {
            id: 'optional',
            title: 'Optional',
            required: false,
            completed: false,
          },
        ],
      },
    ],
    routines: [
      {
        ...snapshot.routines[0]!,
        steps: [
          {
            id: 'step',
            title: 'Step',
            required: true,
            completed: false,
          },
        ],
      },
    ],
    progress: { completed: 0, total: 3, ratio: 0 },
  };
}

describe('historical day mutations', () => {
  it('persists the parent status and every changed required subtask', () => {
    const changes = changesForAtlasDayMutation(dayView(), {
      kind: 'task.update',
      taskId: 'test-task',
      completed: true,
      subtasks: [{ id: 'required', completed: true }],
    });

    expect(changes.map((change) => change.kind)).toEqual([
      'task.status',
      'task.subtask',
    ]);
    expect(changes[1]).toMatchObject({
      kind: 'task.subtask',
      completed: true,
      subtaskId: 'required',
    });
  });

  it('writes a routine step against the selected run', () => {
    expect(
      changesForAtlasDayMutation(dayView(), {
        kind: 'routine.step',
        routineId: 'test-routine',
        stepId: 'step',
        completed: true,
      }),
    ).toMatchObject([
      {
        kind: 'routine.step',
        completed: true,
        stepId: 'step',
        routine: { running: true },
      },
    ]);
  });

  it('rejects ids that do not belong to the selected date', () => {
    expect(() =>
      changesForAtlasDayMutation(dayView(), {
        kind: 'routine.reset',
        routineId: 'missing',
      }),
    ).toThrow('No se encontró la rutina');
  });
});
