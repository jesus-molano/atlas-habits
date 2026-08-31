import { compareDates } from './date';
import type {
  HabitDefinition,
  HabitTimeline,
  HabitTimelineInput,
} from './model';
import { expandRangeForGoal, generateOccurrences } from './occurrences';
import {
  buildProgressWindows,
  evaluateProgressWindow,
  windowsOverlappingRange,
} from './progress';
import { calculateStreak } from './streaks';

/** High-level deterministic projection consumed by app, widgets and alarms. */
export function calculateHabitTimeline(
  habit: HabitDefinition,
  input: HabitTimelineInput,
): HabitTimeline {
  const weekStartsOn = input.weekStartsOn ?? 1;
  const expandedRange = expandRangeForGoal(
    input,
    habit.goal.period,
    weekStartsOn,
  );
  const occurrences = generateOccurrences(habit, {
    ...expandedRange,
    weekStartsOn,
  });
  const allWindows = buildProgressWindows(habit, occurrences, weekStartsOn);
  const windows = windowsOverlappingRange(allWindows, input);
  const progress = windows
    .map((window) =>
      evaluateProgressWindow(habit, window, {
        asOf: input.asOf,
        measurements: input.measurements,
        overrides: input.overrides,
      }),
    )
    .sort((left, right) => {
      const byDate = compareDates(
        left.window.startDate,
        right.window.startDate,
      );
      return byDate !== 0
        ? byDate
        : left.window.id.localeCompare(right.window.id);
    });
  return {
    occurrences,
    windows,
    progress,
    streak: calculateStreak(progress, habit.goal.period),
  };
}
