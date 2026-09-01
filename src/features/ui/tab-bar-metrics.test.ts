import { describe, expect, it } from 'vitest';

import {
  MINI_TIMER_GAP,
  miniTimerBottom,
  tabBarHeight,
} from './tab-bar-metrics';

describe('tab bar metrics', () => {
  it.each([
    { bottomInset: 0, fontScale: 1 },
    { bottomInset: 24, fontScale: 1 },
    { bottomInset: 24, fontScale: 2 },
  ])(
    'keeps the mini timer above the full tab bar for $bottomInset inset and $fontScale font scale',
    ({ bottomInset, fontScale }) => {
      expect(
        miniTimerBottom(bottomInset, fontScale) -
          tabBarHeight(bottomInset, fontScale),
      ).toBe(MINI_TIMER_GAP);
    },
  );
});
