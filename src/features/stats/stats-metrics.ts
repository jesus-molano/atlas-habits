import type { HistoryDay } from '@/features/atlas';

export type GlobalStreaks = Readonly<{ best: number; current: number }>;

export type WeeklySummary = Readonly<{
  plannedDays: number;
  completedDays: number;
  incompleteDays: number;
  neutralDays: number;
  /** Average completion across planned days; null when there was no plan. */
  ratio: number | null;
}>;

function isNeutral(day: HistoryDay): boolean {
  // Legacy snapshots did not record eligibility. Treat them as eligible so a
  // historic 0% cannot be mistaken for a neutral day and inflate a streak.
  return day.eligibleActions === 0;
}

export function weeklySummary(days: readonly HistoryDay[]): WeeklySummary {
  let plannedDays = 0;
  let completedDays = 0;
  let incompleteDays = 0;
  let neutralDays = 0;
  let ratioTotal = 0;

  for (const day of days) {
    if (isNeutral(day)) {
      neutralDays += 1;
      continue;
    }

    plannedDays += 1;
    ratioTotal += day.ratio;
    if (day.ratio >= 0.999) {
      completedDays += 1;
    } else {
      incompleteDays += 1;
    }
  }

  return {
    plannedDays,
    completedDays,
    incompleteDays,
    neutralDays,
    ratio: plannedDays === 0 ? null : ratioTotal / plannedDays,
  };
}

export function globalStreaks(days: readonly HistoryDay[]): GlobalStreaks {
  let best = 0;
  let running = 0;

  for (const day of days) {
    if (isNeutral(day)) continue;
    if (day.ratio >= 0.999) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }

  let current = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (!day || isNeutral(day)) continue;
    if (day.ratio < 0.999) break;
    current += 1;
  }

  return { best, current };
}
