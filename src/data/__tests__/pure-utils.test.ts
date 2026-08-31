import { describe, expect, it } from 'vitest';

import { stableStringify } from '../canonical-json';
import { formatHlc, parseHlc, tickLogicalClock } from '../clock';
import { isLocalDate } from '../local-date';
import { validateMigrationPlan } from '../migrations';
import { formatUuidV4 } from '../uuid';

describe('data layer pure utilities', () => {
  it('creates a canonical command fingerprint', () => {
    expect(
      stableStringify({ z: 1, nested: { b: 2, a: 1 }, a: undefined }),
    ).toBe('{"nested":{"a":1,"b":2},"z":1}');
  });

  it('formats RFC 4122 version 4 UUIDs', () => {
    expect(formatUuidV4(new Uint8Array(16))).toBe(
      '00000000-0000-4000-8000-000000000000',
    );
  });

  it('advances and round-trips hybrid logical clocks', () => {
    const next = tickLogicalClock({ wallTime: 100, counter: 2 }, 99, {
      wallTime: 100,
      counter: 5,
    });
    expect(next).toEqual({ wallTime: 100, counter: 6 });
    const encoded = formatHlc({ ...next, deviceId: 'device-a' });
    expect(parseHlc(encoded)).toEqual({
      wallTime: 100,
      counter: 6,
      deviceId: 'device-a',
    });
  });

  it('validates real Gregorian local dates', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2027-02-29')).toBe(false);
  });

  it('rejects gaps in migration plans', () => {
    expect(() =>
      validateMigrationPlan([
        { version: 1, name: 'one', sql: 'SELECT 1;' },
        { version: 3, name: 'three', sql: 'SELECT 3;' },
      ]),
    ).toThrow(/contiguous/);
  });
});
