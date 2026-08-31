import type {
  GoalPeriod,
  ProgressResult,
  StreakResult,
  StreakStep,
} from './model';

function decisionFor(
  result: ProgressResult,
): Pick<StreakStep, 'decision' | 'reason'> {
  switch (result.status) {
    case 'completed':
      return { decision: 'increment', reason: 'completed_counts' };
    case 'missed':
      return { decision: 'break', reason: 'missed_breaks' };
    case 'failed':
      return { decision: 'break', reason: 'failed_breaks' };
    case 'excused':
      return { decision: 'neutral', reason: 'excused_does_not_break' };
    case 'paused':
      return { decision: 'neutral', reason: 'pause_does_not_break' };
    case 'pending':
      return { decision: 'ignored', reason: 'open_period_ignored' };
  }
}

/**
 * A pause or justified omission does not add to a streak and does not break it.
 * Open windows are ignored until their grace boundary passes.
 */
export function calculateStreak(
  results: readonly ProgressResult[],
  unit: GoalPeriod,
): StreakResult {
  let running = 0;
  let best = 0;
  const steps: StreakStep[] = [];

  for (const result of results) {
    const decision = decisionFor(result);
    if (decision.decision === 'increment') {
      running += 1;
      best = Math.max(best, running);
    } else if (decision.decision === 'break') {
      running = 0;
    }
    steps.push({
      windowId: result.window.id,
      periodKey: result.window.periodKey,
      status: result.status,
      ...decision,
      streakAfter: running,
    });
  }

  return { current: running, best, unit, steps };
}
