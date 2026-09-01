import { describe, expect, it } from 'vitest';

import type { HistoryDay } from '@/features/atlas';

import { globalStreaks, weeklySummary } from './stats-metrics';

function day(ratio: number, eligibleActions?: number): HistoryDay {
  return {
    date: '2026-09-01',
    eligibleActions,
    focusSeconds: 0,
    ratio,
  };
}

describe('globalStreaks', () => {
  it('keeps a streak through a neutral day without counting it', () => {
    expect(globalStreaks([day(1, 1), day(0, 0), day(1, 2)])).toEqual({
      best: 2,
      current: 2,
    });
  });

  it('breaks the streak on an incomplete eligible day', () => {
    expect(globalStreaks([day(1, 1), day(0, 1), day(1, 1)])).toEqual({
      best: 1,
      current: 1,
    });
  });

  it('does not invent a streak from neutral days', () => {
    expect(globalStreaks([day(0, 0), day(0, 0)])).toEqual({
      best: 0,
      current: 0,
    });
  });

  it('skips a neutral current day when finding the current streak', () => {
    expect(globalStreaks([day(1, 1), day(0, 0)])).toEqual({
      best: 1,
      current: 1,
    });
  });

  it('uses conservative semantics for legacy history without eligibility', () => {
    expect(globalStreaks([day(1), day(0), day(1)])).toEqual({
      best: 1,
      current: 1,
    });
  });
});

describe('weeklySummary', () => {
  it('excludes neutral days from the weekly ratio and planned-day counts', () => {
    expect(
      weeklySummary([
        day(1, 1),
        day(1, 2),
        day(1, 1),
        day(0, 1),
        day(0, 3),
        day(0, 0),
        day(0, 0),
      ]),
    ).toEqual({
      plannedDays: 5,
      completedDays: 3,
      incompleteDays: 2,
      neutralDays: 2,
      ratio: 0.6,
    });
  });

  it('returns no ratio when the week has no planned actions', () => {
    expect(weeklySummary([day(0, 0), day(0, 0)])).toEqual({
      plannedDays: 0,
      completedDays: 0,
      incompleteDays: 0,
      neutralDays: 2,
      ratio: null,
    });
  });

  it('counts partial progress as an incomplete planned day', () => {
    expect(weeklySummary([day(0.5, 2), day(0, 1)])).toEqual({
      plannedDays: 2,
      completedDays: 0,
      incompleteDays: 2,
      neutralDays: 0,
      ratio: 0.25,
    });
  });

  it('treats legacy history without eligibility conservatively as planned', () => {
    expect(weeklySummary([day(1), day(0)])).toEqual({
      plannedDays: 2,
      completedDays: 1,
      incompleteDays: 1,
      neutralDays: 0,
      ratio: 0.5,
    });
  });
});
