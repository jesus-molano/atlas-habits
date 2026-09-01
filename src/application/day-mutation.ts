import type {
  AtlasDayMutation,
  AtlasDayView,
  RoutineItem,
  TaskItem,
} from '../features/atlas/types';

import type { AtlasSnapshotChange } from './snapshot-diff';

function missing(kind: 'tarea' | 'rutina', id: string): never {
  throw new Error(`No se encontró la ${kind} ${id} en esta fecha.`);
}

function taskChanges(
  view: AtlasDayView,
  mutation: Extract<AtlasDayMutation, { kind: 'task.update' }>,
): AtlasSnapshotChange[] {
  const before = view.tasks.find((task) => task.id === mutation.taskId);
  if (!before) return missing('tarea', mutation.taskId);

  const requestedSubtasks = new Map(
    (mutation.subtasks ?? []).map((subtask) => [subtask.id, subtask.completed]),
  );
  for (const subtaskId of requestedSubtasks.keys()) {
    if (!before.subtasks.some((subtask) => subtask.id === subtaskId)) {
      throw new Error(`No se encontró la subtarea ${subtaskId}.`);
    }
  }
  const task: TaskItem = {
    ...before,
    completed: mutation.completed,
    subtasks: before.subtasks.map((subtask) =>
      requestedSubtasks.has(subtask.id)
        ? { ...subtask, completed: requestedSubtasks.get(subtask.id) ?? false }
        : subtask,
    ),
  };
  const changes: AtlasSnapshotChange[] = [];
  if (before.completed !== task.completed) {
    changes.push({
      kind: 'task.status',
      before,
      completed: task.completed,
      task,
    });
  }
  for (const subtask of task.subtasks) {
    const previous = before.subtasks.find((entry) => entry.id === subtask.id);
    if (previous?.completed !== subtask.completed) {
      changes.push({
        kind: 'task.subtask',
        completed: subtask.completed,
        subtaskId: subtask.id,
        task,
      });
    }
  }
  return changes;
}

function routineFor(view: AtlasDayView, routineId: string): RoutineItem {
  return (
    view.routines.find((routine) => routine.id === routineId) ??
    missing('rutina', routineId)
  );
}

export function changesForAtlasDayMutation(
  view: AtlasDayView,
  mutation: AtlasDayMutation,
): AtlasSnapshotChange[] {
  switch (mutation.kind) {
    case 'task.update':
      return taskChanges(view, mutation);
    case 'routine.start': {
      const routine = routineFor(view, mutation.routineId);
      return routine.running || routine.completed
        ? []
        : [{ kind: 'routine.start', routine: { ...routine, running: true } }];
    }
    case 'routine.step': {
      const routine = routineFor(view, mutation.routineId);
      const step = routine.steps.find((entry) => entry.id === mutation.stepId);
      if (!step) throw new Error(`No se encontró el paso ${mutation.stepId}.`);
      if (step.completed === mutation.completed) return [];
      const changed: RoutineItem = {
        ...routine,
        running: true,
        steps: routine.steps.map((entry) =>
          entry.id === step.id
            ? { ...entry, completed: mutation.completed }
            : entry,
        ),
      };
      return [
        {
          kind: 'routine.step',
          completed: mutation.completed,
          routine: changed,
          stepId: step.id,
        },
      ];
    }
    case 'routine.finish': {
      const routine = routineFor(view, mutation.routineId);
      return [
        {
          kind: 'routine.finish',
          completed: mutation.completed,
          routine: {
            ...routine,
            completed: mutation.completed,
            running: false,
          },
        },
      ];
    }
    case 'routine.reset': {
      const routine = routineFor(view, mutation.routineId);
      if (
        !routine.running &&
        !routine.completed &&
        routine.steps.every((step) => !step.completed)
      ) {
        return [];
      }
      return [
        {
          kind: 'routine.reset',
          routine: {
            ...routine,
            completed: false,
            running: false,
            steps: routine.steps.map((step) => ({
              ...step,
              completed: false,
            })),
          },
        },
      ];
    }
  }
}
