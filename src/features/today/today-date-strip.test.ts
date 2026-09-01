import { describe, expect, it } from 'vitest';

import {
  TODAY_DATE_STRIP_INDICES,
  TODAY_DATE_STRIP_ITEM_COUNT,
  TODAY_DATE_STRIP_TODAY_INDEX,
  todayDateStripDateAt,
  todayDateStripIndexForDate,
  todayDateStripSafeSelection,
} from './today-date-strip';

const TODAY = '2026-09-01';

describe('continuous today date strip', () => {
  it('keeps a stable virtual list with today at its right edge', () => {
    expect(TODAY_DATE_STRIP_INDICES).toHaveLength(TODAY_DATE_STRIP_ITEM_COUNT);
    expect(todayDateStripDateAt(TODAY_DATE_STRIP_TODAY_INDEX, TODAY)).toBe(
      TODAY,
    );
    expect(todayDateStripIndexForDate(TODAY, TODAY)).toBe(
      TODAY_DATE_STRIP_TODAY_INDEX,
    );
  });

  it('moves through month and leap-year boundaries one day at a time', () => {
    const leapToday = '2028-03-01';
    expect(
      todayDateStripDateAt(TODAY_DATE_STRIP_TODAY_INDEX - 1, leapToday),
    ).toBe('2028-02-29');
    expect(
      todayDateStripDateAt(TODAY_DATE_STRIP_TODAY_INDEX - 2, leapToday),
    ).toBe('2028-02-28');
  });

  it('converts a historical date to an index and back without replacing data', () => {
    const date = '2024-01-15';
    const index = todayDateStripIndexForDate(date, TODAY);
    const originalIndices = TODAY_DATE_STRIP_INDICES;

    expect(todayDateStripDateAt(index, TODAY)).toBe(date);
    expect(TODAY_DATE_STRIP_INDICES).toBe(originalIndices);
    expect(TODAY_DATE_STRIP_INDICES).toHaveLength(TODAY_DATE_STRIP_ITEM_COUNT);
  });

  it('keeps every adjacent virtual index one calendar day apart', () => {
    const indices = [0, 137, 5_000, TODAY_DATE_STRIP_TODAY_INDEX - 1];

    for (const index of indices) {
      const current = todayDateStripDateAt(index, TODAY);
      const next = todayDateStripDateAt(index + 1, TODAY);
      const followingIndex = todayDateStripIndexForDate(next, TODAY);

      expect(followingIndex).toBe(index + 1);
      expect(next).not.toBe(current);
    }
  });

  it('clamps future and invalid selections to today', () => {
    expect(todayDateStripSafeSelection('2026-09-02', TODAY)).toBe(TODAY);
    expect(todayDateStripSafeSelection('fecha', TODAY)).toBe(TODAY);
    expect(todayDateStripIndexForDate('2026-09-02', TODAY)).toBe(
      TODAY_DATE_STRIP_TODAY_INDEX,
    );
  });

  it('clamps dates older than the virtual range to its first item', () => {
    expect(todayDateStripIndexForDate('1900-01-01', TODAY)).toBe(0);
    expect(todayDateStripSafeSelection('1900-01-01', TODAY)).toBe(
      todayDateStripDateAt(0, TODAY),
    );
  });
});
