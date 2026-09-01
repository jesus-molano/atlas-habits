import { describe, expect, it } from 'vitest';

import type { HistoryDay } from '@/features/atlas';

import { globalStreaks } from './stats-metrics';

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
