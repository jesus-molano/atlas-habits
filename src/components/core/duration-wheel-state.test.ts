import { describe, expect, it } from 'vitest';

import {
  DURATION_WHEEL_MAX_SECONDS_TOTAL,
  clampDurationSeconds,
  durationWheelColumnMaximum,
  durationWheelParts,
  durationWheelSeconds,
  durationWheelText,
  wheelIndexFromOffset,
} from './duration-wheel-state';

describe('duration wheel state', () => {
  it('clamps the duration to the supported twelve-hour range', () => {
    expect(clampDurationSeconds(-1)).toBe(0);
    expect(clampDurationSeconds(Number.NaN)).toBe(0);
    expect(clampDurationSeconds(DURATION_WHEEL_MAX_SECONDS_TOTAL + 1)).toBe(
      DURATION_WHEEL_MAX_SECONDS_TOTAL,
    );
  });

  it('round-trips hour, minute and second values', () => {
    const parts = durationWheelParts(3 * 3_600 + 27 * 60 + 8);

    expect(parts).toEqual({ hours: 3, minutes: 27, seconds: 8 });
    expect(durationWheelSeconds(parts)).toBe(12_428);
  });

  it('clamps an overflowing wheel combination to twelve hours exactly', () => {
    expect(durationWheelSeconds({ hours: 12, minutes: 59, seconds: 59 })).toBe(
      DURATION_WHEEL_MAX_SECONDS_TOTAL,
    );
    expect(durationWheelParts(DURATION_WHEEL_MAX_SECONDS_TOTAL)).toEqual({
      hours: 12,
      minutes: 0,
      seconds: 0,
    });
  });

  it('only exposes zero minutes and seconds at the twelve-hour maximum', () => {
    expect(durationWheelColumnMaximum('minutes', 11)).toBe(59);
    expect(durationWheelColumnMaximum('seconds', 11)).toBe(59);
    expect(durationWheelColumnMaximum('minutes', 12)).toBe(0);
    expect(durationWheelColumnMaximum('seconds', 12)).toBe(0);
  });

  it('snaps an offset to the nearest available row', () => {
    expect(wheelIndexFromOffset(119, 48, 59)).toBe(2);
    expect(wheelIndexFromOffset(9_999, 48, 12)).toBe(12);
    expect(wheelIndexFromOffset(-50, 48, 59)).toBe(0);
  });

  it('provides a complete accessible duration label', () => {
    expect(durationWheelText({ hours: 1, minutes: 2, seconds: 3 })).toBe(
      '1 hora, 2 minutos y 3 segundos',
    );
    expect(durationWheelText({ hours: 0, minutes: 1, seconds: 1 })).toBe(
      '0 horas, 1 minuto y 1 segundo',
    );
  });
});
