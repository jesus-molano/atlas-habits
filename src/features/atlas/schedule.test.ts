import { describe, expect, it } from 'vitest';

import {
  expectedCompletions,
  isScheduledOnDate,
  normalizeSchedule,
  scheduleLabel,
} from './schedule';
import type { AtlasSchedule } from './types';

describe('Atlas schedule semantics', () => {
  it('selects explicit weekdays after the start date', () => {
    const schedule: AtlasSchedule = {
      kind: 'weekdays',
      days: [1, 3, 5],
      startDate: '2026-09-02',
      slots: [],
    };
    expect(isScheduledOnDate(schedule, '2026-09-01')).toBe(false);
    expect(isScheduledOnDate(schedule, '2026-09-02')).toBe(true);
    expect(isScheduledOnDate(schedule, '2026-09-03')).toBe(false);
    expect(scheduleLabel(schedule)).toBe('lun, mié, vie');
  });

  it('uses civil-day intervals from their anchor', () => {
    const schedule = {
      kind: 'interval_days' as const,
      every: 3,
      anchorDate: '2026-03-28',
      startDate: '2026-03-28',
      slots: [],
    };
    expect(isScheduledOnDate(schedule, '2026-03-31')).toBe(true);
    expect(isScheduledOnDate(schedule, '2026-04-01')).toBe(false);
    expect(scheduleLabel(schedule)).toBe('Cada 3 días');
  });

  it('does not multiply a period quota by reminder slots', () => {
    const schedule = {
      kind: 'period_quota' as const,
      period: 'week' as const,
      quota: 3,
      weekStartsOn: 1 as const,
      startDate: '2026-08-31',
      slots: [
        { id: 'morning', time: '09:00' },
        { id: 'evening', time: '19:00' },
      ],
    };
    expect(expectedCompletions(schedule)).toBe(3);
    expect(scheduleLabel(schedule)).toBe('3 veces por semana · 09:00, 19:00');
  });

  it('deduplicates weekdays and stable slot identifiers', () => {
    expect(
      normalizeSchedule({
        kind: 'weekdays',
        days: [5, 1, 5],
        startDate: '2026-08-31',
        slots: [
          { id: 'morning', time: '09:00' },
          { id: 'morning', time: '10:00' },
        ],
      }),
    ).toEqual({
      kind: 'weekdays',
      days: [1, 5],
      startDate: '2026-08-31',
      slots: [{ id: 'morning', time: '09:00' }],
    });
  });
});
