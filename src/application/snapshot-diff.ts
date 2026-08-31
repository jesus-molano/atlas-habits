import type {
  AtlasItem,
  AtlasSnapshot,
  DashboardSectionId,
  HabitDayRecord,
  HabitItem,
  RoutineItem,
  TaskItem,
} from '../features/atlas/types';

export type AtlasSnapshotChange =
  | Readonly<{ kind: 'item.create'; item: AtlasItem }>
  | Readonly<{ kind: 'item.delete'; itemId: string }>
  | Readonly<{ kind: 'item.metadata'; before: AtlasItem; item: AtlasItem }>
  | Readonly<{ kind: 'item.definition'; before: AtlasItem; item: AtlasItem }>
  | Readonly<{
      kind: 'habit.progress';
      before: HabitDayRecord;
      habit: HabitItem;
      localDate: string;
      skipped: boolean;
      value: number;
    }>
  | Readonly<{
      kind: 'habit.timer';
      habitId: string;
      startedAt: number | null;
    }>
  | Readonly<{
      kind: 'habit.pause';
      habitId: string;
      paused: boolean;
      pauseUntil: string | null;
    }>
  | Readonly<{
      kind: 'task.status';
      before: TaskItem;
      completed: boolean;
      task: TaskItem;
    }>
  | Readonly<{
      kind: 'task.subtask';
      completed: boolean;
      subtaskId: string;
      task: TaskItem;
    }>
  | Readonly<{ kind: 'routine.start'; routine: RoutineItem }>
  | Readonly<{
      kind: 'routine.step';
      completed: boolean;
      routine: RoutineItem;
      stepId: string;
    }>
  | Readonly<{
      kind: 'routine.finish';
      completed: boolean;
      routine: RoutineItem;
    }>
  | Readonly<{ kind: 'routine.reset'; routine: RoutineItem }>
  | Readonly<{
      kind: 'dashboard.reorder';
      order: readonly DashboardSectionId[];
    }>;

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function metadataChanged(left: AtlasItem, right: AtlasItem): boolean {
  return (
    left.title !== right.title ||
    left.notes !== right.notes ||
    left.category !== right.category ||
    !sameStrings(left.tags, right.tags) ||
    left.sortOrder !== right.sortOrder
  );
}

function items(snapshot: AtlasSnapshot): AtlasItem[] {
  return [...snapshot.habits, ...snapshot.tasks, ...snapshot.routines];
}

function definitionValue(item: AtlasItem): unknown {
  const common = { schedule: item.schedule, reminders: item.reminders };
  if (item.kind === 'habit') {
    return {
      ...common,
      metric: item.metric,
      target: item.target,
      unit: item.unit,
      graceMinutes: item.graceMinutes ?? 0,
    };
  }
  if (item.kind === 'task') {
    return {
      ...common,
      priority: item.priority,
      dueAt: item.dueAt ?? null,
      deadlineAt: item.deadlineAt ?? null,
      recurring: item.recurring,
      subtasks: item.subtasks.map(({ id, title, required }) => ({
        id,
        title,
        required,
      })),
    };
  }
  return {
    ...common,
    steps: item.steps.map(({ id, title, required, durationSeconds }) => ({
      id,
      title,
      required,
      durationSeconds: durationSeconds ?? null,
    })),
  };
}

function definitionChanged(left: AtlasItem, right: AtlasItem): boolean {
  return (
    JSON.stringify(definitionValue(left)) !==
    JSON.stringify(definitionValue(right))
  );
}

function progressValue(
  habit: HabitItem,
  before: Pick<HabitDayRecord, 'value'>,
  after: Pick<HabitDayRecord, 'value' | 'completed'>,
): number {
  // A period-quota projection is cumulative for the whole week/month, while
  // the writer stores a value for one local occurrence. Persist only this UI
  // action's contribution or prior days would be counted again on hydration.
  if (habit.schedule.kind === 'period_quota') {
    return Math.max(0, after.value - before.value);
  }
  if (habit.metric === 'boolean') return after.completed ? habit.target : 0;
  return Math.max(0, after.value);
}

export function diffAtlasSnapshots(
  previous: AtlasSnapshot | null,
  next: AtlasSnapshot,
  currentLocalDate = '',
): AtlasSnapshotChange[] {
  if (!previous) {
    return [
      ...items(next).map((item): AtlasSnapshotChange => ({
        kind: 'item.create',
        item,
      })),
      { kind: 'dashboard.reorder', order: next.dashboardOrder },
    ];
  }

  const changes: AtlasSnapshotChange[] = [];
  const previousById = new Map(items(previous).map((item) => [item.id, item]));
  const nextById = new Map(items(next).map((item) => [item.id, item]));

  for (const previousItem of previousById.values()) {
    if (!nextById.has(previousItem.id)) {
      changes.push({ kind: 'item.delete', itemId: previousItem.id });
    }
  }

  for (const nextItem of nextById.values()) {
    const previousItem = previousById.get(nextItem.id);
    if (!previousItem) {
      changes.push({ kind: 'item.create', item: nextItem });
      continue;
    }
    if (previousItem.kind !== nextItem.kind) {
      changes.push(
        { kind: 'item.delete', itemId: previousItem.id },
        { kind: 'item.create', item: nextItem },
      );
      continue;
    }
    if (metadataChanged(previousItem, nextItem)) {
      changes.push({
        kind: 'item.metadata',
        before: previousItem,
        item: nextItem,
      });
    }
    if (definitionChanged(previousItem, nextItem)) {
      changes.push({
        kind: 'item.definition',
        before: previousItem,
        item: nextItem,
      });
    }

    if (nextItem.kind === 'habit' && previousItem.kind === 'habit') {
      if (
        previousItem.value !== nextItem.value ||
        previousItem.completed !== nextItem.completed ||
        previousItem.skipped !== nextItem.skipped
      ) {
        changes.push({
          kind: 'habit.progress',
          before: {
            value: previousItem.value,
            completed: previousItem.completed,
            skipped: previousItem.skipped,
            paused: previousItem.paused,
          },
          habit: nextItem,
          localDate: currentLocalDate,
          skipped: nextItem.skipped ?? false,
          value: progressValue(nextItem, previousItem, nextItem),
        });
      }
      if (previousItem.timerStartedAt !== nextItem.timerStartedAt) {
        changes.push({
          kind: 'habit.timer',
          habitId: nextItem.id,
          startedAt: nextItem.timerStartedAt ?? null,
        });
      }
      if (
        previousItem.paused !== nextItem.paused ||
        previousItem.pauseUntil !== nextItem.pauseUntil
      ) {
        changes.push({
          kind: 'habit.pause',
          habitId: nextItem.id,
          paused: nextItem.paused ?? false,
          pauseUntil: nextItem.pauseUntil ?? null,
        });
      }
      continue;
    }

    if (nextItem.kind === 'task' && previousItem.kind === 'task') {
      if (previousItem.completed !== nextItem.completed) {
        changes.push({
          kind: 'task.status',
          before: previousItem,
          completed: nextItem.completed,
          task: nextItem,
        });
      }
      const previousSubtasks = new Map(
        previousItem.subtasks.map((subtask) => [subtask.id, subtask]),
      );
      for (const subtask of nextItem.subtasks) {
        if (previousSubtasks.get(subtask.id)?.completed !== subtask.completed) {
          changes.push({
            kind: 'task.subtask',
            completed: subtask.completed,
            subtaskId: subtask.id,
            task: nextItem,
          });
        }
      }
      continue;
    }

    if (nextItem.kind === 'routine' && previousItem.kind === 'routine') {
      const reset =
        !nextItem.running &&
        !nextItem.completed &&
        nextItem.steps.every((step) => !step.completed) &&
        (previousItem.running ||
          previousItem.completed ||
          previousItem.steps.some((step) => step.completed));
      if (reset) {
        changes.push({ kind: 'routine.reset', routine: nextItem });
        continue;
      }
      if (!previousItem.running && nextItem.running) {
        changes.push({ kind: 'routine.start', routine: nextItem });
      }
      const previousSteps = new Map(
        previousItem.steps.map((step) => [step.id, step]),
      );
      for (const step of nextItem.steps) {
        if (previousSteps.get(step.id)?.completed !== step.completed) {
          changes.push({
            kind: 'routine.step',
            completed: step.completed,
            routine: nextItem,
            stepId: step.id,
          });
        }
      }
      if (
        (previousItem.running && !nextItem.running) ||
        (!previousItem.completed && nextItem.completed)
      ) {
        changes.push({
          kind: 'routine.finish',
          completed: nextItem.completed,
          routine: nextItem,
        });
      }
    }
  }

  const historyDates = new Set([
    ...Object.keys(previous.habitHistory),
    ...Object.keys(next.habitHistory),
  ]);
  const nextHabits = new Map(next.habits.map((habit) => [habit.id, habit]));
  for (const localDate of [...historyDates].sort()) {
    const previousRecords = previous.habitHistory[localDate] ?? {};
    const nextRecords = next.habitHistory[localDate] ?? {};
    const habitIds = new Set([
      ...Object.keys(previousRecords),
      ...Object.keys(nextRecords),
    ]);
    for (const habitId of habitIds) {
      const before = previousRecords[habitId] ?? { value: 0, completed: false };
      const after = nextRecords[habitId] ?? { value: 0, completed: false };
      const habit = nextHabits.get(habitId);
      if (
        !habit ||
        (before.value === after.value &&
          before.completed === after.completed &&
          before.skipped === after.skipped &&
          before.paused === after.paused &&
          before.scheduled === after.scheduled)
      ) {
        continue;
      }
      changes.push({
        kind: 'habit.progress',
        before,
        habit,
        localDate,
        skipped: after.skipped ?? false,
        value: progressValue(habit, before, after),
      });
    }
  }

  if (!sameStrings(previous.dashboardOrder, next.dashboardOrder)) {
    changes.push({ kind: 'dashboard.reorder', order: next.dashboardOrder });
  }
  return changes;
}
