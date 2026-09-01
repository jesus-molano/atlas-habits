import type { TaskItem } from './types';

/** Completing a parent task also satisfies its required checklist entries. */
export function toggleTaskCompletion(task: TaskItem): TaskItem {
  if (task.completed) return { ...task, completed: false };
  return {
    ...task,
    completed: true,
    subtasks: task.subtasks.map((subtask) =>
      subtask.required ? { ...subtask, completed: true } : subtask,
    ),
  };
}

export function toggleTaskSubtaskCompletion(
  task: TaskItem,
  subtaskId: string,
): TaskItem {
  if (!task.subtasks.some((subtask) => subtask.id === subtaskId)) return task;
  const subtasks = task.subtasks.map((subtask) =>
    subtask.id === subtaskId
      ? { ...subtask, completed: !subtask.completed }
      : subtask,
  );
  const required = subtasks.filter((subtask) => subtask.required);
  return {
    ...task,
    subtasks,
    completed:
      required.length === 0
        ? task.completed
        : required.every((subtask) => subtask.completed),
  };
}
