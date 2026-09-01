import { expectedCompletions, isScheduledOnDate } from './schedule';
import type { AtlasSnapshot, HabitItem } from './types';

function habitDone(habit: HabitItem): boolean {
  const target =
    habit.metric === 'boolean'
      ? expectedCompletions(habit.schedule)
      : habit.target;
  return habit.value >= target;
}

/**
 * Keeps today's summary responsive without inventing historical task or routine
 * state that is only available in the canonical daily projection.
 */
export function updateOptimisticHistoryForDate(
  snapshot: AtlasSnapshot,
  date: string,
  today: string,
): AtlasSnapshot {
  if (date !== today) return snapshot;

  const activeHabits = snapshot.habits.filter(
    (habit) =>
      isScheduledOnDate(habit.schedule, date) &&
      !habit.skipped &&
      !habit.paused,
  );
  const scheduledTasks = snapshot.tasks.filter((item) =>
    isScheduledOnDate(item.schedule, date),
  );
  const scheduledRoutines = snapshot.routines.filter((item) =>
    isScheduledOnDate(item.schedule, date),
  );
  const eligibleActions =
    activeHabits.length + scheduledTasks.length + scheduledRoutines.length;
  const completed =
    activeHabits.filter(habitDone).length +
    scheduledTasks.filter((item) => item.completed).length +
    scheduledRoutines.filter((item) => item.completed).length;
  const existing = snapshot.history.findIndex((day) => day.date === date);
  const history = [...snapshot.history];
  const focusSeconds =
    existing >= 0 ? (history[existing]?.focusSeconds ?? 0) : 0;
  const historyDay = {
    date,
    ratio: eligibleActions === 0 ? 0 : completed / eligibleActions,
    focusSeconds,
    eligibleActions,
  };
  if (existing >= 0) history[existing] = historyDay;
  else history.push(historyDay);
  return { ...snapshot, history };
}
