import { describe, expect, it } from 'vitest';

import { createTestSnapshot } from '../../test-support/create-test-snapshot';

import {
  toggleTaskCompletion,
  toggleTaskSubtaskCompletion,
} from './task-completion';
import type { TaskItem } from './types';

function task(): TaskItem {
  return {
    ...createTestSnapshot().tasks[0]!,
    subtasks: [
      {
        id: 'required',
        title: 'Obligatoria',
        required: true,
        completed: false,
      },
      { id: 'optional', title: 'Opcional', required: false, completed: false },
    ],
  };
}

describe('task checklist completion', () => {
  it('completes required entries with the parent without changing optional ones', () => {
    const completed = toggleTaskCompletion(task());

    expect(completed.completed).toBe(true);
    expect(completed.subtasks).toEqual([
      { id: 'required', title: 'Obligatoria', required: true, completed: true },
      { id: 'optional', title: 'Opcional', required: false, completed: false },
    ]);
  });

  it('reopens the parent while preserving checklist history', () => {
    const completed = toggleTaskCompletion(task());
    const reopened = toggleTaskCompletion(completed);

    expect(reopened.completed).toBe(false);
    expect(reopened.subtasks[0]?.completed).toBe(true);
  });

  it('derives parent completion from required entries only', () => {
    const optionalFirst = toggleTaskSubtaskCompletion(task(), 'optional');
    expect(optionalFirst.completed).toBe(false);

    const requiredNext = toggleTaskSubtaskCompletion(optionalFirst, 'required');
    expect(requiredNext.completed).toBe(true);
  });
});
