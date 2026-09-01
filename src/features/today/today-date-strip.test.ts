import { describe, expect, it } from 'vitest';

import { todayDateStripKeys } from './today-date-strip';

const TODAY = new Date('2026-09-01T12:00:00');

describe('todayDateStripKeys', () => {
  it('keeps one stable window while selecting any recent day', () => {
    const expected = [
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ];

    expect(todayDateStripKeys('2026-08-26', TODAY)).toEqual(expected);
    expect(todayDateStripKeys('2026-08-31', TODAY)).toEqual(expected);
    expect(todayDateStripKeys('2026-09-01', TODAY)).toEqual(expected);
  });

  it('centers an older selected date in a seven-day window', () => {
    const dates = todayDateStripKeys('2026-07-15', TODAY);

    expect(dates).toEqual([
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
    ]);
  });

  it('never renders a future window', () => {
    const dates = todayDateStripKeys('2026-09-10', TODAY);

    expect(dates).toHaveLength(7);
    expect(dates.at(-1)).toBe('2026-09-01');
  });
});
