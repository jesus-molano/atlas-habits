import { describe, expect, it } from 'vitest';

import {
  normalizeLocalDate,
  normalizeLocalDateTime,
  normalizeLocalTime,
  parseNonNegativeInteger,
  parsePositiveDecimal,
  parsePositiveInteger,
  suggestReminderTime,
} from './form-validation';

describe('create form validation', () => {
  it('accepts real civil dates and rejects calendar overflows', () => {
    expect(normalizeLocalDate(' 2024-02-29 ')).toBe('2024-02-29');
    expect(normalizeLocalDate('2023-02-29')).toBeNull();
    expect(normalizeLocalDate('2026-04-31')).toBeNull();
    expect(normalizeLocalDate('2026-13-01')).toBeNull();
  });

  it('validates exact 24-hour times', () => {
    expect(normalizeLocalTime(' 09:05 ')).toBe('09:05');
    expect(normalizeLocalTime('23:59')).toBe('23:59');
    expect(normalizeLocalTime('24:00')).toBeNull();
    expect(normalizeLocalTime('9:05')).toBeNull();
  });

  it('normalizes a complete optional deadline', () => {
    expect(normalizeLocalDateTime('2026-09-03·18:15')).toBe(
      '2026-09-03 · 18:15',
    );
    expect(normalizeLocalDateTime('2026-02-30 · 18:15')).toBeNull();
    expect(normalizeLocalDateTime('2026-09-03')).toBeNull();
  });

  it('parses only values meaningful for recurrence and goals', () => {
    expect(parsePositiveInteger('3')).toBe(3);
    expect(parsePositiveInteger('0')).toBeNull();
    expect(parsePositiveInteger('1.5')).toBeNull();
    expect(parsePositiveDecimal('1,5')).toBe(1.5);
    expect(parsePositiveDecimal('-1')).toBeNull();
    expect(parseNonNegativeInteger('0')).toBe(0);
    expect(parseNonNegativeInteger('-1')).toBeNull();
  });

  it('suggests a distinct time for each added reminder', () => {
    expect(suggestReminderTime([])).toBe('09:00');
    expect(suggestReminderTime(['09:00'])).toBe('10:00');
    expect(suggestReminderTime(['09:00', '10:00', '10:30'])).toBe('11:30');
    expect(suggestReminderTime(['not a time'])).toBe('09:00');
  });
});
