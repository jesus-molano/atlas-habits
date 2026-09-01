const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const POSITIVE_INTEGER_PATTERN = /^\d+$/u;
const DECIMAL_PATTERN = /^\d+(?:[.,]\d+)?$/u;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Return a canonical civil date only when the written date really exists. */
export function normalizeLocalDate(value: string): string | null {
  const normalized = value.trim();
  const match = LOCAL_DATE_PATTERN.exec(normalized);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return normalized;
}

/** Return a canonical 24-hour time, accepting harmless surrounding spaces. */
export function normalizeLocalTime(value: string): string | null {
  const normalized = value.trim();
  return LOCAL_TIME_PATTERN.test(normalized) ? normalized : null;
}

/** Normalize the UI format used by task deadlines. */
export function normalizeLocalDateTime(value: string): string | null {
  const normalized = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})\s*·\s*(\d{2}:\d{2})$/u.exec(normalized);
  if (!match) return null;

  const date = normalizeLocalDate(match[1] ?? '');
  const time = normalizeLocalTime(match[2] ?? '');
  return date && time ? `${date} · ${time}` : null;
}

/** Suggest a distinct half-hour slot so adding a second reminder is useful. */
export function suggestReminderTime(values: readonly string[]): string {
  const used = new Set(
    values.flatMap((value) => normalizeLocalTime(value) ?? []),
  );
  const lastValid = [...values]
    .reverse()
    .map(normalizeLocalTime)
    .find((value): value is string => value !== null);
  const [lastHour, lastMinute] = (lastValid ?? '08:00').split(':').map(Number);
  const start = (lastHour * 60 + lastMinute + 60) % (24 * 60);

  for (let offset = 0; offset < 24 * 60; offset += 30) {
    const total = (start + offset) % (24 * 60);
    const candidate = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return '09:00';
}

export function parsePositiveInteger(value: string): number | null {
  const normalized = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Parse a positive decimal written with either a comma or a full stop. */
export function parsePositiveDecimal(value: string): number | null {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeInteger(value: string): number | null {
  const normalized = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
